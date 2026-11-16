import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  decryptText,
  deriveKeyFromPassphrase,
  encryptText,
  generateDataEncryptionKey,
  generateRecoveryCode,
  generateSalt,
  sha256Hex,
  unwrapDataKey,
  wrapDataKey,
} from './crypto';
import { getDeviceInfo } from './device';
import {
  AppModule,
  DecryptedProfile,
  EncryptedSyncDocRecord,
  StudyPack,
  StudyPackCategory,
  StudyPackPlannerPayload,
  StudyPackRevisionPayload,
  UserAccountDoc,
  UserActivityDoc,
  UserDeviceDoc,
  UserRole,
} from '../types';

const CHUNK_SIZE = 200000;
export const BOOTSTRAP_ADMIN_EMAIL = 'howezhou2011@gmail.com';

const pushedChecksums = new Map<string, string>();
const knownSyncDocIds = new Set<string>();
const knownChunkCounts = new Map<string, number>();

export function resetSyncMemoryCache() {
  pushedChecksums.clear();
  knownSyncDocIds.clear();
  knownChunkCounts.clear();
}

async function makeSyncDocId(app: AppModule, chunkKey: string, chunkIndex: number): Promise<string> {
  const prefix = app === 'revision' ? 'rev' : 'pln';
  const digest = await sha256Hex(`${app}:${chunkKey}`);
  const safeKey = chunkKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  return `${prefix}_${safeKey}_${digest.slice(0, 16)}_c${chunkIndex}`;
}

export async function fetchUserAccount(uid: string): Promise<UserAccountDoc | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? (snap.data() as UserAccountDoc) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function createUserAccountWithVault(params: {
  uid: string;
  email: string;
  displayName: string;
  passphrase: string;
}): Promise<{ account: UserAccountDoc; dek: CryptoKey; recoveryCode: string }> {
  const { uid, email, displayName, passphrase } = params;
  const keySalt = generateSalt();
  const dek = await generateDataEncryptionKey();
  const kek = await deriveKeyFromPassphrase(passphrase, keySalt);
  const { wrappedKey: wrappedDek, iv: wrappedDekIv } = await wrapDataKey(dek, kek);

  const recoveryCode = generateRecoveryCode();
  const recKek = await deriveKeyFromPassphrase(recoveryCode, keySalt);
  const { wrappedKey: recoveryWrappedDek, iv: recoveryWrappedDekIv } = await wrapDataKey(dek, recKek);

  const initialRole: UserRole = email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL ? 'admin' : 'student';
  const safeName = (displayName || email.split('@')[0] || 'Student').slice(0, 100);

  const path = `users/${uid}`;
  try {
    await setDoc(doc(db, 'users', uid), {
      uid,
      role: initialRole,
      displayName: safeName,
      encryptionMode: 'passphrase',
      keySalt,
      wrappedDek,
      wrappedDekIv,
      recoveryWrappedDek,
      recoveryWrappedDekIv,
      keyVersion: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (initialRole === 'admin') {
      await setDoc(doc(db, 'admins', uid), {
        uid,
        grantedBy: uid,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }

  const initialProfile: DecryptedProfile = {
    email,
    fullName: safeName,
    school: '',
    yearGroup: '',
    examBoard: 'Edexcel / Cambridge',
    targetGrades: '',
    studyNotes: '',
  };
  await saveEncryptedProfile(uid, dek, 1, initialProfile);
  await registerOrHeartbeatDevice(uid);
  await recordActivity(uid, 'Created encrypted vault');

  const account = await fetchUserAccount(uid);
  if (!account) {
    throw new Error('Failed to load newly created user account.');
  }
  return { account, dek, recoveryCode };
}

export async function unlockVaultWithPassphrase(
  account: UserAccountDoc,
  passphrase: string
): Promise<CryptoKey> {
  const kek = await deriveKeyFromPassphrase(passphrase, account.keySalt);
  return unwrapDataKey(account.wrappedDek, account.wrappedDekIv, kek, true);
}

export async function unlockVaultWithRecoveryCode(
  account: UserAccountDoc,
  recoveryCode: string
): Promise<CryptoKey> {
  if (!account.recoveryWrappedDek || !account.recoveryWrappedDekIv) {
    throw new Error('No recovery key is configured for this account.');
  }
  const kek = await deriveKeyFromPassphrase(recoveryCode.trim().toUpperCase(), account.keySalt);
  return unwrapDataKey(account.recoveryWrappedDek, account.recoveryWrappedDekIv, kek, true);
}

export async function rotateVaultPassphrase(params: {
  uid: string;
  account: UserAccountDoc;
  dek: CryptoKey;
  newPassphrase: string;
}): Promise<{ account: UserAccountDoc; recoveryCode: string }> {
  const { uid, account, dek, newPassphrase } = params;
  const newSalt = generateSalt();
  const newKek = await deriveKeyFromPassphrase(newPassphrase, newSalt);
  const { wrappedKey: wrappedDek, iv: wrappedDekIv } = await wrapDataKey(dek, newKek);

  const recoveryCode = generateRecoveryCode();
  const recKek = await deriveKeyFromPassphrase(recoveryCode, newSalt);
  const { wrappedKey: recoveryWrappedDek, iv: recoveryWrappedDekIv } = await wrapDataKey(dek, recKek);

  const nextVersion = Math.min(1000, (account.keyVersion || 1) + 1);
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      displayName: account.displayName,
      encryptionMode: 'passphrase',
      keySalt: newSalt,
      wrappedDek,
      wrappedDekIv,
      recoveryWrappedDek,
      recoveryWrappedDekIv,
      keyVersion: nextVersion,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }

  await recordActivity(uid, 'Rotated vault passphrase');
  const updated = await fetchUserAccount(uid);
  return { account: updated || account, recoveryCode };
}

export async function updateDisplayName(uid: string, displayName: string): Promise<void> {
  const clean = displayName.trim().slice(0, 100);
  if (!clean) return;
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      displayName: clean,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function loadEncryptedProfile(
  uid: string,
  dek: CryptoKey
): Promise<DecryptedProfile | null> {
  const path = `users/${uid}/private/info`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'private', 'info'));
    if (!snap.exists()) return null;
    const data = snap.data() as { ciphertext: string; iv: string };
    const plain = await decryptText(data.ciphertext, data.iv, dek);
    return JSON.parse(plain) as DecryptedProfile;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
      handleFirestoreError(err, OperationType.GET, path);
    }
    throw err;
  }
}

export async function saveEncryptedProfile(
  uid: string,
  dek: CryptoKey,
  keyVersion: number,
  profile: DecryptedProfile
): Promise<void> {
  const path = `users/${uid}/private/info`;
  const { ciphertext, iv } = await encryptText(JSON.stringify(profile), dek);
  const ref = doc(db, 'users', uid, 'private', 'info');
  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, {
        ciphertext,
        iv,
        alg: 'AES-GCM-256',
        keyVersion,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ownerId: uid,
        ciphertext,
        iv,
        alg: 'AES-GCM-256',
        keyVersion,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function pushEncryptedSyncEntry(params: {
  uid: string;
  dek: CryptoKey;
  keyVersion: number;
  app: AppModule;
  chunkKey: string;
  value: string | null;
}): Promise<void> {
  const { uid, dek, keyVersion, app, chunkKey, value } = params;
  const device = getDeviceInfo();
  const compositeKey = `${app}::${chunkKey}`;

  if (value === null) {
    pushedChecksums.delete(compositeKey);
    const prevCount = knownChunkCounts.get(compositeKey) || 1;
    knownChunkCounts.delete(compositeKey);
    const path = `users/${uid}/syncDocs`;
    try {
      const batch = writeBatch(db);
      for (let i = 0; i < prevCount; i++) {
        const docId = await makeSyncDocId(app, chunkKey, i);
        knownSyncDocIds.delete(docId);
        batch.delete(doc(db, 'users', uid, 'syncDocs', docId));
      }
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
    return;
  }

  const checksum = await sha256Hex(value);
  if (pushedChecksums.get(compositeKey) === checksum) {
    return;
  }
  pushedChecksums.set(compositeKey, checksum);

  const totalChunks = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
  for (let i = 0; i < totalChunks; i++) {
    const slice = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const { ciphertext, iv } = await encryptText(slice, dek);
    const docId = await makeSyncDocId(app, chunkKey, i);
    const ref = doc(db, 'users', uid, 'syncDocs', docId);
    const path = `users/${uid}/syncDocs/${docId}`;

    try {
      let exists = knownSyncDocIds.has(docId);
      if (!exists) {
        const snap = await getDoc(ref);
        exists = snap.exists();
      }
      if (exists) {
        await updateDoc(ref, {
          chunkIndex: i,
          totalChunks,
          ciphertext,
          iv,
          alg: 'AES-GCM-256',
          checksum,
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          keyVersion,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          ownerId: uid,
          app,
          chunkKey,
          chunkIndex: i,
          totalChunks,
          ciphertext,
          iv,
          alg: 'AES-GCM-256',
          checksum,
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          keyVersion,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      knownSyncDocIds.add(docId);
    } catch (err) {
      pushedChecksums.delete(compositeKey);
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }

  const prevCount = knownChunkCounts.get(compositeKey) || 0;
  knownChunkCounts.set(compositeKey, totalChunks);

  // Clean up any stale chunks beyond totalChunks
  if (prevCount > totalChunks) {
    try {
      const batch = writeBatch(db);
      for (let i = totalChunks; i < prevCount; i++) {
        const docId = await makeSyncDocId(app, chunkKey, i);
        knownSyncDocIds.delete(docId);
        batch.delete(doc(db, 'users', uid, 'syncDocs', docId));
      }
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}/syncDocs`);
    }
  }
}

export function subscribeEncryptedSyncDocs(
  uid: string,
  dek: CryptoKey,
  onSyncUpdate: (payload: {
    revision: Record<string, string>;
    planner: Record<string, string>;
    chunkCount: number;
    fromRemoteDevice: boolean;
  }) => void,
  onError: (err: unknown) => void
): () => void {
  const path = `users/${uid}/syncDocs`;
  const q = query(collection(db, 'users', uid, 'syncDocs'), where('ownerId', '==', uid));
  const localDeviceId = getDeviceInfo().deviceId;
  let seq = 0;
  let isFirstSnapshot = true;

  return onSnapshot(
    q,
    async (snapshot) => {
      const currentSeq = ++seq;
      const groups = new Map<
        string,
        {
          app: AppModule;
          chunkKey: string;
          totalChunks: number;
          checksum: string;
          deviceId: string;
          chunks: Map<number, { ciphertext: string; iv: string }>;
        }
      >();

      snapshot.docs.forEach((d) => {
        knownSyncDocIds.add(d.id);
        const data = d.data() as EncryptedSyncDocRecord;
        const gk = `${data.app}::${data.chunkKey}`;
        let grp = groups.get(gk);
        if (!grp) {
          grp = {
            app: data.app,
            chunkKey: data.chunkKey,
            totalChunks: data.totalChunks,
            checksum: data.checksum,
            deviceId: data.deviceId,
            chunks: new Map(),
          };
          groups.set(gk, grp);
        }
        grp.chunks.set(data.chunkIndex, { ciphertext: data.ciphertext, iv: data.iv });
      });

      const revision: Record<string, string> = {};
      const planner: Record<string, string> = {};
      let anyFromRemote = false;

      for (const [gk, grp] of groups.entries()) {
        if (grp.chunks.size < grp.totalChunks) continue;
        let assembled = '';
        let ok = true;
        for (let i = 0; i < grp.totalChunks; i++) {
          const c = grp.chunks.get(i);
          if (!c) {
            ok = false;
            break;
          }
          try {
            assembled += await decryptText(c.ciphertext, c.iv, dek);
          } catch {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const prevChecksum = pushedChecksums.get(gk);
        if (prevChecksum !== grp.checksum && grp.deviceId !== localDeviceId) {
          anyFromRemote = true;
        }
        knownChunkCounts.set(gk, grp.totalChunks);
        pushedChecksums.set(gk, grp.checksum);
        if (grp.app === 'revision') revision[grp.chunkKey] = assembled;
        else planner[grp.chunkKey] = assembled;
      }

      if (currentSeq !== seq) return;
      const fromRemote = isFirstSnapshot || anyFromRemote;
      isFirstSnapshot = false;
      onSyncUpdate({
        revision,
        planner,
        chunkCount: snapshot.size,
        fromRemoteDevice: fromRemote,
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped);
      }
    }
  );
}

export async function registerOrHeartbeatDevice(uid: string): Promise<void> {
  const dev = getDeviceInfo();
  const path = `users/${uid}/devices/${dev.deviceId}`;
  const ref = doc(db, 'users', uid, 'devices', dev.deviceId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        deviceName: dev.deviceName,
        platform: dev.platform,
        lastSeenAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ownerId: uid,
        deviceId: dev.deviceId,
        deviceName: dev.deviceName,
        platform: dev.platform,
        lastSeenAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export function subscribeDevices(
  uid: string,
  onDevices: (devices: UserDeviceDoc[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const path = `users/${uid}/devices`;
  const q = query(collection(db, 'users', uid, 'devices'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as UserDeviceDoc);
      list.sort((a, b) => {
        const ta = a.lastSeenAt instanceof Timestamp ? a.lastSeenAt.toMillis() : 0;
        const tb = b.lastSeenAt instanceof Timestamp ? b.lastSeenAt.toMillis() : 0;
        return tb - ta;
      });
      onDevices(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError) onError(wrapped);
      }
    }
  );
}

export async function removeDevice(uid: string, deviceId: string): Promise<void> {
  const path = `users/${uid}/devices/${deviceId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'devices', deviceId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function recordActivity(uid: string, action: string): Promise<void> {
  const dev = getDeviceInfo();
  const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `users/${uid}/activity/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'activity', id), {
      ownerId: uid,
      action: action.slice(0, 80),
      deviceName: dev.deviceName,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeActivity(
  uid: string,
  onLogs: (logs: UserActivityDoc[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const path = `users/${uid}/activity`;
  const q = query(collection(db, 'users', uid, 'activity'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const logs = snap.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<UserActivityDoc, 'id'>),
        }))
        .sort((a, b) => {
          const ta = a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : 0;
          const tb = b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : 0;
          return tb - ta;
        })
        .slice(0, 20);
      onLogs(logs);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError) onError(wrapped);
      }
    }
  );
}

export async function listAllUserAccounts(): Promise<UserAccountDoc[]> {
  const path = 'users';
  try {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map((d) => d.data() as UserAccountDoc);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function updateUserRole(
  adminUid: string,
  targetUid: string,
  newRole: UserRole
): Promise<void> {
  const userPath = `users/${targetUid}`;
  const adminPath = `admins/${targetUid}`;
  try {
    await updateDoc(doc(db, 'users', targetUid), {
      role: newRole,
      updatedAt: serverTimestamp(),
    });
    if (newRole === 'admin') {
      const admRef = doc(db, 'admins', targetUid);
      const admSnap = await getDoc(admRef);
      if (!admSnap.exists()) {
        await setDoc(admRef, {
          uid: targetUid,
          grantedBy: adminUid,
          createdAt: serverTimestamp(),
        });
      }
    } else if (targetUid !== adminUid) {
      const admRef = doc(db, 'admins', targetUid);
      const admSnap = await getDoc(admRef);
      if (admSnap.exists()) {
        await deleteDoc(admRef);
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${userPath} / ${adminPath}`);
  }
}

export async function ensureBootstrapAdminRole(
  uid: string,
  email: string | null | undefined,
  account: UserAccountDoc | null
): Promise<UserAccountDoc | null> {
  if (!account || !email || email.toLowerCase() !== BOOTSTRAP_ADMIN_EMAIL) {
    return account;
  }
  try {
    const admRef = doc(db, 'admins', uid);
    const admSnap = await getDoc(admRef);
    if (!admSnap.exists()) {
      await setDoc(admRef, {
        uid,
        grantedBy: uid,
        createdAt: serverTimestamp(),
      });
    }
    if (account.role !== 'admin') {
      await updateDoc(doc(db, 'users', uid), {
        role: 'admin',
        updatedAt: serverTimestamp(),
      });
      return { ...account, role: 'admin' };
    }
  } catch (err) {
    console.warn('Bootstrap admin role sync skipped:', err);
  }
  return account;
}

interface CloudStudyPackRecord {
  id: string;
  title: string;
  subtitle: string;
  category: StudyPackCategory;
  examBoard: string;
  visibility: 'public' | 'private';
  ownerId: string;
  ownerName: string;
  subjectCountPreview: number;
  topicCountPreview: number;
  cardCountPreview: number;
  payloadJson: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export async function saveStudyPackToCloud(
  pack: StudyPack,
  uid: string,
  ownerName: string
): Promise<void> {
  const safeId = (pack.id || `pack_${Date.now().toString(36)}`)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
  const path = `studyPacks/${safeId}`;
  const payloadJson = JSON.stringify({
    tags: pack.tags || [],
    highlights: pack.highlights || [],
    revision: pack.revision || {},
    planner: pack.planner || {},
  });
  if (payloadJson.length > 650000) {
    throw new Error('This Study Pack exceeds the 650 KB cloud sharing limit.');
  }
  const ref = doc(db, 'studyPacks', safeId);
  const visibility: 'public' | 'private' = pack.visibility === 'public' ? 'public' : 'private';
  const cleanTitle = ((pack.title || '').trim() || 'Untitled Study Pack').slice(0, 140);
  const cleanSubtitle = (pack.subtitle || '').trim().slice(0, 240);
  const cleanBoard = ((pack.examBoard || '').trim() || 'Custom Study Pack').slice(0, 80);
  const cleanOwner = ((ownerName || pack.ownerName || '').trim() || 'StudyDeck User').slice(0, 100);
  const cleanCategory: StudyPackCategory =
    pack.category === 'flashcards' || pack.category === 'notes' ? pack.category : 'combo';

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, {
        title: cleanTitle,
        subtitle: cleanSubtitle,
        category: cleanCategory,
        examBoard: cleanBoard,
        visibility,
        ownerName: cleanOwner,
        subjectCountPreview: Math.max(0, Number(pack.subjectCountPreview || 0)),
        topicCountPreview: Math.max(0, Number(pack.topicCountPreview || 0)),
        cardCountPreview: Math.max(0, Number(pack.cardCountPreview || 0)),
        payloadJson,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        id: safeId,
        title: cleanTitle,
        subtitle: cleanSubtitle,
        category: cleanCategory,
        examBoard: cleanBoard,
        visibility,
        ownerId: uid,
        ownerName: cleanOwner,
        subjectCountPreview: Math.max(0, Number(pack.subjectCountPreview || 0)),
        topicCountPreview: Math.max(0, Number(pack.topicCountPreview || 0)),
        cardCountPreview: Math.max(0, Number(pack.cardCountPreview || 0)),
        payloadJson,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteStudyPackFromCloud(packId: string): Promise<void> {
  const safeId = packId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const path = `studyPacks/${safeId}`;
  try {
    const ref = doc(db, 'studyPacks', safeId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await deleteDoc(ref);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

function parseCloudPackRecord(rec: CloudStudyPackRecord): StudyPack | null {
  try {
    const parsed = JSON.parse(rec.payloadJson) as {
      tags?: string[];
      highlights?: string[];
      revision?: StudyPackRevisionPayload;
      planner?: StudyPackPlannerPayload;
    };
    return {
      id: rec.id,
      title: rec.title,
      subtitle: rec.subtitle,
      category: rec.category,
      examBoard: rec.examBoard,
      visibility: rec.visibility,
      ownerId: rec.ownerId,
      ownerName: rec.ownerName,
      author: rec.ownerName,
      isCustom: true,
      createdAt:
        rec.createdAt instanceof Timestamp
          ? rec.createdAt.toDate().toISOString()
          : new Date().toISOString(),
      subjectCountPreview: rec.subjectCountPreview,
      topicCountPreview: rec.topicCountPreview,
      cardCountPreview: rec.cardCountPreview,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
      revision: parsed.revision || {},
      planner: parsed.planner || {},
    };
  } catch {
    return null;
  }
}

export function subscribePublicStudyPacks(
  onPacks: (packs: StudyPack[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const path = 'studyPacks';
  const q = query(collection(db, 'studyPacks'), where('visibility', '==', 'public'));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => parseCloudPackRecord(d.data() as CloudStudyPackRecord))
        .filter((x): x is StudyPack => Boolean(x))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      onPacks(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError) onError(wrapped);
      }
    }
  );
}


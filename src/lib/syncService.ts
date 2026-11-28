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
  UserAccountDoc,
  UserActivityDoc,
  UserDeviceDoc,
  UserRole,
  WorkspaceData,
} from '../types';

const MAX_CHUNK_UTF8_BYTES = 220_000;
const MAX_CHUNKS_PER_ENTRY = 500;
export const WORKSPACE_V2_CHUNK_KEY = 'workspace-v2';
export const BOOTSTRAP_ADMIN_EMAIL = 'howezhou2011@gmail.com';

const pushedChecksums = new Map<string, string>();
const knownSyncDocIds = new Set<string>();
const knownChunkCounts = new Map<string, number>();
const knownSyncDocIdsByKey = new Map<string, Set<string>>();

export function resetSyncMemoryCache() {
  pushedChecksums.clear();
  knownSyncDocIds.clear();
  knownChunkCounts.clear();
  knownSyncDocIdsByKey.clear();
}

function splitTextByUtf8Bytes(text: string, maxBytes = MAX_CHUNK_UTF8_BYTES): string[] {
  if (!text) return [''];
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) {
    return [text];
  }
  const chunks: string[] = [];
  let start = 0;
  const len = text.length;

  while (start < len) {
    let end = Math.min(len, start + maxBytes);
    if (end < len && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) {
      end--;
    }
    let slice = text.slice(start, end);
    let byteLen = encoder.encode(slice).length;

    while (byteLen > maxBytes && end > start + 1) {
      const ratio = maxBytes / byteLen;
      let nextEnd = start + Math.max(1, Math.floor((end - start) * ratio * 0.95));
      if (nextEnd >= end) nextEnd = end - 1;
      if (
        nextEnd > start + 1 &&
        text.charCodeAt(nextEnd - 1) >= 0xd800 &&
        text.charCodeAt(nextEnd - 1) <= 0xdbff
      ) {
        nextEnd--;
      }
      end = nextEnd;
      slice = text.slice(start, end);
      byteLen = encoder.encode(slice).length;
    }

    chunks.push(slice);
    start = end;
  }

  return chunks;
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
    if (!snap.exists()) return null;
    const raw = snap.data() as Partial<UserAccountDoc>;
    return {
      ...(raw as UserAccountDoc),
      uid: typeof raw.uid === 'string' && raw.uid ? raw.uid : snap.id,
      displayName: typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : 'Student',
      role: raw.role === 'admin' || raw.role === 'educator' ? raw.role : 'student',
      keyVersion: Number(raw.keyVersion) || 1,
    };
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
    examBoard: 'GCSE / Edexcel',
    targetGrades: '',
    studyNotes: '',
  };
  await saveEncryptedProfile(uid, dek, 1, initialProfile);
  await registerOrHeartbeatDevice(uid).catch((err) => {
    console.warn('Initial device registration skipped:', err);
  });
  await recordActivity(uid, 'Created encrypted vault').catch((err) => {
    console.warn('Initial activity log skipped:', err);
  });

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

  const slices = splitTextByUtf8Bytes(value, MAX_CHUNK_UTF8_BYTES);
  const totalChunks = slices.length;
  if (totalChunks > MAX_CHUNKS_PER_ENTRY) {
    throw new Error(
      'Workspace data exceeds the cloud sync chunk limit. Export a JSON backup or remove large embedded attachments.'
    );
  }

  pushedChecksums.set(compositeKey, checksum);
  const writtenDocIds = new Set<string>();

  for (let i = 0; i < totalChunks; i++) {
    const slice = slices[i];
    const { ciphertext, iv } = await encryptText(slice, dek);
    const docId = await makeSyncDocId(app, chunkKey, i);
    writtenDocIds.add(docId);
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
  const staleDocIds = new Set<string>();
  const trackedSet = knownSyncDocIdsByKey.get(compositeKey);
  if (trackedSet) {
    for (const id of trackedSet) {
      if (!writtenDocIds.has(id)) staleDocIds.add(id);
    }
  }
  for (let i = totalChunks; i < prevCount; i++) {
    staleDocIds.add(await makeSyncDocId(app, chunkKey, i));
  }

  knownChunkCounts.set(compositeKey, totalChunks);
  knownSyncDocIdsByKey.set(compositeKey, writtenDocIds);

  if (staleDocIds.size > 0) {
    try {
      const batch = writeBatch(db);
      for (const staleId of staleDocIds) {
        knownSyncDocIds.delete(staleId);
        batch.delete(doc(db, 'users', uid, 'syncDocs', staleId));
      }
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}/syncDocs`);
    }
  }
}

export async function syncWorkspaceToCloud(params: {
  uid: string;
  dek: CryptoKey;
  keyVersion: number;
  workspace: WorkspaceData;
}): Promise<void> {
  await pushEncryptedSyncEntry({
    uid: params.uid,
    dek: params.dek,
    keyVersion: params.keyVersion,
    app: 'revision',
    chunkKey: WORKSPACE_V2_CHUNK_KEY,
    value: JSON.stringify(params.workspace),
  });
}

export function subscribeEncryptedSyncDocs(
  uid: string,
  dek: CryptoKey,
  onSyncUpdate: (payload: {
    revision: Record<string, string>;
    planner: Record<string, string>;
    workspaceV2Json: string | null;
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
          docIds: Set<string>;
          chunks: Map<
            number,
            {
              ciphertext: string;
              iv: string;
              totalChunks: number;
              checksum: string;
              deviceId: string;
            }
          >;
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
            docIds: new Set(),
            chunks: new Map(),
          };
          groups.set(gk, grp);
        }
        grp.docIds.add(d.id);
        grp.chunks.set(data.chunkIndex, {
          ciphertext: data.ciphertext,
          iv: data.iv,
          totalChunks: data.totalChunks,
          checksum: data.checksum,
          deviceId: data.deviceId,
        });
      });

      const revision: Record<string, string> = {};
      const planner: Record<string, string> = {};
      let workspaceV2Json: string | null = null;
      let anyFromRemote = false;

      for (const [gk, grp] of groups.entries()) {
        knownSyncDocIdsByKey.set(gk, grp.docIds);
        const maxIdx = Math.max(0, ...Array.from(grp.chunks.keys()));
        const head = grp.chunks.get(0);
        if (!head) continue;

        knownChunkCounts.set(gk, Math.max(head.totalChunks, maxIdx + 1));
        if (grp.chunks.size < head.totalChunks) continue;

        let assembled = '';
        let ok = true;
        let decryptFailed = false;
        for (let i = 0; i < head.totalChunks; i++) {
          const c = grp.chunks.get(i);
          if (!c || c.checksum !== head.checksum) {
            ok = false;
            break;
          }
          try {
            assembled += await decryptText(c.ciphertext, c.iv, dek);
          } catch {
            ok = false;
            decryptFailed = true;
            break;
          }
        }
        if (decryptFailed) {
          if (currentSeq === seq) {
            onError(new Error('Could not decrypt synced cloud data with your current vault key.'));
          }
          return;
        }
        if (!ok) continue;

        const prevChecksum = pushedChecksums.get(gk);
        if (prevChecksum !== head.checksum && head.deviceId !== localDeviceId) {
          anyFromRemote = true;
        }
        pushedChecksums.set(gk, head.checksum);
        if (grp.app === 'revision' && grp.chunkKey === WORKSPACE_V2_CHUNK_KEY) {
          workspaceV2Json = assembled;
        } else if (grp.app === 'revision') {
          revision[grp.chunkKey] = assembled;
        } else {
          planner[grp.chunkKey] = assembled;
        }
      }

      if (currentSeq !== seq) return;
      const fromRemote = isFirstSnapshot || anyFromRemote;
      isFirstSnapshot = false;
      onSyncUpdate({
        revision,
        planner,
        workspaceV2Json,
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
      const list = snap.docs.map((d) => {
        const raw = d.data() as Partial<UserDeviceDoc>;
        return {
          ...(raw as UserDeviceDoc),
          deviceId: typeof raw.deviceId === 'string' && raw.deviceId ? raw.deviceId : d.id,
          deviceName:
            typeof raw.deviceName === 'string' && raw.deviceName.trim() ? raw.deviceName : 'Device',
          platform:
            typeof raw.platform === 'string' && raw.platform.trim()
              ? raw.platform
              : 'Desktop Browser',
        };
      });
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
    return snap.docs.map((d) => {
      const raw = d.data() as Partial<UserAccountDoc>;
      return {
        ...(raw as UserAccountDoc),
        uid: typeof raw.uid === 'string' && raw.uid ? raw.uid : d.id,
        displayName:
          typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : 'Student',
        role: raw.role === 'admin' || raw.role === 'educator' ? raw.role : 'student',
        keyVersion: Number(raw.keyVersion) || 1,
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function updateUserRole(
  adminUid: string,
  targetUid: string,
  newRole: UserRole
): Promise<void> {
  await updateUserAdminControl({ adminUid, targetUid, role: newRole });
}

export async function updateUserAdminControl(params: {
  adminUid: string;
  targetUid: string;
  role?: UserRole;
  displayName?: string;
  disabled?: boolean;
  suspendedReason?: string;
  adminNote?: string;
}): Promise<void> {
  const { adminUid, targetUid, role, displayName, disabled, suspendedReason, adminNote } = params;
  const userPath = `users/${targetUid}`;
  const adminPath = `admins/${targetUid}`;

  const patch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (role !== undefined) patch.role = role;
  if (displayName !== undefined) {
    const cleanName = displayName.trim().slice(0, 100);
    if (cleanName) patch.displayName = cleanName;
  }
  if (disabled !== undefined && targetUid !== adminUid) {
    patch.disabled = disabled;
  }
  if (suspendedReason !== undefined) {
    patch.suspendedReason = suspendedReason.trim().slice(0, 280);
  }
  if (adminNote !== undefined) {
    patch.adminNote = adminNote.trim().slice(0, 500);
  }

  try {
    await updateDoc(doc(db, 'users', targetUid), patch);
    if (role === 'admin') {
      const admRef = doc(db, 'admins', targetUid);
      const admSnap = await getDoc(admRef);
      if (!admSnap.exists()) {
        await setDoc(admRef, {
          uid: targetUid,
          grantedBy: adminUid,
          createdAt: serverTimestamp(),
        });
      }
    } else if (role !== undefined && targetUid !== adminUid) {
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

export async function fetchUserDevicesForAdmin(targetUid: string): Promise<UserDeviceDoc[]> {
  const path = `users/${targetUid}/devices`;
  try {
    const q = query(collection(db, 'users', targetUid, 'devices'), where('ownerId', '==', targetUid));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => {
        const raw = d.data() as Partial<UserDeviceDoc>;
        return {
          ...(raw as UserDeviceDoc),
          deviceId: typeof raw.deviceId === 'string' && raw.deviceId ? raw.deviceId : d.id,
          deviceName:
            typeof raw.deviceName === 'string' && raw.deviceName.trim() ? raw.deviceName : 'Device',
          platform:
            typeof raw.platform === 'string' && raw.platform.trim()
              ? raw.platform
              : 'Desktop Browser',
        };
      })
      .sort((a, b) => {
        const ta = a.lastSeenAt instanceof Timestamp ? a.lastSeenAt.toMillis() : 0;
        const tb = b.lastSeenAt instanceof Timestamp ? b.lastSeenAt.toMillis() : 0;
        return tb - ta;
      });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function fetchUserActivityForAdmin(targetUid: string): Promise<UserActivityDoc[]> {
  const path = `users/${targetUid}/activity`;
  try {
    const q = query(collection(db, 'users', targetUid, 'activity'), where('ownerId', '==', targetUid));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({
        id: d.id,
        ...(d.data() as Omit<UserActivityDoc, 'id'>),
      }))
      .sort((a, b) => {
        const ta = a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : 0;
        const tb = b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : 0;
        return tb - ta;
      })
      .slice(0, 30);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function deleteUserAccountByAdmin(targetUid: string): Promise<void> {
  const path = `users/${targetUid}`;
  try {
    const batch = writeBatch(db);

    const [devicesSnap, activitySnap, syncSnap, privSnap, admSnap] = await Promise.all([
      getDocs(query(collection(db, 'users', targetUid, 'devices'), where('ownerId', '==', targetUid))),
      getDocs(query(collection(db, 'users', targetUid, 'activity'), where('ownerId', '==', targetUid))),
      getDocs(query(collection(db, 'users', targetUid, 'syncDocs'), where('ownerId', '==', targetUid))),
      getDoc(doc(db, 'users', targetUid, 'private', 'info')),
      getDoc(doc(db, 'admins', targetUid)),
    ]);

    devicesSnap.docs.forEach((d) => batch.delete(d.ref));
    activitySnap.docs.forEach((d) => batch.delete(d.ref));
    syncSnap.docs.forEach((d) => batch.delete(d.ref));
    if (privSnap.exists()) batch.delete(privSnap.ref);
    if (admSnap.exists()) batch.delete(admSnap.ref);
    batch.delete(doc(db, 'users', targetUid));

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
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

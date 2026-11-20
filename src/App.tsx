import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import { AuthVaultModal } from './components/AuthVaultModal';
import { CalendarView } from './components/CalendarView';
import { CommunityTypeFilter, CommunityView } from './components/CommunityView';
import { CustomizeModal } from './components/CustomizeModal';
import { FlashcardsView } from './components/FlashcardsView';
import { HomeDashboardView } from './components/HomeDashboardView';
import { LiveQuizView } from './components/LiveQuizView';
import { NotesStudioView } from './components/NotesStudioView';
import { PlannerView } from './components/PlannerView';
import { ProfileVaultView, VaultSection } from './components/ProfileVaultView';
import { ProgressView } from './components/ProgressView';
import { ShareItemModal, ShareTargetConfig } from './components/ShareItemModal';
import { Sidebar } from './components/Sidebar';
import { SubjectsView } from './components/SubjectsView';
import { TopBar } from './components/TopBar';
import { OfflineIndicator } from './components/PwaControls';
import { UniversalImportModal } from './components/UniversalImportModal';
import {
  clearTrustedDeviceKey,
  loadTrustedDeviceKey,
  saveTrustedDeviceKey,
} from './lib/crypto';
import {
  clearCommunityCache,
} from './lib/communityService';
import {
  createUserAccountWithVault,
  ensureBootstrapAdminRole,
  fetchUserAccount,
  loadEncryptedProfile,
  pushEncryptedSyncEntry,
  recordActivity,
  registerOrHeartbeatDevice,
  removeDevice,
  resetSyncMemoryCache,
  rotateVaultPassphrase,
  saveEncryptedProfile,
  subscribeActivity,
  subscribeDevices,
  subscribeEncryptedSyncDocs,
  syncWorkspaceToCloud,
  unlockVaultWithPassphrase,
  unlockVaultWithRecoveryCode,
  updateDisplayName,
  WORKSPACE_V2_CHUNK_KEY,
} from './lib/syncService';
import {
  addLoggedStudyMinutes,
  buildDeckSnapshot,
  buildTopicTreeList,
  clearWorkspaceLocal,
  convertLegacyEntriesToWorkspace,
  createEmptyWorkspace,
  detectHasGuestWorkspaceData,
  loadWorkspaceFromLocal,
  mergeWorkspaces,
  migrateLegacyBrowserStorage,
  normalizeWorkspace,
  saveWorkspaceToLocal,
} from './lib/workspaceStore';
import {
  AppearanceSettings,
  DecryptedProfile,
  LiveTimerState,
  PlannerSubTab,
  StudyTopic,
  UserAccountDoc,
  UserActivityDoc,
  UserDeviceDoc,
  WorkspaceData,
  WorkspaceTab,
} from './types';

const DEFAULT_LOOK: AppearanceSettings = {
  th: '',
  pal: '',
  zm: 100,
  lh: 14,
  mw: '',
  ff: '',
};

function normalizeLook(raw: Partial<AppearanceSettings> | null | undefined): AppearanceSettings {
  const th = raw?.th === 'light' || raw?.th === 'dark' ? raw.th : '';
  const pal =
    raw?.pal === 'paper' || raw?.pal === 'sage' || raw?.pal === 'contrast' ? raw.pal : '';
  const zm = typeof raw?.zm === 'number' && raw.zm >= 85 && raw.zm <= 150 ? raw.zm : 100;
  const lh = typeof raw?.lh === 'number' && raw.lh >= 12 && raw.lh <= 24 ? raw.lh : 14;
  const mw = typeof raw?.mw === 'string' ? raw.mw : '';
  const ff = typeof raw?.ff === 'string' ? raw.ff : '';
  return { th, pal, zm, lh, mw, ff };
}

function loadInitialLook(): AppearanceSettings {
  try {
    const saved = localStorage.getItem('studydeck_look');
    if (saved) return normalizeLook(JSON.parse(saved) as Partial<AppearanceSettings>);
    const revLook = localStorage.getItem('look');
    if (revLook) return normalizeLook(JSON.parse(revLook) as Partial<AppearanceSettings>);
    const legacyShellTheme = localStorage.getItem('studydeck_shell_theme');
    if (legacyShellTheme === 'light' || legacyShellTheme === 'dark') {
      return { ...DEFAULT_LOOK, th: legacyShellTheme };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_LOOK };
}

function readInitialShareCode(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('share');
    if (code && code.trim()) {
      return code.trim().toUpperCase();
    }
  } catch {
    // ignore
  }
  return null;
}

export default function App() {
  const [initialShareCode, setInitialShareCode] = useState<string | null>(() =>
    readInitialShareCode()
  );
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(() =>
    readInitialShareCode() ? 'community' : 'home'
  );
  const [plannerSubTab, setPlannerSubTab] = useState<PlannerSubTab>('todo');
  const [vaultSection, setVaultSection] = useState<VaultSection>('account');

  const [workspace, setWorkspace] = useState<WorkspaceData>(
    () => migrateLegacyBrowserStorage().workspace
  );
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(
    () => workspace.subjects[0]?.id || ''
  );
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [communityTypeFilter, setCommunityTypeFilter] = useState<CommunityTypeFilter | null>(null);
  const [openQuickAddSignal, setOpenQuickAddSignal] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('studydeck_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  );
  const [look, setLook] = useState<AppearanceSettings>(() => loadInitialLook());
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<ShareTargetConfig | null>(null);

  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [account, setAccount] = useState<UserAccountDoc | null>(null);
  const [dek, setDek] = useState<CryptoKey | null>(null);
  const [profile, setProfile] = useState<DecryptedProfile | null>(null);
  const [devices, setDevices] = useState<UserDeviceDoc[]>([]);
  const [activity, setActivity] = useState<UserActivityDoc[]>([]);
  const [chunkCount, setChunkCount] = useState(0);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [accountLoadError, setAccountLoadError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'synced' | 'error' | 'offline'>(
    navigator.onLine ? 'idle' : 'offline'
  );
  const [hasGuestData, setHasGuestData] = useState<boolean>(() => detectHasGuestWorkspaceData());

  // Global live Focus Timer
  const [timerDurationMins, setTimerDurationMins] = useState<number>(25);
  const [timerRemainingSec, setTimerRemainingSec] = useState<number>(25 * 60);
  const [timerRunning, setTimerRunning] = useState<boolean>(false);
  const [timerSubject, setTimerSubject] = useState<string>('General Study');

  const cloudHydratedRef = useRef<boolean>(false);
  const syncTimerRef = useRef<number | null>(null);
  const latestWorkspaceRef = useRef<WorkspaceData>(workspace);
  latestWorkspaceRef.current = workspace;

  // Keep selectedSubjectId valid
  useEffect(() => {
    if (workspace.subjects.length === 0) {
      if (selectedSubjectId) setSelectedSubjectId('');
      return;
    }
    if (!workspace.subjects.some((s) => s.id === selectedSubjectId)) {
      setSelectedSubjectId(workspace.subjects[0].id);
    }
  }, [workspace.subjects, selectedSubjectId]);

  // Apply unified appearance to document root
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const applyShellTheme = () => {
      setSystemPrefersDark(mq.matches);
      if (look.th === 'light') {
        root.setAttribute('data-theme', 'light');
        root.classList.remove('dark');
      } else if (look.th === 'dark') {
        root.setAttribute('data-theme', 'dark');
        root.classList.add('dark');
      } else {
        root.removeAttribute('data-theme');
        if (mq.matches) root.classList.add('dark');
        else root.classList.remove('dark');
      }

      if (look.pal) root.setAttribute('data-pal', look.pal);
      else root.removeAttribute('data-pal');

      if (look.ff) root.style.setProperty('--ff', look.ff);
      else root.style.removeProperty('--ff');

      root.style.fontSize = `${Math.round((look.zm / 100) * 16)}px`;
    };

    applyShellTheme();
    mq.addEventListener('change', applyShellTheme);

    try {
      localStorage.setItem('studydeck_look', JSON.stringify(look));
    } catch {
      // ignore
    }

    return () => mq.removeEventListener('change', applyShellTheme);
  }, [look]);

  // Network status listener
  useEffect(() => {
    const onOnline = () => setSyncState((s) => (s === 'offline' ? 'idle' : s));
    const onOffline = () => setSyncState('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const vaultUnlocked = useMemo(() => Boolean(firebaseUser && account && dek), [
    firebaseUser,
    account,
    dek,
  ]);

  // Workspace updater: saves locally and queues encrypted cloud sync
  const updateWorkspace = useCallback(
    (updater: (prev: WorkspaceData) => WorkspaceData) => {
      setWorkspace((prev) => {
        const next = normalizeWorkspace(updater(prev));
        next.updatedAt = new Date().toISOString();
        saveWorkspaceToLocal(next, firebaseUser?.uid || null);
        setHasGuestData(detectHasGuestWorkspaceData());
        return next;
      });
    },
    [firebaseUser?.uid]
  );

  // Debounced encrypted cloud push whenever workspace changes while unlocked
  useEffect(() => {
    if (!vaultUnlocked || !firebaseUser || !account || !dek) return;
    if (!cloudHydratedRef.current) return;

    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = window.setTimeout(() => {
      setSyncState('syncing');
      void syncWorkspaceToCloud({
        uid: firebaseUser.uid,
        dek,
        keyVersion: account.keyVersion,
        workspace: latestWorkspaceRef.current,
      })
        .then(() => setSyncState('synced'))
        .catch((err) => {
          console.error(err);
          setSyncState('error');
        });
    }, 1500);

    return () => {
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    };
  }, [workspace, vaultUnlocked, firebaseUser, account, dek]);

  // Live Focus Timer tick loop
  useEffect(() => {
    if (!timerRunning) return;
    const id = window.setInterval(() => {
      setTimerRemainingSec((prev) => {
        if (prev <= 1) {
          setTimerRunning(false);
          updateWorkspace((ws) => addLoggedStudyMinutes(ws, timerDurationMins));
          return timerDurationMins * 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning, timerDurationMins, updateWorkspace]);

  const liveTimer: LiveTimerState = useMemo(() => {
    const mm = String(Math.floor(timerRemainingSec / 60)).padStart(2, '0');
    const ss = String(timerRemainingSec % 60).padStart(2, '0');
    return {
      active: timerRunning || timerRemainingSec < timerDurationMins * 60,
      running: timerRunning,
      text: `${mm}:${ss}`,
      mode: 'Focus',
      subject: timerSubject,
    };
  }, [timerRunning, timerRemainingSec, timerDurationMins, timerSubject]);

  const handleToggleTimer = useCallback(() => {
    setTimerRunning((r) => !r);
  }, []);

  const handleResetTimer = useCallback(
    (mins?: number) => {
      const nextMins = mins ?? timerDurationMins;
      setTimerRunning(false);
      setTimerDurationMins(nextMins);
      setTimerRemainingSec(nextMins * 60);
    },
    [timerDurationMins]
  );

  const formatAccountLoadError = useCallback((err: unknown): string => {
    const raw = err instanceof Error ? err.message : String(err || '');
    if (
      raw.includes('firestore.googleapis.com') ||
      raw.includes('Cloud Firestore API has not been used') ||
      raw.includes('it is disabled')
    ) {
      return 'Cloud Firestore API is currently disabled or not provisioned on the active Firebase project. Your account data has not been deleted—reconnect or enable Firestore on your Firebase project to restore cloud sync.';
    }
    if (raw.includes('offline') || raw.includes('Failed to get document')) {
      return 'Could not reach Cloud Firestore right now. Showing your local cached workspace until connection is restored.';
    }
    return 'Could not load your cloud account metadata right now. Please retry or check your Firebase project settings.';
  }, []);

  const loadSignedInAccount = useCallback(
    async (user: User) => {
      setAccountLoadError(null);
      try {
        let acc = await fetchUserAccount(user.uid);
        acc = await ensureBootstrapAdminRole(user.uid, user.email, acc);
        setAccount(acc);
        if (!acc) {
          setDek(null);
          setHasGuestData(detectHasGuestWorkspaceData());
          setAuthModalOpen(true);
          return;
        }
        const cachedKey = await loadTrustedDeviceKey(user.uid);
        if (cachedKey) {
          try {
            const prof = await loadEncryptedProfile(user.uid, cachedKey);
            if (prof) setProfile(prof);
            setDek(cachedKey);
            return;
          } catch (profErr) {
            if (profErr instanceof DOMException && profErr.name === 'OperationError') {
              await clearTrustedDeviceKey(user.uid);
            } else {
              console.warn('Could not load encrypted profile yet:', profErr);
              setDek(cachedKey);
              return;
            }
          }
        }
        setDek(null);
        setAuthModalOpen(true);
      } catch (err) {
        console.error(err);
        setSyncState('error');
        setAccountLoadError(formatAccountLoadError(err));
      }
    },
    [formatAccountLoadError]
  );

  // Firebase Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (rawUser) => {
      const user = rawUser && !rawUser.isAnonymous ? rawUser : null;
      resetSyncMemoryCache();
      cloudHydratedRef.current = false;
      setFirebaseUser(user);
      setAccountLoadError(null);
      setProfile(null);
      setDevices([]);
      setActivity([]);
      setChunkCount(0);

      if (!user) {
        setAccount(null);
        setDek(null);
        setSyncState(navigator.onLine ? 'idle' : 'offline');
        setWorkspace(migrateLegacyBrowserStorage().workspace);
        setHasGuestData(detectHasGuestWorkspaceData());
        return;
      }

      const cachedLocalUserWs = loadWorkspaceFromLocal(user.uid);
      if (cachedLocalUserWs) {
        setWorkspace(cachedLocalUserWs);
      }

      await loadSignedInAccount(user);
    });
    return () => unsub();
  }, [loadSignedInAccount]);

  // Encrypted Firestore Sync & Device Subscriptions when unlocked
  useEffect(() => {
    if (!firebaseUser || !account || !dek) return;
    const uid = firebaseUser.uid;
    let cancelled = false;

    void registerOrHeartbeatDevice(uid).catch(console.error);
    const heartbeat = window.setInterval(() => {
      void registerOrHeartbeatDevice(uid).catch(console.error);
    }, 60000);

    void loadEncryptedProfile(uid, dek)
      .then((prof) => {
        if (!cancelled && prof) setProfile(prof);
      })
      .catch(console.error);

    setSyncState('syncing');
    const unsubDocs = subscribeEncryptedSyncDocs(
      uid,
      dek,
      ({ revision, planner, workspaceV2Json, chunkCount: count, fromRemoteDevice }) => {
        if (cancelled) return;
        setChunkCount(count);
        setSyncState('synced');

        if (workspaceV2Json) {
          if (!cloudHydratedRef.current || fromRemoteDevice) {
            try {
              const cloudWs = normalizeWorkspace(JSON.parse(workspaceV2Json));
              cloudHydratedRef.current = true;
              setWorkspace(cloudWs);
              saveWorkspaceToLocal(cloudWs, uid);
            } catch {
              cloudHydratedRef.current = true;
            }
          }
        } else {
          // One-time transparent migration if cloud only had legacy revision/planner chunks
          const hasLegacy = Object.keys(revision).length > 0 || Object.keys(planner).length > 0;
          if (hasLegacy && !cloudHydratedRef.current) {
            const seed = loadWorkspaceFromLocal(uid) || createEmptyWorkspace();
            const converted = convertLegacyEntriesToWorkspace(revision, planner, seed);
            cloudHydratedRef.current = true;
            setWorkspace(converted.workspace);
            saveWorkspaceToLocal(converted.workspace, uid);
            if (converted.hadLegacyData) {
              void syncWorkspaceToCloud({
                uid,
                dek,
                keyVersion: account.keyVersion,
                workspace: converted.workspace,
              }).catch(console.error);
            }
          } else {
            cloudHydratedRef.current = true;
          }
        }
      },
      (err) => {
        console.error(err);
        if (!cancelled) setSyncState('error');
      }
    );

    const unsubDevices = subscribeDevices(uid, (list) => {
      if (!cancelled) setDevices(list);
    });
    const unsubActivity = subscribeActivity(uid, (logs) => {
      if (!cancelled) setActivity(logs);
    });

    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      unsubDocs();
      unsubDevices();
      unsubActivity();
    };
  }, [firebaseUser, account, dek]);

  const deckSnapshot = useMemo(() => buildDeckSnapshot(workspace), [workspace]);

  const accountDisplayName = useMemo(
    () =>
      profile?.fullName?.trim() ||
      account?.displayName ||
      firebaseUser?.displayName ||
      firebaseUser?.email?.split('@')[0] ||
      'Guest Student',
    [profile, account, firebaseUser]
  );

  const selectedSubjectName = useMemo(
    () => workspace.subjects.find((s) => s.id === selectedSubjectId)?.name,
    [workspace.subjects, selectedSubjectId]
  );

  // Sharing handlers (generate Community Share modal config for Subject / Topic Notes / Flashcard Deck)
  const handleShareSubject = useCallback(
    (subjectId: string) => {
      const subj = workspace.subjects.find((s) => s.id === subjectId);
      if (!subj) return;
      const topics = workspace.topics.filter((t) => t.subjectId === subjectId);
      const cards = workspace.flashcards.filter((c) => c.subjectId === subjectId);
      const topicNameMap = new Map(topics.map((t) => [t.id, t.name]));

      setShareTarget({
        type: 'subject',
        defaultTitle: `${subj.name} Complete Revision`,
        subjectName: subj.name,
        examBoard: subj.examBoard,
        defaultSummary: `${topics.length} topics and ${cards.length} flashcards for ${subj.name} (${subj.examBoard}).`,
        itemCount: topics.length + cards.length,
        subjectPayload: {
          subject: {
            name: subj.name,
            examBoard: subj.examBoard,
            color: subj.color,
            hasTimeline: subj.hasTimeline,
          },
          topics: topics.map((t) => ({
            name: t.name,
            ...(t.parentTopicId && topicNameMap.get(t.parentTopicId)
              ? { parentTopicName: topicNameMap.get(t.parentTopicId) }
              : {}),
            specCode: t.specCode,
            notes: t.notes,
            timelineEvents: t.timelineEvents,
          })),
          cards: cards.map((c) => ({
            topicName: topicNameMap.get(c.topicId) || topics[0]?.name || 'Core Topic',
            sectionName: c.sectionName || 'Core Deck',
            q: c.q,
            a: c.a,
          })),
        },
      });
    },
    [workspace]
  );

  const handleShareTopic = useCallback(
    (subjectId: string, topicId: string) => {
      const subj = workspace.subjects.find((s) => s.id === subjectId);
      const topic = workspace.topics.find((t) => t.id === topicId);
      if (!subj || !topic) return;

      const countTopicItems = (t: StudyTopic) =>
        Math.max(
          1,
          t.notes.sections.reduce((acc, s) => acc + s.points.length, 0) +
            t.notes.keyTerms.length
        );

      const subjTree = buildTopicTreeList(
        workspace.topics.filter((t) => t.subjectId === subjectId)
      );
      const rootIdx = subjTree.findIndex((n) => n.topic.id === topicId);
      const subTopicShareOptions: Array<{
        topic: StudyTopic;
        depth: number;
        itemCount: number;
      }> = [];
      if (rootIdx !== -1) {
        const rootDepth = subjTree[rootIdx].depth;
        for (let i = rootIdx + 1; i < subjTree.length; i++) {
          if (subjTree[i].depth <= rootDepth) break;
          subTopicShareOptions.push({
            topic: subjTree[i].topic,
            depth: subjTree[i].depth - rootDepth,
            itemCount: countTopicItems(subjTree[i].topic),
          });
        }
      }

      const count = countTopicItems(topic);

      setShareTarget({
        type: 'notes',
        defaultTitle: topic.name,
        subjectName: subj.name,
        examBoard: subj.examBoard,
        defaultSummary:
          topic.notes.summary ||
          `Structured revision notes for ${subj.name}: ${topic.name}.`,
        itemCount: count,
        rootTopicOldId: topic.id,
        subTopicShareOptions,
        notesPayload: {
          topicName: topic.name,
          topicOldId: topic.id,
          specCode: topic.specCode,
          notes: topic.notes,
          timelineEvents: topic.timelineEvents,
        },
      });
    },
    [workspace]
  );

  const handleShareDeck = useCallback(
    (subjectId: string, sectionName: string) => {
      const subj = workspace.subjects.find((s) => s.id === subjectId);
      if (!subj) return;
      const cards = workspace.flashcards.filter(
        (c) => c.subjectId === subjectId && (sectionName === 'ALL' || (c.sectionName || 'Core Deck') === sectionName)
      );
      if (cards.length === 0) return;

      const label = sectionName === 'ALL' ? `${subj.name} Flashcards` : sectionName;
      setShareTarget({
        type: 'flashcards',
        defaultTitle: label,
        subjectName: subj.name,
        examBoard: subj.examBoard,
        defaultSummary: `${cards.length} active-recall flashcards for ${subj.name}.`,
        itemCount: cards.length,
        flashcardsPayload: {
          sectionName: label,
          cards: cards.map((c) => ({ q: c.q, a: c.a, sectionName: c.sectionName })),
        },
      });
    },
    [workspace]
  );

  // Auth, Vault, Backup handlers
  const handleSignInGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const handleSignOut = async () => {
    if (firebaseUser) {
      await clearTrustedDeviceKey(firebaseUser.uid);
    }
    resetSyncMemoryCache();
    cloudHydratedRef.current = false;
    setDek(null);
    setAccount(null);
    setProfile(null);
    await signOut(auth);
    setAuthModalOpen(false);
    setVaultSection('account');
    if (activeTab === 'admin') setActiveTab('home');
  };

  const importGuestIntoCloud = useCallback(
    async (uid: string, activeDek: CryptoKey, keyVersion: number) => {
      const guestWs = migrateLegacyBrowserStorage().workspace;
      const merged = mergeWorkspaces(latestWorkspaceRef.current, guestWs);
      cloudHydratedRef.current = true;
      setWorkspace(merged);
      saveWorkspaceToLocal(merged, uid);
      setSyncState('syncing');
      await syncWorkspaceToCloud({
        uid,
        dek: activeDek,
        keyVersion,
        workspace: merged,
      });
      await recordActivity(uid, 'Merged browser study data into encrypted cloud');
      setSyncState('synced');
    },
    []
  );

  const handleCreateVault = async (
    passphrase: string,
    rememberDevice: boolean,
    importGuest: boolean
  ) => {
    if (!firebaseUser) throw new Error('Not signed in.');
    const { account: newAcc, dek: newDek, recoveryCode } = await createUserAccountWithVault({
      uid: firebaseUser.uid,
      email: firebaseUser.email || '',
      displayName: firebaseUser.displayName || 'Student',
      passphrase,
    });
    if (rememberDevice) {
      await saveTrustedDeviceKey(firebaseUser.uid, newDek);
    }
    setAccount(newAcc);
    setDek(newDek);
    if (importGuest) {
      await importGuestIntoCloud(firebaseUser.uid, newDek, newAcc.keyVersion);
    }
    return recoveryCode;
  };

  const handleUnlockWithPassphrase = async (passphrase: string, rememberDevice: boolean) => {
    if (!firebaseUser || !account) throw new Error('Account not loaded.');
    const unlockedDek = await unlockVaultWithPassphrase(account, passphrase);
    if (rememberDevice) {
      await saveTrustedDeviceKey(firebaseUser.uid, unlockedDek);
    }
    setDek(unlockedDek);
    await recordActivity(firebaseUser.uid, 'Unlocked vault with passphrase');
  };

  const handleUnlockWithRecovery = async (recoveryCode: string, rememberDevice: boolean) => {
    if (!firebaseUser || !account) throw new Error('Account not loaded.');
    const unlockedDek = await unlockVaultWithRecoveryCode(account, recoveryCode);
    if (rememberDevice) {
      await saveTrustedDeviceKey(firebaseUser.uid, unlockedDek);
    }
    setDek(unlockedDek);
    await recordActivity(firebaseUser.uid, 'Unlocked vault with recovery code');
  };

  const handleLockVault = async () => {
    if (!firebaseUser) return;
    await clearTrustedDeviceKey(firebaseUser.uid);
    resetSyncMemoryCache();
    cloudHydratedRef.current = false;
    setDek(null);
    setProfile(null);
    setAuthModalOpen(true);
  };

  const handleSaveProfile = async (nextProfile: DecryptedProfile) => {
    if (!firebaseUser || !account || !dek) return;
    await saveEncryptedProfile(firebaseUser.uid, dek, account.keyVersion, nextProfile);
    if (nextProfile.fullName.trim() && nextProfile.fullName.trim() !== account.displayName) {
      await updateDisplayName(firebaseUser.uid, nextProfile.fullName.trim());
      setAccount({ ...account, displayName: nextProfile.fullName.trim() });
    }
    setProfile(nextProfile);
    await recordActivity(firebaseUser.uid, 'Updated encrypted profile');
  };

  const handleRotatePassphrase = async (newPassphrase: string) => {
    if (!firebaseUser || !account || !dek) throw new Error('Vault is locked.');
    const { account: updated, recoveryCode } = await rotateVaultPassphrase({
      uid: firebaseUser.uid,
      account,
      dek,
      newPassphrase,
    });
    setAccount(updated);
    return recoveryCode;
  };

  const handleForceSync = async () => {
    if (!firebaseUser || !account || !dek) return;
    setSyncState('syncing');
    await registerOrHeartbeatDevice(firebaseUser.uid);
    await syncWorkspaceToCloud({
      uid: firebaseUser.uid,
      dek,
      keyVersion: account.keyVersion,
      workspace: latestWorkspaceRef.current,
    });
    setSyncState('synced');
  };

  const handleImportGuestNow = async () => {
    if (!firebaseUser || !account || !dek) return;
    await importGuestIntoCloud(firebaseUser.uid, dek, account.keyVersion);
  };

  const handleImportWorkspaceData = async (
    incoming: WorkspaceData,
    mode: 'merge' | 'replace'
  ) => {
    const next = mode === 'replace' ? normalizeWorkspace(incoming) : mergeWorkspaces(workspace, incoming);
    updateWorkspace(() => next);
    if (firebaseUser && account && dek) {
      await recordActivity(firebaseUser.uid, `Imported workspace backup (${mode} mode)`);
    }
  };

  const handleResetWorkspace = async () => {
    const empty = createEmptyWorkspace();
    clearWorkspaceLocal(firebaseUser?.uid || null);
    setWorkspace(empty);
    saveWorkspaceToLocal(empty, firebaseUser?.uid || null);

    if (firebaseUser && account && dek) {
      setSyncState('syncing');
      try {
        await pushEncryptedSyncEntry({
          uid: firebaseUser.uid,
          dek,
          keyVersion: account.keyVersion,
          app: 'revision',
          chunkKey: WORKSPACE_V2_CHUNK_KEY,
          value: JSON.stringify(empty),
        });
        await recordActivity(firebaseUser.uid, 'Cleared workspace data to empty starter state');
        setSyncState('synced');
      } catch (err) {
        console.error(err);
        setSyncState('error');
      }
    }
    setHasGuestData(false);
  };

  const handleRemoveDevice = async (deviceId: string) => {
    if (!firebaseUser) return;
    await removeDevice(firebaseUser.uid, deviceId);
    await recordActivity(firebaseUser.uid, `Removed device ${deviceId}`);
  };

  const handleDeviceRenamed = async () => {
    if (!firebaseUser) return;
    await registerOrHeartbeatDevice(firebaseUser.uid);
  };

  const isDark = look.th === 'dark' || (look.th === '' && systemPrefersDark);

  const handleToggleLightDark = () => {
    setLook((prev) => ({ ...prev, th: isDark ? 'light' : 'dark' }));
  };

  const handleToggleSidebarCollapse = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('studydeck_sidebar_collapsed', next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleNavigate = useCallback(
    (
      tab: WorkspaceTab,
      opts?: {
        subjectId?: string;
        topicId?: string;
        plannerTab?: PlannerSubTab;
        vaultSection?: VaultSection;
        openQuickAdd?: boolean;
        communityTypeFilter?: CommunityTypeFilter;
        shareCode?: string;
      }
    ) => {
      if (opts?.subjectId) setSelectedSubjectId(opts.subjectId);
      if (opts?.topicId) setSelectedTopicId(opts.topicId);
      else if (tab === 'notes' && !opts?.topicId) setSelectedTopicId(null);

      if (opts?.communityTypeFilter) setCommunityTypeFilter(opts.communityTypeFilter);
      if (opts?.shareCode) setInitialShareCode(opts.shareCode.trim().toUpperCase());
      if (opts?.vaultSection) setVaultSection(opts.vaultSection);

      if (opts?.plannerTab) {
        if (opts.plannerTab === 'calendar') {
          setActiveTab('calendar');
          return;
        }
        setPlannerSubTab(opts.plannerTab);
      }
      if (opts?.openQuickAdd) setOpenQuickAddSignal(true);
      else if (tab !== 'subjects') setOpenQuickAddSignal(false);

      if (tab === 'admin') {
        setVaultSection('admin');
        setActiveTab('vault');
        return;
      }
      if (tab === 'vault' && !opts?.vaultSection) {
        setVaultSection('account');
      }
      setActiveTab(tab);
    },
    []
  );

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      <Sidebar
        activeTab={activeTab}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        onToggleCollapse={handleToggleSidebarCollapse}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onSelectTab={(tab) => handleNavigate(tab)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          activeTab={activeTab}
          plannerSubTab={plannerSubTab}
          selectedSubjectName={selectedSubjectName}
          onSelectTab={(tab, opts) => handleNavigate(tab, opts)}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
          onOpenImport={() => setImportModalOpen(true)}
          firebaseUser={firebaseUser}
          account={account}
          profile={profile}
          devices={devices}
          chunkCount={chunkCount}
          vaultUnlocked={vaultUnlocked}
          syncState={syncState}
          liveTimer={liveTimer}
          isDark={isDark}
          onToggleLightDark={handleToggleLightDark}
          customizeOpen={customizeOpen}
          onOpenCustomize={() => setCustomizeOpen((v) => !v)}
          onOpenAuth={() => setAuthModalOpen(true)}
          onForceSync={handleForceSync}
          onLockVault={handleLockVault}
          onSignOut={handleSignOut}
        />

        <main className="relative min-h-0 flex-1 overflow-hidden">
          {activeTab === 'home' && (
            <HomeDashboardView
              workspace={workspace}
              onUpdateWorkspace={updateWorkspace}
              onNavigate={handleNavigate}
              onOpenImport={() => setImportModalOpen(true)}
              liveTimer={liveTimer}
              timerRemainingSec={timerRemainingSec}
              timerDurationMins={timerDurationMins}
              onToggleTimer={handleToggleTimer}
              onResetTimer={handleResetTimer}
            />
          )}

          {activeTab === 'subjects' && (
            <SubjectsView
              workspace={workspace}
              initialQuickAddOpen={openQuickAddSignal}
              onUpdateWorkspace={updateWorkspace}
              onOpenSubjectNotes={(subjectId, topicId) =>
                handleNavigate('notes', { subjectId, topicId })
              }
              onOpenSubjectCards={(subjectId) => handleNavigate('flashcards', { subjectId })}
              onShareSubject={handleShareSubject}
              onNavigate={(tab) => handleNavigate(tab)}
            />
          )}

          {activeTab === 'notes' && (
            <NotesStudioView
              workspace={workspace}
              selectedSubjectId={selectedSubjectId}
              initialTopicId={selectedTopicId}
              onSelectSubjectId={setSelectedSubjectId}
              onUpdateWorkspace={updateWorkspace}
              onOpenImport={() => setImportModalOpen(true)}
              onShareTopic={handleShareTopic}
              onBrowseCommunityNotes={() =>
                handleNavigate('community', { communityTypeFilter: 'notes' })
              }
              onNavigate={(tab) => handleNavigate(tab)}
            />
          )}

          {activeTab === 'flashcards' && (
            <FlashcardsView
              workspace={workspace}
              selectedSubjectId={selectedSubjectId}
              onSelectSubjectId={setSelectedSubjectId}
              onUpdateWorkspace={updateWorkspace}
              onOpenImport={() => setImportModalOpen(true)}
              onShareDeck={handleShareDeck}
              onNavigate={(tab) => handleNavigate(tab)}
            />
          )}

          {activeTab === 'calendar' && (
            <CalendarView
              workspace={workspace}
              onUpdateWorkspace={updateWorkspace}
              onStartSession={(subjectName) => {
                setTimerSubject(subjectName || 'General Study');
                if (!timerRunning) setTimerRunning(true);
                setPlannerSubTab('timer');
                setActiveTab('planner');
              }}
            />
          )}

          {activeTab === 'planner' && (
            <PlannerView
              workspace={workspace}
              subTab={plannerSubTab}
              onChangeSubTab={setPlannerSubTab}
              onUpdateWorkspace={updateWorkspace}
              liveTimer={liveTimer}
              timerRemainingSec={timerRemainingSec}
              timerDurationMins={timerDurationMins}
              timerSubject={timerSubject}
              onChangeTimerSubject={setTimerSubject}
              onToggleTimer={handleToggleTimer}
              onResetTimer={handleResetTimer}
            />
          )}

          {activeTab === 'community' && (
            <CommunityView
              workspace={workspace}
              firebaseUser={firebaseUser}
              initialShareCode={initialShareCode}
              initialTypeFilter={communityTypeFilter}
              onUpdateWorkspace={updateWorkspace}
              onOpenAuth={() => setAuthModalOpen(true)}
              onRequestClearInitialShareCode={() => setInitialShareCode(null)}
              onRequestClearInitialTypeFilter={() => setCommunityTypeFilter(null)}
              onOpenCopiedNotes={(subjectId, topicId) =>
                handleNavigate('notes', { subjectId, topicId })
              }
              onOpenCopiedFlashcards={(subjectId) =>
                handleNavigate('flashcards', { subjectId })
              }
            />
          )}

          {activeTab === 'progress' && (
            <ProgressView
              workspace={workspace}
              onNavigate={(tab, opts) => handleNavigate(tab, opts)}
            />
          )}

          {(activeTab === 'vault' || activeTab === 'admin') && (
            <ProfileVaultView
              workspace={workspace}
              firebaseUser={firebaseUser}
              account={account}
              accountError={accountLoadError}
              vaultUnlocked={vaultUnlocked}
              profile={profile}
              devices={devices}
              activity={activity}
              chunkCount={chunkCount}
              syncState={syncState}
              hasGuestData={hasGuestData}
              initialSection={activeTab === 'admin' ? 'admin' : vaultSection}
              onOpenAuth={() => setAuthModalOpen(true)}
              onRetryAccountLoad={
                firebaseUser ? () => loadSignedInAccount(firebaseUser) : undefined
              }
              onSignOut={handleSignOut}
              onLockVault={handleLockVault}
              onSaveProfile={handleSaveProfile}
              onRotatePassphrase={handleRotatePassphrase}
              onForceSync={handleForceSync}
              onImportGuestData={handleImportGuestNow}
              onRemoveDevice={handleRemoveDevice}
              onDeviceRenamed={handleDeviceRenamed}
              onOpenCustomize={() => setCustomizeOpen(true)}
              onOpenUniversalImport={() => setImportModalOpen(true)}
              onOpenRevisionCards={() => handleNavigate('flashcards')}
              onOpenPlannerOptions={() => handleNavigate('planner', { plannerTab: 'timer' })}
              onImportWorkspaceData={handleImportWorkspaceData}
              onResetWorkspace={handleResetWorkspace}
            />
          )}

          {activeTab === 'quiz' && (
            <LiveQuizView
              deckSnapshot={deckSnapshot}
              defaultNickname={accountDisplayName}
              onRequestDecks={() => {
                // Workspace decks are live-reactive
              }}
            />
          )}
        </main>
      </div>

      {importModalOpen && (
        <UniversalImportModal
          open={importModalOpen}
          onClose={() => setImportModalOpen(false)}
          workspace={workspace}
          defaultSubjectId={selectedSubjectId}
          onOpenApiKeySettings={() => {
            setImportModalOpen(false);
            handleNavigate('vault', { vaultSection: 'data' });
          }}
          onApplyImport={(updater, _msg, targetSubjectId) => {
            updateWorkspace(updater);
            if (targetSubjectId) setSelectedSubjectId(targetSubjectId);
            setImportModalOpen(false);
          }}
        />
      )}

      <ShareItemModal
        open={Boolean(shareTarget)}
        onClose={() => setShareTarget(null)}
        target={shareTarget}
        firebaseUser={firebaseUser}
        authorName={accountDisplayName}
        onOpenAuth={() => {
          setShareTarget(null);
          setAuthModalOpen(true);
        }}
        onPublished={() => {
          clearCommunityCache();
        }}
      />

      <CustomizeModal
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        look={look}
        onChangeLook={(next) => setLook(normalizeLook(next))}
        onResetLook={() => setLook({ ...DEFAULT_LOOK })}
      />

      <AuthVaultModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        firebaseUser={firebaseUser}
        account={account}
        accountError={accountLoadError}
        vaultUnlocked={vaultUnlocked}
        hasGuestData={hasGuestData}
        onRetryAccountLoad={firebaseUser ? () => loadSignedInAccount(firebaseUser) : undefined}
        onSignInGoogle={handleSignInGoogle}
        onSignOut={handleSignOut}
        onCreateVault={handleCreateVault}
        onUnlockWithPassphrase={handleUnlockWithPassphrase}
        onUnlockWithRecovery={handleUnlockWithRecovery}
      />

      <OfflineIndicator />
    </div>
  );
}

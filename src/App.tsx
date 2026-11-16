import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import { AuthVaultModal } from './components/AuthVaultModal';
import { CustomizeModal } from './components/CustomizeModal';
import { LiveQuizView } from './components/LiveQuizView';
import { ProfileVaultView, VaultSection } from './components/ProfileVaultView';
import { Sidebar } from './components/Sidebar';
import { StudyPacksView } from './components/StudyPacksView';
import { TopBar } from './components/TopBar';
import {
  loadAppliedPackIdsFromLocal,
  loadCustomPacksFromLocal,
  saveAppliedPackIdsToLocal,
  saveCustomPacksToLocal,
} from './data/studyPacks';
import {
  clearTrustedDeviceKey,
  loadTrustedDeviceKey,
  saveTrustedDeviceKey,
} from './lib/crypto';
import {
  deleteLocalPackFile,
  loadAllLocalPackFiles,
  loadStaticPublicPackFiles,
} from './lib/packFileStore';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  createUserAccountWithVault,
  deleteStudyPackFromCloud,
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
  savePrivatePackFile,
  saveStudyPackToCloud,
  subscribeActivity,
  subscribeDevices,
  subscribeEncryptedSyncDocs,
  subscribePublicStudyPacks,
  subscribeUserStudyPacks,
  unlockVaultWithPassphrase,
  unlockVaultWithRecoveryCode,
  updateDisplayName,
} from './lib/syncService';
import {
  AppearanceSettings,
  AppModule,
  DeckSnapshot,
  DecryptedProfile,
  LiveTimerState,
  PlannerUiSettings,
  StudyPack,
  UserAccountDoc,
  UserActivityDoc,
  UserDeviceDoc,
  WorkspaceTab,
} from './types';

const EMPTY_DECK_SNAPSHOT: DeckSnapshot = {
  subjects: [],
  topics: [],
  sections: [],
  cards: [],
};

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

function lookEqual(a: AppearanceSettings, b: AppearanceSettings): boolean {
  return (
    a.th === b.th &&
    (a.pal || '') === (b.pal || '') &&
    a.zm === b.zm &&
    a.lh === b.lh &&
    a.mw === b.mw &&
    a.ff === b.ff
  );
}

function loadInitialLook(): AppearanceSettings {
  try {
    const saved = localStorage.getItem('studydeck_look');
    if (saved) {
      return normalizeLook(JSON.parse(saved) as Partial<AppearanceSettings>);
    }
    const revLook = localStorage.getItem('look');
    if (revLook) {
      return normalizeLook(JSON.parse(revLook) as Partial<AppearanceSettings>);
    }
    const legacyShellTheme = localStorage.getItem('studydeck_shell_theme');
    if (legacyShellTheme === 'light' || legacyShellTheme === 'dark') {
      return { ...DEFAULT_LOOK, th: legacyShellTheme };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_LOOK };
}

function detectHasGuestData(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k === 'mockplanner.v1' || /^(known-|edits-|gdoc-|fc-state|cb-ui|look|last-topic)/.test(k)) {
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('planner');
  const [revisionMode, setRevisionMode] = useState<string>('study');
  const [revisionSubj, setRevisionSubj] = useState<string>('h');
  const [revisionSubjName, setRevisionSubjName] = useState<string>('History');
  const [plannerTab, setPlannerTab] = useState<string>('today');
  const [vaultSection, setVaultSection] = useState<VaultSection>('account');
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

  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [account, setAccount] = useState<UserAccountDoc | null>(null);
  const [dek, setDek] = useState<CryptoKey | null>(null);
  const [profile, setProfile] = useState<DecryptedProfile | null>(null);
  const [devices, setDevices] = useState<UserDeviceDoc[]>([]);
  const [activity, setActivity] = useState<UserActivityDoc[]>([]);
  const [chunkCount, setChunkCount] = useState(0);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'synced' | 'error' | 'offline'>(
    navigator.onLine ? 'idle' : 'offline'
  );
  const [liveTimer, setLiveTimer] = useState<LiveTimerState>({
    active: false,
    running: false,
    text: '',
    mode: '',
    subject: '',
  });
  const [hasGuestData, setHasGuestData] = useState<boolean>(() => detectHasGuestData());
  const [deckSnapshot, setDeckSnapshot] = useState<DeckSnapshot>(EMPTY_DECK_SNAPSHOT);
  const [customPacks, setCustomPacks] = useState<StudyPack[]>(() => {
    const byId = new Map<string, StudyPack>();
    for (const p of loadAllLocalPackFiles()) byId.set(p.id, p);
    for (const p of loadCustomPacksFromLocal()) byId.set(p.id, p);
    return Array.from(byId.values());
  });
  const [publicPacks, setPublicPacks] = useState<StudyPack[]>([]);
  const [filePublicPacks, setFilePublicPacks] = useState<StudyPack[]>([]);
  const [userCloudPacks, setUserCloudPacks] = useState<StudyPack[]>([]);
  const [appliedPackIds, setAppliedPackIds] = useState<string[]>(() =>
    loadAppliedPackIdsFromLocal()
  );

  const revisionRef = useRef<HTMLIFrameElement | null>(null);
  const plannerRef = useRef<HTMLIFrameElement | null>(null);
  const latestEntriesRef = useRef<{
    revision: Record<string, string>;
    planner: Record<string, string>;
  }>({ revision: {}, planner: {} });
  const readyAppsRef = useRef<{ revision: boolean; planner: boolean }>({
    revision: false,
    planner: false,
  });
  const hydratedAppsRef = useRef<{ revision: boolean; planner: boolean }>({
    revision: false,
    planner: false,
  });
  const latestStudyStatsRef = useRef<unknown>(null);
  const pendingGuestResolveRef = useRef<{
    revision?: (entries: Record<string, string>) => void;
    planner?: (entries: Record<string, string>) => void;
  }>({});
  const pendingCurrentResolveRef = useRef<Map<string, (entries: Record<string, string>) => void>>(
    new Map()
  );

  const postToApp = useCallback((app: AppModule, payload: unknown) => {
    const target = app === 'revision' ? revisionRef.current : plannerRef.current;
    target?.contentWindow?.postMessage(payload, window.location.origin);
  }, []);

  // Apply unified appearance to shell root and sync to embedded apps
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
    };

    applyShellTheme();
    mq.addEventListener('change', applyShellTheme);

    try {
      localStorage.setItem('studydeck_look', JSON.stringify(look));
    } catch {
      // ignore
    }

    if (readyAppsRef.current.revision) {
      postToApp('revision', { type: 'BRIDGE_APPEARANCE', app: 'revision', look });
    }
    if (readyAppsRef.current.planner) {
      postToApp('planner', { type: 'BRIDGE_APPEARANCE', app: 'planner', look });
    }

    return () => mq.removeEventListener('change', applyShellTheme);
  }, [look, postToApp]);

  // Network connectivity listener
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

  const hydrateIframe = useCallback(
    (app: AppModule, uid: string, entries: Record<string, string>) => {
      postToApp(app, { type: 'BRIDGE_HYDRATE', app, uid, entries });
    },
    [postToApp]
  );

  const refreshPublicPackFiles = useCallback(async () => {
    const staticFiles = await loadStaticPublicPackFiles();
    setFilePublicPacks(staticFiles.map((p) => ({ ...p, visibility: 'public' })));
  }, []);

  // Subscribe to community public Study Packs (Firestore Spark + static /study-packs/*.json files)
  useEffect(() => {
    void refreshPublicPackFiles();
    const unsub = subscribePublicStudyPacks(
      (packs) => setPublicPacks(packs),
      (err) => console.warn('Public study packs listener:', err)
    );
    return () => unsub();
  }, [refreshPublicPackFiles]);

  // Subscribe to the signed-in user's own pack files in Firestore Spark (private + public)
  useEffect(() => {
    if (!firebaseUser) {
      setUserCloudPacks([]);
      return;
    }
    const unsub = subscribeUserStudyPacks(
      firebaseUser.uid,
      (packs) => setUserCloudPacks(packs),
      (err) => console.warn('User study packs listener:', err)
    );
    return () => unsub();
  }, [firebaseUser]);

  // Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      resetSyncMemoryCache();
      latestEntriesRef.current = { revision: {}, planner: {} };
      hydratedAppsRef.current = { revision: false, planner: false };
      setFirebaseUser(user);
      setProfile(null);
      setDevices([]);
      setActivity([]);
      setChunkCount(0);

      if (!user) {
        setAccount(null);
        setDek(null);
        setSyncState(navigator.onLine ? 'idle' : 'offline');
        setDeckSnapshot(EMPTY_DECK_SNAPSHOT);
        setUserCloudPacks([]);
        const byId = new Map<string, StudyPack>();
        for (const p of loadAllLocalPackFiles()) byId.set(p.id, p);
        for (const p of loadCustomPacksFromLocal()) byId.set(p.id, p);
        setCustomPacks(Array.from(byId.values()));
        setAppliedPackIds(loadAppliedPackIdsFromLocal());
        postToApp('revision', { type: 'BRIDGE_SIGNOUT', app: 'revision' });
        postToApp('planner', { type: 'BRIDGE_SIGNOUT', app: 'planner' });
        setHasGuestData(detectHasGuestData());
        return;
      }

      try {
        let acc = await fetchUserAccount(user.uid);
        acc = await ensureBootstrapAdminRole(user.uid, user.email, acc);
        setAccount(acc);
        if (!acc) {
          setDek(null);
          setHasGuestData(detectHasGuestData());
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
          } catch {
            await clearTrustedDeviceKey(user.uid);
          }
        }
        setDek(null);
        setAuthModalOpen(true);
      } catch (err) {
        console.error(err);
        setSyncState('error');
      }
    });
    return () => unsub();
  }, [postToApp]);

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
      ({ revision, planner, chunkCount: count, fromRemoteDevice }) => {
        if (cancelled) return;
        latestEntriesRef.current = { revision, planner };
        setChunkCount(count);
        setSyncState('synced');
        if (revision['studydeck-packs']) {
          try {
            const parsed = JSON.parse(revision['studydeck-packs']);
            if (Array.isArray(parsed)) {
              setCustomPacks(parsed);
              saveCustomPacksToLocal(parsed);
            }
          } catch {
            // ignore
          }
        }
        if (revision['studydeck-applied-packs']) {
          try {
            const parsed = JSON.parse(revision['studydeck-applied-packs']);
            if (Array.isArray(parsed)) {
              setAppliedPackIds(parsed);
              saveAppliedPackIdsToLocal(parsed);
            }
          } catch {
            // ignore
          }
        }
        if (readyAppsRef.current.revision && (!hydratedAppsRef.current.revision || fromRemoteDevice)) {
          hydratedAppsRef.current.revision = true;
          hydrateIframe('revision', uid, revision);
        }
        if (readyAppsRef.current.planner && (!hydratedAppsRef.current.planner || fromRemoteDevice)) {
          hydratedAppsRef.current.planner = true;
          hydrateIframe('planner', uid, planner);
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
  }, [firebaseUser, account, dek, hydrateIframe]);

  const vaultUnlocked = useMemo(() => Boolean(firebaseUser && account && dek), [
    firebaseUser,
    account,
    dek,
  ]);

  const accountStats = useMemo(
    () => ({
      signedIn: Boolean(firebaseUser),
      displayName:
        profile?.fullName?.trim() ||
        account?.displayName ||
        firebaseUser?.displayName ||
        firebaseUser?.email?.split('@')[0] ||
        'Guest Student',
      email: firebaseUser?.email || '',
      role: account?.role || 'guest',
      vaultUnlocked,
      syncState,
      chunkCount,
      deviceCount: devices.length || (firebaseUser ? 1 : 0),
      keyVersion: account?.keyVersion ?? 1,
    }),
    [firebaseUser, profile, account, vaultUnlocked, syncState, chunkCount, devices.length]
  );

  useEffect(() => {
    if (readyAppsRef.current.planner) {
      postToApp('planner', {
        type: 'BRIDGE_ACCOUNT_STATS',
        app: 'planner',
        accountStats,
      });
    }
  }, [accountStats, postToApp]);

  // Handle postMessage events from revision.html and planner.html
  useEffect(() => {
    const onMessage = async (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as
        | { type: 'BRIDGE_READY'; app: AppModule }
        | {
            type: 'BRIDGE_PATCH';
            app: AppModule;
            uid: string;
            patch: Record<string, string | null>;
          }
        | { type: 'BRIDGE_GUEST_DATA'; app: AppModule; entries: Record<string, string> }
        | {
            type: 'BRIDGE_CURRENT_DATA';
            app: AppModule;
            reqId?: string;
            entries: Record<string, string>;
          }
        | { type: 'BRIDGE_LOOK_SYNC'; app: AppModule; look: Partial<AppearanceSettings> }
        | { type: 'BRIDGE_PLANNER_UI'; app: AppModule; ui: PlannerUiSettings }
        | { type: 'BRIDGE_REVISION_STATE'; app: AppModule; mode?: string; subj?: string; subjName?: string }
        | { type: 'BRIDGE_PLANNER_STATE'; app: AppModule; tab?: string }
        | { type: 'BRIDGE_STUDY_STATS'; app: AppModule; stats: unknown }
        | { type: 'BRIDGE_DECK_SNAPSHOT'; app: AppModule; snapshot: DeckSnapshot }
        | { type: 'BRIDGE_ADD_SUBJECT'; app: AppModule; name: string; topics?: string[] }
        | {
            type: 'BRIDGE_SUBJ_SYNC';
            app: AppModule;
            action: 'rename' | 'delete';
            oldName?: string;
            newName?: string;
            name?: string;
          }
        | {
            type: 'BRIDGE_NAV_APP';
            app: AppModule;
            target:
              | 'cards'
              | 'study'
              | 'todo'
              | 'calendar'
              | 'subjects'
              | 'progress'
              | 'vault'
              | 'packs'
              | 'quiz'
              | 'ai';
            topic?: string;
          }
        | ({ type: 'PLANNER_TIMER' } & LiveTimerState)
        | undefined;

      if (!data || !data.type) return;

      if (data.type === 'BRIDGE_READY') {
        readyAppsRef.current[data.app] = true;
        postToApp(data.app, { type: 'BRIDGE_APPEARANCE', app: data.app, look });
        if (firebaseUser && dek) {
          hydratedAppsRef.current[data.app] = true;
          hydrateIframe(data.app, firebaseUser.uid, latestEntriesRef.current[data.app]);
        }
        if (data.app === 'revision') {
          postToApp('revision', {
            type: 'BRIDGE_REVISION_CMD',
            app: 'revision',
            cmd: 'req_decks',
          });
        }
        if (data.app === 'planner') {
          if (latestStudyStatsRef.current) {
            postToApp('planner', {
              type: 'BRIDGE_STUDY_STATS',
              app: 'planner',
              stats: latestStudyStatsRef.current,
            });
          }
          postToApp('planner', {
            type: 'BRIDGE_ACCOUNT_STATS',
            app: 'planner',
            accountStats,
          });
        }
        return;
      }

      if (data.type === 'BRIDGE_ADD_SUBJECT' && data.name) {
        if (data.app === 'revision' && readyAppsRef.current.planner) {
          postToApp('planner', {
            type: 'BRIDGE_ADD_SUBJECT',
            app: 'planner',
            name: data.name,
            topics: data.topics || [],
          });
        } else if (data.app === 'planner' && readyAppsRef.current.revision) {
          postToApp('revision', {
            type: 'BRIDGE_REVISION_CMD',
            app: 'revision',
            cmd: 'add_subj:' + JSON.stringify({ name: data.name, topics: data.topics || [] }),
          });
        }
        return;
      }

      if (data.type === 'BRIDGE_SUBJ_SYNC') {
        if (data.app === 'revision' && readyAppsRef.current.planner) {
          postToApp('planner', data);
        }
        return;
      }

      if (data.type === 'BRIDGE_DECK_SNAPSHOT' && data.snapshot) {
        setDeckSnapshot(data.snapshot);
        return;
      }

      if (data.type === 'BRIDGE_STUDY_STATS') {
        latestStudyStatsRef.current = data.stats;
        if (readyAppsRef.current.planner) {
          postToApp('planner', {
            type: 'BRIDGE_STUDY_STATS',
            app: 'planner',
            stats: data.stats,
          });
        }
        return;
      }

      if (data.type === 'BRIDGE_NAV_APP') {
        if (data.target === 'cards') {
          setActiveTab('revision');
          setRevisionMode('cards');
          if (data.topic) {
            postToApp('revision', {
              type: 'BRIDGE_REVISION_CMD',
              app: 'revision',
              cmd: `topic:${data.topic}`,
            });
          }
          postToApp('revision', {
            type: 'BRIDGE_REVISION_CMD',
            app: 'revision',
            cmd: 'mode:cards',
          });
        } else if (data.target === 'study') {
          setActiveTab('revision');
          setRevisionMode('study');
          postToApp('revision', {
            type: 'BRIDGE_REVISION_CMD',
            app: 'revision',
            cmd: 'mode:study',
          });
        } else if (
          data.target === 'todo' ||
          data.target === 'calendar' ||
          data.target === 'subjects' ||
          data.target === 'progress'
        ) {
          setActiveTab('planner');
          setPlannerTab(data.target);
          postToApp('planner', {
            type: 'BRIDGE_PLANNER_CMD',
            app: 'planner',
            cmd: `tab:${data.target}`,
          });
        } else if (data.target === 'packs') {
          setActiveTab('packs');
        } else if (data.target === 'quiz' || data.target === 'ai') {
          setActiveTab('quiz');
        } else if (data.target === 'vault') {
          setVaultSection('account');
          setActiveTab('vault');
        }
        return;
      }

      if (data.type === 'BRIDGE_LOOK_SYNC') {
        const next = normalizeLook(data.look);
        setLook((prev) => (lookEqual(prev, next) ? prev : next));
        return;
      }

      if (data.type === 'BRIDGE_PLANNER_UI') {
        return;
      }

      if (data.type === 'BRIDGE_REVISION_STATE') {
        if (data.mode) setRevisionMode(data.mode);
        if (data.subj) setRevisionSubj(data.subj);
        if (data.subjName) setRevisionSubjName(data.subjName);
        return;
      }

      if (data.type === 'BRIDGE_PLANNER_STATE') {
        if (data.tab) setPlannerTab(data.tab);
        return;
      }

      if (data.type === 'BRIDGE_CURRENT_DATA') {
        const resolver = data.reqId ? pendingCurrentResolveRef.current.get(data.reqId) : undefined;
        if (resolver && data.reqId) {
          pendingCurrentResolveRef.current.delete(data.reqId);
          resolver(data.entries || {});
        }
        return;
      }

      if (data.type === 'BRIDGE_GUEST_DATA') {
        const resolver = pendingGuestResolveRef.current[data.app];
        if (resolver) {
          delete pendingGuestResolveRef.current[data.app];
          resolver(data.entries || {});
        }
        return;
      }

      if (data.type === 'PLANNER_TIMER') {
        setLiveTimer({
          active: data.active,
          running: data.running,
          text: data.text,
          mode: data.mode,
          subject: data.subject,
        });
        return;
      }

      if (data.type === 'BRIDGE_PATCH') {
        if (!firebaseUser || !account || !dek || data.uid !== firebaseUser.uid) return;
        setSyncState('syncing');
        try {
          const entries = Object.entries(data.patch || {});
          for (const [key, val] of entries) {
            if (val === null) {
              delete latestEntriesRef.current[data.app][key];
            } else {
              latestEntriesRef.current[data.app][key] = val;
            }
            await pushEncryptedSyncEntry({
              uid: firebaseUser.uid,
              dek,
              keyVersion: account.keyVersion,
              app: data.app,
              chunkKey: key,
              value: val,
            });
          }
          setSyncState('synced');
          postToApp(data.app, { type: 'BRIDGE_SYNC_STATUS', app: data.app, err: null });
        } catch (err) {
          console.error(err);
          setSyncState('error');
          postToApp(data.app, { type: 'BRIDGE_SYNC_STATUS', app: data.app, err: 'sync-error' });
        }
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [firebaseUser, account, dek, hydrateIframe, postToApp, look, accountStats]);

  const collectGuestEntries = useCallback(
    async (app: AppModule): Promise<Record<string, string>> => {
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          delete pendingGuestResolveRef.current[app];
          resolve({});
        }, 1200);
        pendingGuestResolveRef.current[app] = (entries) => {
          window.clearTimeout(timer);
          resolve(entries);
        };
        postToApp(app, { type: 'BRIDGE_EXPORT_GUEST', app });
      });
    },
    [postToApp]
  );

  const collectCurrentEntries = useCallback(
    async (app: AppModule): Promise<Record<string, string>> => {
      return new Promise((resolve) => {
        const reqId = `${app}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const timer = window.setTimeout(() => {
          pendingCurrentResolveRef.current.delete(reqId);
          resolve({});
        }, 1400);
        pendingCurrentResolveRef.current.set(reqId, (entries) => {
          window.clearTimeout(timer);
          resolve(entries);
        });
        postToApp(app, { type: 'BRIDGE_EXPORT_CURRENT', app, reqId });
      });
    },
    [postToApp]
  );

  const handleGetWorkspaceSnapshot = useCallback(async () => {
    const [revision, planner] = await Promise.all([
      collectCurrentEntries('revision'),
      collectCurrentEntries('planner'),
    ]);
    return { revision, planner };
  }, [collectCurrentEntries]);

  const handleImportWorkspaceData = useCallback(
    async (payload: {
      revision: Record<string, string>;
      planner: Record<string, string>;
      mode: 'merge' | 'replace';
    }) => {
      const hasRev = Object.keys(payload.revision || {}).length > 0;
      const hasPln = Object.keys(payload.planner || {}).length > 0;
      if (hasRev) {
        postToApp('revision', {
          type: 'BRIDGE_IMPORT_CURRENT',
          app: 'revision',
          entries: payload.revision,
          mode: payload.mode,
        });
      }
      if (hasPln) {
        postToApp('planner', {
          type: 'BRIDGE_IMPORT_CURRENT',
          app: 'planner',
          entries: payload.planner,
          mode: payload.mode,
        });
      }
      if (firebaseUser && account && dek) {
        await recordActivity(
          firebaseUser.uid,
          `Imported workspace backup (${payload.mode} mode)`
        );
      }
    },
    [postToApp, firebaseUser, account, dek]
  );

  const persistPacksToCloud = useCallback(
    async (nextCustom: StudyPack[], nextApplied: string[]) => {
      saveCustomPacksToLocal(nextCustom);
      saveAppliedPackIdsToLocal(nextApplied);
      if (!firebaseUser || !account || !dek) return;
      const customStr = JSON.stringify(nextCustom);
      const appliedStr = JSON.stringify(nextApplied);
      latestEntriesRef.current.revision['studydeck-packs'] = customStr;
      latestEntriesRef.current.revision['studydeck-applied-packs'] = appliedStr;
      setSyncState('syncing');
      try {
        await pushEncryptedSyncEntry({
          uid: firebaseUser.uid,
          dek,
          keyVersion: account.keyVersion,
          app: 'revision',
          chunkKey: 'studydeck-packs',
          value: customStr,
        });
        await pushEncryptedSyncEntry({
          uid: firebaseUser.uid,
          dek,
          keyVersion: account.keyVersion,
          app: 'revision',
          chunkKey: 'studydeck-applied-packs',
          value: appliedStr,
        });
        setSyncState('synced');
      } catch (err) {
        console.error(err);
        setSyncState('error');
      }
    },
    [firebaseUser, account, dek]
  );

  const handleApplyStudyPack = useCallback(
    async (pack: StudyPack) => {
      if (pack.revision) {
        postToApp('revision', {
          type: 'BRIDGE_APPLY_PACK',
          app: 'revision',
          packRevision: pack.revision,
        });
      }
      if (pack.planner) {
        postToApp('planner', {
          type: 'BRIDGE_APPLY_PACK',
          app: 'planner',
          packPlanner: pack.planner,
        });
      }
      const nextApplied = appliedPackIds.includes(pack.id)
        ? appliedPackIds
        : [...appliedPackIds, pack.id];
      setAppliedPackIds(nextApplied);
      await persistPacksToCloud(customPacks, nextApplied);
      if (firebaseUser && account && dek) {
        await recordActivity(firebaseUser.uid, `Applied Study Pack: ${pack.title}`);
      }
    },
    [postToApp, appliedPackIds, customPacks, persistPacksToCloud, firebaseUser, account, dek]
  );

  const handleSaveCustomPack = useCallback(
    async (pack: StudyPack) => {
      const visibility: 'public' | 'private' =
        pack.visibility === 'public' ? 'public' : 'private';
      const ownerId = pack.ownerId || firebaseUser?.uid;
      const ownerName = pack.ownerName || accountStats.displayName || 'StudyDeck User';

      if (visibility === 'public') {
        if (!firebaseUser || !firebaseUser.emailVerified) {
          throw new Error('Sign in with Google to publish a Public Study Pack file for all users.');
        }
        const enrichedPublic: StudyPack = {
          ...pack,
          visibility: 'public',
          ownerId: firebaseUser.uid,
          ownerName,
          author: ownerName,
        };
        await saveStudyPackToCloud(enrichedPublic, firebaseUser.uid, ownerName);
        await refreshPublicPackFiles();
        const exists = customPacks.some((p) => p.id === enrichedPublic.id);
        const nextCustom = exists
          ? customPacks.map((p) => (p.id === enrichedPublic.id ? enrichedPublic : p))
          : [enrichedPublic, ...customPacks];
        setCustomPacks(nextCustom);
        await persistPacksToCloud(nextCustom, appliedPackIds);
        if (account && dek) {
          await recordActivity(firebaseUser.uid, `Published Public Pack: ${enrichedPublic.title}`);
        }
        return;
      }

      const enrichedPrivate: StudyPack = {
        ...pack,
        visibility: 'private',
        ownerId,
        ownerName,
        author: ownerName,
      };
      await savePrivatePackFile(enrichedPrivate, firebaseUser?.uid, ownerName);
      const exists = customPacks.some((p) => p.id === enrichedPrivate.id);
      const nextCustom = exists
        ? customPacks.map((p) => (p.id === enrichedPrivate.id ? enrichedPrivate : p))
        : [enrichedPrivate, ...customPacks];
      setCustomPacks(nextCustom);
      await persistPacksToCloud(nextCustom, appliedPackIds);
    },
    [
      customPacks,
      appliedPackIds,
      persistPacksToCloud,
      firebaseUser,
      accountStats.displayName,
      account,
      dek,
      refreshPublicPackFiles,
    ]
  );

  const handleTogglePackVisibility = useCallback(
    async (pack: StudyPack, nextVisibility: 'public' | 'private') => {
      if (!firebaseUser || !firebaseUser.emailVerified) {
        throw new Error('Sign in with Google to change Study Pack visibility.');
      }
      const ownerName = pack.ownerName || accountStats.displayName || 'StudyDeck User';
      const updated: StudyPack = {
        ...pack,
        visibility: nextVisibility,
        ownerId: pack.ownerId || firebaseUser.uid,
        ownerName,
        author: ownerName,
      };
      if (nextVisibility === 'public') {
        await saveStudyPackToCloud(updated, firebaseUser.uid, ownerName);
      } else {
        await saveStudyPackToCloud(updated, firebaseUser.uid, ownerName);
      }
      await refreshPublicPackFiles();
      const exists = customPacks.some((p) => p.id === updated.id);
      const nextCustom = exists
        ? customPacks.map((p) => (p.id === updated.id ? updated : p))
        : [updated, ...customPacks];
      setCustomPacks(nextCustom);
      await persistPacksToCloud(nextCustom, appliedPackIds);
      if (account && dek) {
        await recordActivity(
          firebaseUser.uid,
          `Set pack "${updated.title}" to ${nextVisibility}`
        );
      }
    },
    [
      firebaseUser,
      accountStats.displayName,
      customPacks,
      appliedPackIds,
      persistPacksToCloud,
      account,
      dek,
      refreshPublicPackFiles,
    ]
  );

  const handleDeleteCustomPack = useCallback(
    async (packId: string) => {
      const target =
        customPacks.find((p) => p.id === packId) ||
        userCloudPacks.find((p) => p.id === packId) ||
        publicPacks.find((p) => p.id === packId) ||
        filePublicPacks.find((p) => p.id === packId);
      const isPublicPack =
        target?.visibility === 'public' ||
        publicPacks.some((p) => p.id === packId) ||
        filePublicPacks.some((p) => p.id === packId);

      if (isPublicPack) {
        if (!firebaseUser || !firebaseUser.emailVerified) {
          throw new Error('Sign in with Google to delete a Public Study Pack.');
        }
        await deleteStudyPackFromCloud(packId);
      } else {
        deleteLocalPackFile(packId);
        if (firebaseUser && userCloudPacks.some((p) => p.id === packId)) {
          try {
            await deleteStudyPackFromCloud(packId);
          } catch (err) {
            console.warn('Skipped Firestore delete for private pack:', err);
          }
        }
      }
      await refreshPublicPackFiles();
      setUserCloudPacks((prev) => prev.filter((p) => p.id !== packId));
      const nextCustom = customPacks.filter((p) => p.id !== packId);
      setCustomPacks(nextCustom);
      await persistPacksToCloud(nextCustom, appliedPackIds);
    },
    [
      customPacks,
      userCloudPacks,
      publicPacks,
      filePublicPacks,
      appliedPackIds,
      persistPacksToCloud,
      firebaseUser,
      refreshPublicPackFiles,
    ]
  );

  const mergedStudyPacks = useMemo(() => {
    const byId = new Map<string, StudyPack>();
    for (const p of userCloudPacks) {
      byId.set(p.id, { ...p, visibility: p.visibility || 'private' });
    }
    for (const p of customPacks) {
      byId.set(p.id, { ...p, visibility: p.visibility || 'private' });
    }
    for (const pub of filePublicPacks) {
      byId.set(pub.id, { ...pub, visibility: 'public' });
    }
    for (const pub of publicPacks) {
      byId.set(pub.id, { ...pub, visibility: 'public' });
    }
    return Array.from(byId.values()).sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
  }, [userCloudPacks, customPacks, filePublicPacks, publicPacks]);

  const handleResetWorkspace = useCallback(async () => {
    setCustomPacks([]);
    setAppliedPackIds([]);
    saveCustomPacksToLocal([]);
    saveAppliedPackIdsToLocal([]);
    setDeckSnapshot(EMPTY_DECK_SNAPSHOT);
    latestStudyStatsRef.current = null;

    postToApp('revision', { type: 'BRIDGE_RESET_EMPTY', app: 'revision' });
    postToApp('planner', { type: 'BRIDGE_RESET_EMPTY', app: 'planner' });

    if (firebaseUser && account && dek) {
      setSyncState('syncing');
      try {
        const revKeys = Object.keys(latestEntriesRef.current.revision);
        for (const k of revKeys) {
          if (k === 'look') continue;
          delete latestEntriesRef.current.revision[k];
          await pushEncryptedSyncEntry({
            uid: firebaseUser.uid,
            dek,
            keyVersion: account.keyVersion,
            app: 'revision',
            chunkKey: k,
            value: null,
          });
        }
        const plnKeys = Object.keys(latestEntriesRef.current.planner);
        for (const k of plnKeys) {
          delete latestEntriesRef.current.planner[k];
          await pushEncryptedSyncEntry({
            uid: firebaseUser.uid,
            dek,
            keyVersion: account.keyVersion,
            app: 'planner',
            chunkKey: k,
            value: null,
          });
        }
        await recordActivity(firebaseUser.uid, 'Cleared workspace data to empty starter state');
        setSyncState('synced');
      } catch (err) {
        console.error(err);
        setSyncState('error');
      }
    }
    setHasGuestData(false);
  }, [postToApp, firebaseUser, account, dek]);

  const importGuestIntoCloud = useCallback(
    async (uid: string, activeDek: CryptoKey, keyVersion: number) => {
      const [revGuest, plnGuest] = await Promise.all([
        collectGuestEntries('revision'),
        collectGuestEntries('planner'),
      ]);
      setSyncState('syncing');
      for (const [k, v] of Object.entries(revGuest)) {
        if (typeof v === 'string') {
          latestEntriesRef.current.revision[k] = v;
          await pushEncryptedSyncEntry({
            uid,
            dek: activeDek,
            keyVersion,
            app: 'revision',
            chunkKey: k,
            value: v,
          });
        }
      }
      for (const [k, v] of Object.entries(plnGuest)) {
        if (typeof v === 'string') {
          latestEntriesRef.current.planner[k] = v;
          await pushEncryptedSyncEntry({
            uid,
            dek: activeDek,
            keyVersion,
            app: 'planner',
            chunkKey: k,
            value: v,
          });
        }
      }
      await recordActivity(uid, 'Imported local browser data to encrypted cloud');
      setSyncState('synced');
    },
    [collectGuestEntries]
  );

  const handleSignInGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const handleSignOut = async () => {
    if (firebaseUser) {
      await clearTrustedDeviceKey(firebaseUser.uid);
    }
    resetSyncMemoryCache();
    hydratedAppsRef.current = { revision: false, planner: false };
    setDek(null);
    setAccount(null);
    setProfile(null);
    await signOut(auth);
    setAuthModalOpen(false);
    setVaultSection('account');
    if (activeTab === 'admin') setActiveTab('planner');
  };

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
    hydratedAppsRef.current = { revision: false, planner: false };
    setDek(null);
    setProfile(null);
    postToApp('revision', { type: 'BRIDGE_SIGNOUT', app: 'revision' });
    postToApp('planner', { type: 'BRIDGE_SIGNOUT', app: 'planner' });
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
    for (const [k, v] of Object.entries(latestEntriesRef.current.revision)) {
      await pushEncryptedSyncEntry({
        uid: firebaseUser.uid,
        dek,
        keyVersion: account.keyVersion,
        app: 'revision',
        chunkKey: k,
        value: v,
      });
    }
    for (const [k, v] of Object.entries(latestEntriesRef.current.planner)) {
      await pushEncryptedSyncEntry({
        uid: firebaseUser.uid,
        dek,
        keyVersion: account.keyVersion,
        app: 'planner',
        chunkKey: k,
        value: v,
      });
    }
    setSyncState('synced');
  };

  const handleImportGuestNow = async () => {
    if (!firebaseUser || !account || !dek) return;
    await importGuestIntoCloud(firebaseUser.uid, dek, account.keyVersion);
    hydrateIframe('revision', firebaseUser.uid, latestEntriesRef.current.revision);
    hydrateIframe('planner', firebaseUser.uid, latestEntriesRef.current.planner);
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

  const handleSelectRevisionMode = (mode: string) => {
    setActiveTab('revision');
    setRevisionMode(mode);
    postToApp('revision', { type: 'BRIDGE_REVISION_CMD', app: 'revision', cmd: `mode:${mode}` });
  };

  const handleSelectPlannerTab = (tab: string) => {
    setActiveTab('planner');
    setPlannerTab(tab);
    postToApp('planner', { type: 'BRIDGE_PLANNER_CMD', app: 'planner', cmd: `tab:${tab}` });
  };

  const handleSelectWorkspace = (tab: WorkspaceTab) => {
    if (tab === 'admin') {
      setVaultSection('admin');
      setActiveTab('vault');
      return;
    }
    if (tab === 'vault') {
      setVaultSection('account');
    }
    setActiveTab(tab);
  };

  const handleOpenRevisionCards = () => {
    setActiveTab('revision');
    setRevisionMode('cards');
    postToApp('revision', { type: 'BRIDGE_REVISION_CMD', app: 'revision', cmd: 'open_cards' });
  };

  const handleOpenPlannerOptions = () => {
    setActiveTab('planner');
    setPlannerTab('set');
    postToApp('planner', { type: 'BRIDGE_PLANNER_CMD', app: 'planner', cmd: 'open_set' });
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      <Sidebar
        activeTab={activeTab}
        revisionMode={revisionMode}
        plannerTab={plannerTab}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        onToggleCollapse={handleToggleSidebarCollapse}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onSelectRevisionMode={handleSelectRevisionMode}
        onSelectPlannerTab={handleSelectPlannerTab}
        onSelectWorkspace={handleSelectWorkspace}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          activeTab={activeTab}
          revisionMode={revisionMode}
          revisionSubj={revisionSubj}
          revisionSubjName={revisionSubjName}
          plannerTab={plannerTab}
          onSelectTab={handleSelectWorkspace}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
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
        {/* Both apps remain mounted so background timers and sessions stay live */}
        <iframe
          ref={revisionRef}
          src="/apps/revision.html"
          title="Revision: History and Geography"
          className={activeTab === 'revision' ? 'block h-full w-full border-0' : 'hidden'}
        />
        <iframe
          ref={plannerRef}
          src="/apps/planner.html"
          title="Mock Revision Planner"
          className={activeTab === 'planner' ? 'block h-full w-full border-0' : 'hidden'}
        />

        {(activeTab === 'vault' || activeTab === 'admin') && (
          <ProfileVaultView
            firebaseUser={firebaseUser}
            account={account}
            vaultUnlocked={vaultUnlocked}
            profile={profile}
            devices={devices}
            activity={activity}
            chunkCount={chunkCount}
            syncState={syncState}
            hasGuestData={hasGuestData}
            deckSnapshot={deckSnapshot}
            initialSection={activeTab === 'admin' ? 'admin' : vaultSection}
            onOpenAuth={() => setAuthModalOpen(true)}
            onSignOut={handleSignOut}
            onLockVault={handleLockVault}
            onSaveProfile={handleSaveProfile}
            onRotatePassphrase={handleRotatePassphrase}
            onForceSync={handleForceSync}
            onImportGuestData={handleImportGuestNow}
            onRemoveDevice={handleRemoveDevice}
            onDeviceRenamed={handleDeviceRenamed}
            onOpenCustomize={() => setCustomizeOpen(true)}
            onOpenRevisionCards={handleOpenRevisionCards}
            onOpenPlannerOptions={handleOpenPlannerOptions}
            onGetWorkspaceSnapshot={handleGetWorkspaceSnapshot}
            onImportWorkspaceData={handleImportWorkspaceData}
            onApplyImportedPack={handleApplyStudyPack}
            onResetWorkspace={handleResetWorkspace}
          />
        )}

        {activeTab === 'packs' && (
          <StudyPacksView
            deckSnapshot={deckSnapshot}
            customPacks={mergedStudyPacks}
            appliedPackIds={appliedPackIds}
            currentUserUid={firebaseUser?.uid || null}
            isSignedInVerified={Boolean(firebaseUser?.emailVerified)}
            isAdmin={Boolean(
              account?.role === 'admin' ||
                (firebaseUser?.emailVerified &&
                  firebaseUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL)
            )}
            onOpenAuth={() => setAuthModalOpen(true)}
            onApplyPack={handleApplyStudyPack}
            onSaveCustomPack={handleSaveCustomPack}
            onTogglePackVisibility={handleTogglePackVisibility}
            onDeleteCustomPack={handleDeleteCustomPack}
            onGetWorkspaceSnapshot={handleGetWorkspaceSnapshot}
            onOpenFlashcards={() => handleSelectRevisionMode('cards')}
            onOpenStudyNotes={() => handleSelectRevisionMode('study')}
            onOpenSubjects={() => handleSelectPlannerTab('subjects')}
          />
        )}

        {activeTab === 'quiz' && (
          <LiveQuizView
            deckSnapshot={deckSnapshot}
            defaultNickname={accountStats.displayName}
            onRequestDecks={() =>
              postToApp('revision', {
                type: 'BRIDGE_REVISION_CMD',
                app: 'revision',
                cmd: 'req_decks',
              })
            }
          />
        )}
        </main>
      </div>

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
        vaultUnlocked={vaultUnlocked}
        hasGuestData={hasGuestData}
        onSignInGoogle={handleSignInGoogle}
        onSignOut={handleSignOut}
        onCreateVault={handleCreateVault}
        onUnlockWithPassphrase={handleUnlockWithPassphrase}
        onUnlockWithRecovery={handleUnlockWithRecovery}
      />
    </div>
  );
}

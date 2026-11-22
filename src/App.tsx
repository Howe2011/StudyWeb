import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import { AuthVaultModal } from './components/AuthVaultModal';
import { CalendarView } from './components/CalendarView';
import { CommunityTypeFilter, CommunityView } from './components/CommunityView';
import { CustomizeModal } from './components/CustomizeModal';
import { FlashcardsView } from './components/FlashcardsView';
import { FloatingStopwatchTab } from './components/FloatingStopwatchTab';
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
  fetchUserSharedItems,
  updateCommunityAuthorName,
  updateSharedItem,
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
  SharedFlashcardLink,
  SharedStudyItem,
  StopwatchState,
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

const VALID_PALETTES = new Set([
  '',
  'paper',
  'sage',
  'contrast',
  'ocean',
  'lavender',
  'rose',
  'sand',
  'nord',
  'emerald',
  'custom',
]);

const DEFAULT_CUSTOM_THEME = {
  bg: '#F2F4F7',
  card: '#FFFFFF',
  ink: '#17202E',
  accent: '#2F5F8A',
  line: '#CBD2DC',
};

function sanitizeHex(val: unknown, fallback: string): string {
  const s = typeof val === 'string' ? val.trim() : '';
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : fallback;
}

function isHexDark(hex: string): boolean {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return false;
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45;
}

function mixHexColors(hexA: string, hexB: string, weightA = 0.65): string {
  const parse = (h: string) => {
    const clean = h.replace('#', '');
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  };
  const [r1, g1, b1] = parse(sanitizeHex(hexA, '#17202E'));
  const [r2, g2, b2] = parse(sanitizeHex(hexB, '#FFFFFF'));
  const r = Math.round(r1 * weightA + r2 * (1 - weightA));
  const g = Math.round(g1 * weightA + g2 * (1 - weightA));
  const b = Math.round(b1 * weightA + b2 * (1 - weightA));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function normalizeLook(raw: Partial<AppearanceSettings> | null | undefined): AppearanceSettings {
  const th = raw?.th === 'light' || raw?.th === 'dark' ? raw.th : '';
  const pal =
    typeof raw?.pal === 'string' && VALID_PALETTES.has(raw.pal)
      ? (raw.pal as AppearanceSettings['pal'])
      : '';
  const zm = typeof raw?.zm === 'number' && raw.zm >= 85 && raw.zm <= 150 ? raw.zm : 100;
  const lh = typeof raw?.lh === 'number' && raw.lh >= 12 && raw.lh <= 24 ? raw.lh : 14;
  const mw = typeof raw?.mw === 'string' ? raw.mw : '';
  const ff = typeof raw?.ff === 'string' ? raw.ff : '';
  const customTheme = raw?.customTheme
    ? {
        bg: sanitizeHex(raw.customTheme.bg, DEFAULT_CUSTOM_THEME.bg),
        card: sanitizeHex(raw.customTheme.card, DEFAULT_CUSTOM_THEME.card),
        ink: sanitizeHex(raw.customTheme.ink, DEFAULT_CUSTOM_THEME.ink),
        accent: sanitizeHex(raw.customTheme.accent, DEFAULT_CUSTOM_THEME.accent),
        line: sanitizeHex(raw.customTheme.line, DEFAULT_CUSTOM_THEME.line),
      }
    : undefined;
  const savedThemes = Array.isArray(raw?.savedThemes)
    ? raw.savedThemes
        .filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && t.tokens)
        .slice(0, 12)
        .map((t) => ({
          id: t.id,
          name: t.name.trim().slice(0, 36) || 'Custom Theme',
          tokens: {
            bg: sanitizeHex(t.tokens.bg, DEFAULT_CUSTOM_THEME.bg),
            card: sanitizeHex(t.tokens.card, DEFAULT_CUSTOM_THEME.card),
            ink: sanitizeHex(t.tokens.ink, DEFAULT_CUSTOM_THEME.ink),
            accent: sanitizeHex(t.tokens.accent, DEFAULT_CUSTOM_THEME.accent),
            line: sanitizeHex(t.tokens.line, DEFAULT_CUSTOM_THEME.line),
          },
        }))
    : undefined;

  return {
    th,
    pal,
    zm,
    lh,
    mw,
    ff,
    ...(customTheme ? { customTheme } : {}),
    ...(savedThemes && savedThemes.length ? { savedThemes } : {}),
  };
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
  const [userSharedItems, setUserSharedItems] = useState<SharedStudyItem[]>([]);
  const [userSharedLoadedUid, setUserSharedLoadedUid] = useState<string | null>(null);

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

  // Global persistent Stopwatch (follows user across all tabs)
  const [swState, setSwState] = useState<{
    running: boolean;
    accumulatedMs: number;
    startedAtMs: number | null;
    subjectId?: string;
    subjectName: string;
    topicId?: string;
    topicName?: string;
    laps: number[];
    dismissed: boolean;
  }>(() => {
    try {
      const raw = localStorage.getItem('studydeck_stopwatch_v1');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{
          running: boolean;
          accumulatedMs: number;
          startedAtMs: number | null;
          subjectId?: string;
          subjectName: string;
          topicId?: string;
          topicName?: string;
          laps: number[];
          dismissed: boolean;
        }>;
        return {
          running: Boolean(parsed.running && typeof parsed.startedAtMs === 'number'),
          accumulatedMs: Number(parsed.accumulatedMs) || 0,
          startedAtMs:
            parsed.running && typeof parsed.startedAtMs === 'number' ? parsed.startedAtMs : null,
          subjectId: typeof parsed.subjectId === 'string' ? parsed.subjectId : undefined,
          subjectName:
            typeof parsed.subjectName === 'string' && parsed.subjectName.trim()
              ? parsed.subjectName
              : 'General Study',
          topicId: typeof parsed.topicId === 'string' ? parsed.topicId : undefined,
          topicName: typeof parsed.topicName === 'string' ? parsed.topicName : undefined,
          laps: Array.isArray(parsed.laps) ? parsed.laps.map(Number).filter(Number.isFinite) : [],
          dismissed: Boolean(parsed.dismissed),
        };
      }
    } catch {
      // ignore storage read error
    }
    return {
      running: false,
      accumulatedMs: 0,
      startedAtMs: null,
      subjectName: 'General Study',
      laps: [],
      dismissed: false,
    };
  });
  const [swNowMs, setSwNowMs] = useState<number>(() => Date.now());
  const [swToast, setSwToast] = useState<string | null>(null);
  const [plannerTimerMode, setPlannerTimerMode] = useState<'timer' | 'pomo' | 'stopwatch'>('timer');

  const cloudHydratedRef = useRef<boolean>(false);
  const syncTimerRef = useRef<number | null>(null);
  const latestWorkspaceRef = useRef<WorkspaceData>(workspace);
  latestWorkspaceRef.current = workspace;

  // Keep selectedSubjectId valid (preserve 'ALL' for All Subjects view in Flashcards)
  useEffect(() => {
    if (workspace.subjects.length === 0) {
      if (selectedSubjectId && selectedSubjectId !== 'ALL') setSelectedSubjectId('');
      return;
    }
    if (
      selectedSubjectId !== 'ALL' &&
      !workspace.subjects.some((s) => s.id === selectedSubjectId)
    ) {
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

      if (look.pal === 'custom' && look.customTheme) {
        const ct = look.customTheme;
        const wantsDark = look.th === 'dark' || (look.th === '' && mq.matches);
        const activeTokens = wantsDark
          ? (ct.dark || (isHexDark(ct.bg) ? ct : undefined) || ct)
          : (ct.light || (!isHexDark(ct.bg) ? ct : undefined) || ct);

        const customDark = isHexDark(activeTokens.bg);
        root.style.setProperty('--bg', activeTokens.bg);
        root.style.setProperty('--card', activeTokens.card);
        root.style.setProperty('--ink', activeTokens.ink);
        root.style.setProperty('--mute', mixHexColors(activeTokens.ink, activeTokens.card, 0.62));
        root.style.setProperty('--line', activeTokens.line);
        root.style.setProperty('--e3', activeTokens.accent);
        root.style.setProperty('color-scheme', customDark ? 'dark' : 'light');
        if (customDark) {
          root.setAttribute('data-theme', 'dark');
          root.classList.add('dark');
        } else {
          root.setAttribute('data-theme', 'light');
          root.classList.remove('dark');
        }
      } else {
        root.style.removeProperty('--bg');
        root.style.removeProperty('--card');
        root.style.removeProperty('--ink');
        root.style.removeProperty('--mute');
        root.style.removeProperty('--line');
        root.style.removeProperty('--e3');
        root.style.removeProperty('color-scheme');
      }

      if (look.mw) root.style.setProperty('--mw', look.mw);
      else root.style.removeProperty('--mw');

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

  // Global Stopwatch tick & persistence
  useEffect(() => {
    try {
      localStorage.setItem('studydeck_stopwatch_v1', JSON.stringify(swState));
    } catch {
      // ignore
    }
  }, [swState]);

  useEffect(() => {
    if (!swState.running) return;
    setSwNowMs(Date.now());
    const id = window.setInterval(() => {
      setSwNowMs(Date.now());
    }, 250);
    return () => window.clearInterval(id);
  }, [swState.running]);

  const stopwatch: StopwatchState = useMemo(() => {
    const activeMs =
      swState.running && swState.startedAtMs
        ? Math.max(0, swNowMs - swState.startedAtMs)
        : 0;
    const elapsedSec = Math.max(0, Math.floor((swState.accumulatedMs + activeMs) / 1000));
    const hrs = Math.floor(elapsedSec / 3600);
    const mins = Math.floor((elapsedSec % 3600) / 60);
    const secs = elapsedSec % 60;
    const text =
      hrs > 0
        ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
        : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return {
      running: swState.running,
      elapsedSec,
      text,
      subjectId: swState.subjectId,
      subjectName: swState.subjectName,
      topicId: swState.topicId,
      topicName: swState.topicName,
      laps: swState.laps,
      dismissed: swState.dismissed,
    };
  }, [swState, swNowMs]);

  const handleToggleStopwatch = useCallback(() => {
    const now = Date.now();
    setSwNowMs(now);
    setSwState((prev) => {
      if (prev.running) {
        const delta = prev.startedAtMs ? Math.max(0, now - prev.startedAtMs) : 0;
        return {
          ...prev,
          running: false,
          accumulatedMs: prev.accumulatedMs + delta,
          startedAtMs: null,
          dismissed: false,
        };
      }
      return {
        ...prev,
        running: true,
        startedAtMs: now,
        dismissed: false,
      };
    });
  }, []);

  const handleStartStopwatch = useCallback(
    (ctx: { subjectId?: string; subjectName?: string; topicId?: string; topicName?: string }) => {
      const now = Date.now();
      setSwNowMs(now);
      setSwState((prev) => {
        const nextSubjName = (ctx.subjectName || 'General Study').trim() || 'General Study';
        const sameContext =
          (ctx.subjectId || '') === (prev.subjectId || '') &&
          (ctx.topicId || '') === (prev.topicId || '');

        if (sameContext) {
          if (prev.running) {
            const delta = prev.startedAtMs ? Math.max(0, now - prev.startedAtMs) : 0;
            return {
              ...prev,
              running: false,
              accumulatedMs: prev.accumulatedMs + delta,
              startedAtMs: null,
              dismissed: false,
            };
          }
          return {
            ...prev,
            running: true,
            startedAtMs: now,
            dismissed: false,
          };
        }

        // If stopwatch is already running for the same subject without a specific topic, attach the chosen topic seamlessly
        if (
          prev.running &&
          ctx.topicId &&
          !prev.topicId &&
          ctx.subjectId &&
          ctx.subjectId === prev.subjectId
        ) {
          return {
            ...prev,
            topicId: ctx.topicId,
            topicName: ctx.topicName,
            dismissed: false,
          };
        }

        return {
          running: true,
          accumulatedMs: 0,
          startedAtMs: now,
          subjectId: ctx.subjectId,
          subjectName: nextSubjName,
          topicId: ctx.topicId,
          topicName: ctx.topicName,
          laps: [],
          dismissed: false,
        };
      });
    },
    []
  );

  const handleLapStopwatch = useCallback(() => {
    const now = Date.now();
    setSwState((prev) => {
      const activeMs = prev.running && prev.startedAtMs ? Math.max(0, now - prev.startedAtMs) : 0;
      const sec = Math.floor((prev.accumulatedMs + activeMs) / 1000);
      if (!prev.running && sec === 0) return prev;
      return { ...prev, laps: [sec, ...prev.laps] };
    });
  }, []);

  const handleResetStopwatch = useCallback(() => {
    setSwState((prev) => ({
      ...prev,
      running: false,
      accumulatedMs: 0,
      startedAtMs: null,
      laps: [],
      dismissed: false,
    }));
  }, []);

  const handleStopAndLogStopwatch = useCallback((): number => {
    const now = Date.now();
    const activeMs =
      swState.running && swState.startedAtMs ? Math.max(0, now - swState.startedAtMs) : 0;
    const totalSec = Math.floor((swState.accumulatedMs + activeMs) / 1000);
    const loggedMins = totalSec >= 30 ? Math.max(1, Math.round(totalSec / 60)) : 0;
    if (loggedMins > 0) {
      updateWorkspace((ws) => addLoggedStudyMinutes(ws, loggedMins));
      setSwToast(`Logged +${loggedMins}m to your study streak!`);
      window.setTimeout(() => setSwToast(null), 2800);
    }
    setSwState((prev) => ({
      ...prev,
      running: false,
      accumulatedMs: 0,
      startedAtMs: null,
      laps: [],
      dismissed: false,
    }));
    return loggedMins;
  }, [swState.running, swState.startedAtMs, swState.accumulatedMs, updateWorkspace]);

  const handleDismissStopwatch = useCallback(() => {
    const now = Date.now();
    setSwState((prev) => {
      const delta = prev.running && prev.startedAtMs ? Math.max(0, now - prev.startedAtMs) : 0;
      return {
        ...prev,
        running: false,
        accumulatedMs: prev.accumulatedMs + delta,
        startedAtMs: null,
        dismissed: true,
      };
    });
  }, []);

  const handleChangeStopwatchSubject = useCallback((subjectName: string, subjectId?: string) => {
    setSwState((prev) => {
      const cleanName = subjectName.trim() || 'General Study';
      const subjectChanged = cleanName !== prev.subjectName || subjectId !== prev.subjectId;
      return {
        ...prev,
        subjectName: cleanName,
        subjectId,
        ...(subjectChanged ? { topicId: undefined, topicName: undefined } : {}),
      };
    });
  }, []);

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
            ...(c.topicId && topicNameMap.get(c.topicId)
              ? { topicName: topicNameMap.get(c.topicId) }
              : {}),
            sectionName: c.sectionName || 'Core Deck',
            q: c.q,
            a: c.a,
          })),
        },
      });
    },
    [workspace]
  );

  useEffect(() => {
    const uid = firebaseUser?.uid;
    if (!uid) {
      setUserSharedItems([]);
      setUserSharedLoadedUid(null);
      return;
    }
    let cancelled = false;
    void fetchUserSharedItems(uid)
      .then((items) => {
        if (!cancelled) {
          setUserSharedItems(items);
          setUserSharedLoadedUid(uid);
        }
      })
      .catch(() => {
        // Non-fatal background lookup for shared link status
      });
    return () => {
      cancelled = true;
    };
  }, [firebaseUser?.uid]);

  const sharedNoteByTopicId = useMemo(() => {
    const map = new Map<string, SharedStudyItem>();
    if (!firebaseUser) return map;

    const byShareId = new Map(userSharedItems.map((item) => [item.id, item]));
    const loadedForUser = userSharedLoadedUid === firebaseUser.uid;

    for (const item of userSharedItems) {
      if (item.type === 'notes' && item.notesPayload?.topicOldId) {
        if (!map.has(item.notesPayload.topicOldId)) {
          map.set(item.notesPayload.topicOldId, item);
        }
      }
    }

    for (const topic of workspace.topics) {
      if (!topic.sharedRef?.shareId) continue;
      const remote = byShareId.get(topic.sharedRef.shareId);
      if (remote) {
        map.set(topic.id, remote);
      } else if (!loadedForUser) {
        // Optimistic fallback before remote list finishes loading
        map.set(topic.id, {
          id: topic.sharedRef.shareId,
          shareCode: topic.sharedRef.shareCode,
          type: 'notes',
          title: topic.sharedRef.title || topic.name,
          subjectName:
            workspace.subjects.find((s) => s.id === topic.subjectId)?.name || 'Subject',
          examBoard:
            workspace.subjects.find((s) => s.id === topic.subjectId)?.examBoard || 'Revision',
          summary: topic.notes.summary || '',
          visibility: topic.sharedRef.visibility,
          ownerId: firebaseUser.uid,
          ownerName: accountDisplayName,
          itemCount: Math.max(
            1,
            topic.notes.sections.reduce((acc, s) => acc + s.points.length, 0) +
              topic.notes.keyTerms.length
          ),
          copyCount: 0,
          createdAt: topic.sharedRef.lastPublishedAt,
          updatedAt: topic.sharedRef.lastPublishedAt,
        });
      }
    }
    return map;
  }, [
    firebaseUser,
    userSharedItems,
    userSharedLoadedUid,
    workspace.topics,
    workspace.subjects,
    accountDisplayName,
  ]);

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
      const existingShare = sharedNoteByTopicId.get(topic.id);

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
        existingShare,
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
    [workspace, sharedNoteByTopicId]
  );

  const handlePublishTopicChanges = useCallback(
    async (
      topicId: string
    ): Promise<{ ok: boolean; shareCode?: string; error?: string }> => {
      if (!firebaseUser) {
        setAuthModalOpen(true);
        return { ok: false, error: 'Sign in with Google to publish changes.' };
      }

      const topic = workspace.topics.find((t) => t.id === topicId);
      const subj = topic
        ? workspace.subjects.find((s) => s.id === topic.subjectId)
        : undefined;
      const existingShare = topic ? sharedNoteByTopicId.get(topic.id) : undefined;

      if (!topic || !subj || !existingShare) {
        if (subj && topic) handleShareTopic(subj.id, topic.id);
        return { ok: false, error: 'No existing share link found for this note.' };
      }

      const countTopicItems = (t: StudyTopic) =>
        Math.max(
          1,
          t.notes.sections.reduce((acc, s) => acc + s.points.length, 0) +
            t.notes.keyTerms.length
        );

      const subjTree = buildTopicTreeList(
        workspace.topics.filter((t) => t.subjectId === subj.id)
      );
      const rootIdx = subjTree.findIndex((n) => n.topic.id === topic.id);
      const descendantTopics: StudyTopic[] = [];
      if (rootIdx !== -1) {
        const rootDepth = subjTree[rootIdx].depth;
        for (let i = rootIdx + 1; i < subjTree.length; i++) {
          if (subjTree[i].depth <= rootDepth) break;
          descendantTopics.push(subjTree[i].topic);
        }
      }

      const prevSubIds = new Set(
        topic.sharedRef?.includedSubTopicIds ||
          (existingShare.notesPayload?.subTopics || [])
            .map((st) => st.oldId)
            .filter(Boolean)
      );
      const includedSubs =
        prevSubIds.size > 0
          ? descendantTopics.filter((dt) => prevSubIds.has(dt.id))
          : [];

      const totalItemCount =
        countTopicItems(topic) +
        includedSubs.reduce((sum, st) => sum + countTopicItems(st), 0);

      const nextTitle = (existingShare.title || topic.name).trim() || topic.name;
      const nextSummary =
        (topic.notes.summary || '').trim() ||
        existingShare.summary ||
        `Structured revision notes for ${subj.name}: ${topic.name}.`;

      try {
        const updated = await updateSharedItem({
          id: existingShare.id,
          uid: firebaseUser.uid,
          ownerName: accountDisplayName,
          type: 'notes',
          shareCode: existingShare.shareCode,
          createdAt: existingShare.createdAt,
          copyCount: existingShare.copyCount,
          title: nextTitle,
          subjectName: subj.name,
          examBoard: subj.examBoard,
          summary: nextSummary,
          visibility: existingShare.visibility,
          itemCount: totalItemCount,
          notesPayload: {
            topicName: topic.name,
            topicOldId: topic.id,
            specCode: topic.specCode,
            notes: topic.notes,
            timelineEvents: topic.timelineEvents,
            subTopics:
              includedSubs.length > 0
                ? includedSubs.map((st) => ({
                    oldId: st.id,
                    parentOldId: st.parentTopicId,
                    topicName: st.name,
                    specCode: st.specCode,
                    tags: st.tags,
                    notes: st.notes,
                    timelineEvents: st.timelineEvents,
                  }))
                : undefined,
          },
        });

        clearCommunityCache();
        setUserSharedItems((prev) => [
          updated,
          ...prev.filter((item) => item.id !== updated.id),
        ]);
        updateWorkspace((prev) => ({
          ...prev,
          topics: prev.topics.map((t) =>
            t.id === topic.id
              ? {
                  ...t,
                  sharedRef: {
                    shareId: updated.id,
                    shareCode: updated.shareCode,
                    title: updated.title,
                    visibility: updated.visibility,
                    lastPublishedAt: updated.updatedAt,
                    includedSubTopicIds: includedSubs.map((st) => st.id),
                  },
                }
              : t
          ),
        }));
        return { ok: true, shareCode: updated.shareCode };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unable to publish changes right now.',
        };
      }
    },
    [
      firebaseUser,
      workspace.topics,
      workspace.subjects,
      sharedNoteByTopicId,
      accountDisplayName,
      handleShareTopic,
      updateWorkspace,
    ]
  );

  const buildFlashcardScopeKey = useCallback(
    (subjectId: string, sectionName = 'ALL', topicId?: string): string => {
      if (topicId && topicId !== 'ALL' && topicId !== '__unlinked__') {
        return `topic::${topicId}`;
      }
      if (sectionName && sectionName !== 'ALL') {
        return `section::${subjectId}::${sectionName.trim().toLowerCase()}`;
      }
      return `subject::${subjectId}`;
    },
    []
  );

  const findExistingDeckShare = useCallback(
    (subjectId: string, sectionName = 'ALL', topicId?: string): SharedStudyItem | null => {
      if (!firebaseUser) return null;
      const explicitTopic =
        topicId && topicId !== 'ALL' && topicId !== '__unlinked__'
          ? workspace.topics.find((t) => t.id === topicId)
          : undefined;
      const resolvedSubjId =
        subjectId && subjectId !== 'ALL'
          ? subjectId
          : explicitTopic?.subjectId ||
            workspace.flashcards[0]?.subjectId ||
            workspace.subjects[0]?.id ||
            '';
      if (!resolvedSubjId) return null;

      const scopeKey = buildFlashcardScopeKey(resolvedSubjId, sectionName, topicId);
      const savedRef = (workspace.sharedFlashcardRefs || []).find(
        (r) => r.scopeKey === scopeKey
      );
      const byShareId = new Map(userSharedItems.map((i) => [i.id, i]));
      const loadedForUser = userSharedLoadedUid === firebaseUser.uid;

      if (savedRef) {
        const remote = byShareId.get(savedRef.shareId);
        if (remote) return remote;
        if (!loadedForUser) {
          const subjObj = workspace.subjects.find((s) => s.id === resolvedSubjId);
          return {
            id: savedRef.shareId,
            shareCode: savedRef.shareCode,
            type: 'flashcards',
            title: savedRef.title || `${subjObj?.name || 'Flashcard'} Deck`,
            subjectName: subjObj?.name || 'Subject',
            examBoard: subjObj?.examBoard || 'Revision',
            summary: '',
            visibility: savedRef.visibility,
            ownerId: firebaseUser.uid,
            ownerName: accountDisplayName,
            itemCount: 1,
            copyCount: 0,
            createdAt: savedRef.lastPublishedAt,
            updatedAt: savedRef.lastPublishedAt,
          };
        }
      }

      const subj = workspace.subjects.find((s) => s.id === resolvedSubjId);
      if (!subj) return null;
      const subjNameLower = subj.name.trim().toLowerCase();

      if (explicitTopic) {
        const topicLower = explicitTopic.name.trim().toLowerCase();
        return (
          userSharedItems.find(
            (i) =>
              i.type === 'flashcards' &&
              i.subjectName.trim().toLowerCase() === subjNameLower &&
              (i.flashcardsPayload?.sectionName || '').trim().toLowerCase() === topicLower
          ) || null
        );
      }

      if (sectionName && sectionName !== 'ALL') {
        const secLower = sectionName.trim().toLowerCase();
        return (
          userSharedItems.find(
            (i) =>
              i.type === 'flashcards' &&
              i.subjectName.trim().toLowerCase() === subjNameLower &&
              (i.flashcardsPayload?.sectionName || '').trim().toLowerCase() === secLower
          ) || null
        );
      }

      return (
        userSharedItems.find(
          (i) =>
            i.type === 'flashcards' &&
            i.subjectName.trim().toLowerCase() === subjNameLower &&
            (!i.flashcardsPayload?.sectionName ||
              i.flashcardsPayload.sectionName.trim().toLowerCase() ===
                `${subjNameLower} flashcards`)
        ) || null
      );
    },
    [
      firebaseUser,
      workspace.topics,
      workspace.flashcards,
      workspace.subjects,
      workspace.sharedFlashcardRefs,
      userSharedItems,
      userSharedLoadedUid,
      accountDisplayName,
      buildFlashcardScopeKey,
    ]
  );

  const handleShareDeck = useCallback(
    (subjectId: string, sectionName: string, initialTopicId?: string) => {
      const explicitTopic =
        initialTopicId && initialTopicId !== 'ALL' && initialTopicId !== '__unlinked__'
          ? workspace.topics.find((t) => t.id === initialTopicId)
          : undefined;
      const targetSubjId =
        subjectId && subjectId !== 'ALL'
          ? subjectId
          : explicitTopic?.subjectId ||
            workspace.flashcards[0]?.subjectId ||
            workspace.subjects[0]?.id ||
            '';
      const subj = workspace.subjects.find((s) => s.id === targetSubjId);
      if (!subj) return;

      const allSubjCards = workspace.flashcards.filter(
        (c) =>
          c.subjectId === subj.id &&
          (sectionName === 'ALL' || (c.sectionName || 'Core Deck') === sectionName)
      );
      if (allSubjCards.length === 0) return;

      const subjTopics = workspace.topics.filter((t) => t.subjectId === subj.id);
      const topicMap = new Map(subjTopics.map((t) => [t.id, t]));
      const grouped = new Map<
        string,
        {
          topicId: string;
          topicName: string;
          cards: Array<{ q: string; a: string; sectionName?: string }>;
        }
      >();

      for (const c of allSubjCards) {
        const matchedTopic = c.topicId ? topicMap.get(c.topicId) : undefined;
        const secLabel = (c.sectionName || 'Core Deck').trim() || 'Core Deck';
        const optId = matchedTopic ? matchedTopic.id : `sec::${secLabel.toLowerCase()}`;
        const optName = matchedTopic ? matchedTopic.name : secLabel;
        const existing = grouped.get(optId);
        const payloadCard = { q: c.q, a: c.a, sectionName: c.sectionName };
        if (existing) {
          existing.cards.push(payloadCard);
        } else {
          grouped.set(optId, {
            topicId: optId,
            topicName: optName,
            cards: [payloadCard],
          });
        }
      }

      const orderedTopicOptions = Array.from(grouped.values()).sort((a, b) =>
        a.topicName.localeCompare(b.topicName)
      );

      const resolvedInitTopic =
        initialTopicId && initialTopicId !== 'ALL' && grouped.has(initialTopicId)
          ? initialTopicId
          : 'ALL';
      const initialCards =
        resolvedInitTopic !== 'ALL'
          ? grouped.get(resolvedInitTopic)?.cards || allSubjCards
          : allSubjCards;
      const initialTopicName =
        resolvedInitTopic !== 'ALL' ? grouped.get(resolvedInitTopic)?.topicName : undefined;
      const label =
        initialTopicName
          ? `${initialTopicName} Flashcards`
          : sectionName === 'ALL'
          ? `${subj.name} Flashcards`
          : sectionName;

      const scopeKey = buildFlashcardScopeKey(subj.id, sectionName, resolvedInitTopic);
      const existingShare = findExistingDeckShare(subj.id, sectionName, resolvedInitTopic);

      setShareTarget({
        type: 'flashcards',
        defaultTitle: label,
        subjectName: subj.name,
        examBoard: subj.examBoard,
        defaultSummary: `${initialCards.length} active-recall flashcards for ${
          initialTopicName ? `${initialTopicName} (${subj.name})` : subj.name
        }.`,
        itemCount: initialCards.length,
        subjectId: subj.id,
        shareScopeKey: scopeKey,
        existingShare: existingShare || undefined,
        initialFlashcardTopicId: resolvedInitTopic,
        flashcardTopicOptions: orderedTopicOptions,
        flashcardsPayload: {
          sectionName: initialTopicName || (sectionName === 'ALL' ? `${subj.name} Flashcards` : sectionName),
          cards: initialCards.map((c) => ({ q: c.q, a: c.a, sectionName: c.sectionName })),
        },
      });
    },
    [workspace, buildFlashcardScopeKey, findExistingDeckShare]
  );

  const handlePublishDeckChanges = useCallback(
    async (
      subjectId: string,
      sectionName = 'ALL',
      topicId?: string
    ): Promise<{ ok: boolean; shareCode?: string; error?: string }> => {
      const explicitTopic =
        topicId && topicId !== 'ALL' && topicId !== '__unlinked__'
          ? workspace.topics.find((t) => t.id === topicId)
          : undefined;
      const resolvedSubjId =
        subjectId && subjectId !== 'ALL'
          ? subjectId
          : explicitTopic?.subjectId ||
            workspace.flashcards[0]?.subjectId ||
            workspace.subjects[0]?.id ||
            '';
      const subj = workspace.subjects.find((s) => s.id === resolvedSubjId);
      const existingShare = findExistingDeckShare(resolvedSubjId, sectionName, topicId);

      if (!firebaseUser || !subj || !existingShare) {
        if (subj) handleShareDeck(resolvedSubjId, sectionName, topicId);
        return { ok: false, error: 'Create or sign in to update this shared deck.' };
      }

      const scopeKey = buildFlashcardScopeKey(subj.id, sectionName, topicId);
      const savedRef = (workspace.sharedFlashcardRefs || []).find((r) => r.scopeKey === scopeKey);

      let cardsToPublish = workspace.flashcards.filter((c) => c.subjectId === subj.id);
      if (explicitTopic) {
        cardsToPublish = cardsToPublish.filter((c) => c.topicId === explicitTopic.id);
      } else if (sectionName && sectionName !== 'ALL') {
        const secLower = sectionName.trim().toLowerCase();
        cardsToPublish = cardsToPublish.filter(
          (c) => (c.sectionName || 'Core Deck').trim().toLowerCase() === secLower
        );
      } else if (savedRef?.topicIds && savedRef.topicIds.length > 0) {
        const trackedTopicIds = new Set(savedRef.topicIds);
        const trackedSecs = new Set(
          (savedRef.sectionNames || []).map((s) => s.trim().toLowerCase()).filter(Boolean)
        );
        const subset = cardsToPublish.filter(
          (c) =>
            (c.topicId && trackedTopicIds.has(c.topicId)) ||
            trackedSecs.has((c.sectionName || 'Core Deck').trim().toLowerCase())
        );
        if (subset.length > 0) cardsToPublish = subset;
      }

      if (cardsToPublish.length === 0) {
        return { ok: false, error: 'No flashcards remain in this shared scope to publish.' };
      }

      const nextSectionLabel =
        explicitTopic?.name ||
        (sectionName !== 'ALL'
          ? sectionName
          : existingShare.flashcardsPayload?.sectionName || `${subj.name} Flashcards`);
      const nextTitle =
        (existingShare.title || savedRef?.title || nextSectionLabel).trim() || nextSectionLabel;
      const defaultSummary = `${cardsToPublish.length} active-recall flashcard${
        cardsToPublish.length === 1 ? '' : 's'
      } for ${explicitTopic ? `${explicitTopic.name} (${subj.name})` : subj.name}.`;
      const prevSummary = (existingShare.summary || '').trim();
      const nextSummary =
        !prevSummary || /^\d+\s+active-recall flashcards?\s+for\s+/i.test(prevSummary)
          ? defaultSummary
          : prevSummary;

      const payloadCards = cardsToPublish.map((c) => ({
        q: c.q,
        a: c.a,
        sectionName: c.sectionName,
      }));
      const nextPayload = {
        sectionName: nextSectionLabel,
        cards: payloadCards,
      };
      if (JSON.stringify({ flashcardsPayload: nextPayload }).length > 390_000) {
        return {
          ok: false,
          error: 'Updated deck exceeds the 400 KB share limit. Split decks via Share dialog.',
        };
      }

      try {
        const updated = await updateSharedItem({
          id: existingShare.id,
          uid: firebaseUser.uid,
          ownerName: accountDisplayName,
          type: 'flashcards',
          shareCode: existingShare.shareCode,
          createdAt: existingShare.createdAt,
          copyCount: existingShare.copyCount,
          title: nextTitle,
          subjectName: subj.name,
          examBoard: subj.examBoard,
          summary: nextSummary,
          visibility: existingShare.visibility,
          itemCount: payloadCards.length,
          flashcardsPayload: nextPayload,
        });

        clearCommunityCache();
        setUserSharedItems((prev) => [
          updated,
          ...prev.filter((item) => item.id !== updated.id),
        ]);
        const nextRef: SharedFlashcardLink = {
          shareId: updated.id,
          shareCode: updated.shareCode,
          subjectId: subj.id,
          scopeKey,
          title: updated.title,
          visibility: updated.visibility,
          lastPublishedAt: updated.updatedAt,
          sectionNames: Array.from(
            new Set(payloadCards.map((c) => (c.sectionName || 'Core Deck').trim()).filter(Boolean))
          ),
          ...(savedRef?.topicIds ? { topicIds: savedRef.topicIds } : {}),
        };
        updateWorkspace((prev) => ({
          ...prev,
          sharedFlashcardRefs: [
            ...(prev.sharedFlashcardRefs || []).filter(
              (r) => r.scopeKey !== scopeKey && r.shareId !== updated.id
            ),
            nextRef,
          ],
        }));
        return { ok: true, shareCode: updated.shareCode };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unable to publish changes right now.',
        };
      }
    },
    [
      firebaseUser,
      workspace.topics,
      workspace.flashcards,
      workspace.subjects,
      workspace.sharedFlashcardRefs,
      findExistingDeckShare,
      handleShareDeck,
      buildFlashcardScopeKey,
      accountDisplayName,
      updateWorkspace,
    ]
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
      await updateCommunityAuthorName(firebaseUser.uid, nextProfile.fullName.trim());
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
              stopwatch={stopwatch}
              onStartStopwatch={handleStartStopwatch}
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
              sharedNoteByTopicId={sharedNoteByTopicId}
              onPublishTopicChanges={handlePublishTopicChanges}
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
              getExistingDeckShare={findExistingDeckShare}
              onPublishDeckChanges={handlePublishDeckChanges}
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
              stopwatch={stopwatch}
              onToggleStopwatch={handleToggleStopwatch}
              onLapStopwatch={handleLapStopwatch}
              onResetStopwatch={handleResetStopwatch}
              onStopAndLogStopwatch={handleStopAndLogStopwatch}
              onChangeStopwatchSubject={handleChangeStopwatchSubject}
              onTimerModeChange={setPlannerTimerMode}
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
              onDeletedSharedItem={(deletedId) => {
                setUserSharedItems((prev) => prev.filter((item) => item.id !== deletedId));
                updateWorkspace((prev) => {
                  const hasTopicRef = prev.topics.some((t) => t.sharedRef?.shareId === deletedId);
                  const hasFlashcardRef = (prev.sharedFlashcardRefs || []).some(
                    (r) => r.shareId === deletedId
                  );
                  if (!hasTopicRef && !hasFlashcardRef) return prev;
                  return {
                    ...prev,
                    topics: prev.topics.map((t) => {
                      if (t.sharedRef?.shareId !== deletedId) return t;
                      const { sharedRef: _drop, ...rest } = t;
                      return rest;
                    }),
                    sharedFlashcardRefs: (prev.sharedFlashcardRefs || []).filter(
                      (r) => r.shareId !== deletedId
                    ),
                  };
                });
              }}
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
          defaultSubjectId={
            selectedSubjectId === 'ALL' ? workspace.subjects[0]?.id || '' : selectedSubjectId
          }
          onOpenApiKeySettings={() => {
            setImportModalOpen(false);
            handleNavigate('vault', { vaultSection: 'data' });
          }}
          onApplyImport={(updater, _msg, targetSubjectId, targetTopicId) => {
            updateWorkspace(updater);
            if (targetSubjectId) setSelectedSubjectId(targetSubjectId);
            if (targetTopicId) setSelectedTopicId(targetTopicId);
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
        onPublished={(item, topicId, flashcardCtx) => {
          clearCommunityCache();
          setUserSharedItems((prev) => [
            item,
            ...prev.filter((existing) => existing.id !== item.id),
          ]);
          const targetTopicId = topicId || item.notesPayload?.topicOldId;
          if (item.type === 'notes' && targetTopicId) {
            const subIds = (item.notesPayload?.subTopics || [])
              .map((st) => st.oldId)
              .filter(Boolean);
            updateWorkspace((prev) => ({
              ...prev,
              topics: prev.topics.map((t) =>
                t.id === targetTopicId
                  ? {
                      ...t,
                      sharedRef: {
                        shareId: item.id,
                        shareCode: item.shareCode,
                        title: item.title,
                        visibility: item.visibility,
                        lastPublishedAt: item.updatedAt,
                        includedSubTopicIds: subIds,
                      },
                    }
                  : t
              ),
            }));
          } else if (item.type === 'flashcards') {
            const fallbackSubjId =
              flashcardCtx?.subjectId ||
              latestWorkspaceRef.current.subjects.find(
                (s) => s.name.trim().toLowerCase() === item.subjectName.trim().toLowerCase()
              )?.id ||
              '';
            const scopeKey =
              flashcardCtx?.scopeKey || (fallbackSubjId ? `subject::${fallbackSubjId}` : '');
            if (fallbackSubjId && scopeKey) {
              const nextRef: SharedFlashcardLink = {
                shareId: item.id,
                shareCode: item.shareCode,
                subjectId: fallbackSubjId,
                scopeKey,
                title: item.title,
                visibility: item.visibility,
                lastPublishedAt: item.updatedAt,
                ...(flashcardCtx?.sectionNames?.length
                  ? { sectionNames: flashcardCtx.sectionNames }
                  : {}),
                ...(flashcardCtx?.topicIds?.length
                  ? { topicIds: flashcardCtx.topicIds }
                  : {}),
              };
              updateWorkspace((prev) => ({
                ...prev,
                sharedFlashcardRefs: [
                  ...(prev.sharedFlashcardRefs || []).filter(
                    (r) => r.scopeKey !== scopeKey && r.shareId !== item.id
                  ),
                  nextRef,
                ],
              }));
            }
          }
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

      <FloatingStopwatchTab
        stopwatch={stopwatch}
        hidden={
          activeTab === 'planner' &&
          plannerSubTab === 'timer' &&
          plannerTimerMode === 'stopwatch'
        }
        toastMessage={swToast}
        onToggle={handleToggleStopwatch}
        onLap={handleLapStopwatch}
        onReset={handleResetStopwatch}
        onStopAndLog={handleStopAndLogStopwatch}
        onDismiss={handleDismissStopwatch}
        onOpenPlannerTimer={() => handleNavigate('planner', { plannerTab: 'timer' })}
      />

      <OfflineIndicator />
    </div>
  );
}

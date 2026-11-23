import { useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  ChevronDown,
  KeyRound,
  Laptop,
  Lock,
  LogIn,
  LogOut,
  Menu,
  Moon,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sun,
  Timer,
  Unlock,
  Upload,
  User as UserIcon,
} from 'lucide-react';
import { getDeviceInfo } from '../lib/device';
import { BOOTSTRAP_ADMIN_EMAIL } from '../lib/syncService';
import { PWAInstallButton } from './PwaControls';
import {
  DecryptedProfile,
  LiveTimerState,
  PlannerSubTab,
  UserAccountDoc,
  UserDeviceDoc,
  WorkspaceTab,
} from '../types';

export type { WorkspaceTab };

interface TopBarProps {
  activeTab: WorkspaceTab;
  plannerSubTab?: PlannerSubTab;
  selectedSubjectName?: string;
  onSelectTab: (tab: WorkspaceTab, opts?: { plannerTab?: PlannerSubTab }) => void;
  onOpenMobileSidebar: () => void;
  onOpenImport?: () => void;
  firebaseUser: User | null;
  account: UserAccountDoc | null;
  profile: DecryptedProfile | null;
  devices: UserDeviceDoc[];
  chunkCount: number;
  vaultUnlocked: boolean;
  syncState: 'idle' | 'syncing' | 'synced' | 'error' | 'offline';
  liveTimer: LiveTimerState;
  isDark: boolean;
  onToggleLightDark: () => void;
  customizeOpen: boolean;
  onOpenCustomize: () => void;
  onOpenAuth: () => void;
  onForceSync: () => Promise<void>;
  onLockVault: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

const TAB_LABELS: Record<WorkspaceTab, string> = {
  home: 'Home',
  subjects: 'Subjects',
  notes: 'Study Notes',
  flashcards: 'Flashcards',
  calendar: 'Calendar',
  planner: 'Planner',
  timer: 'Focus Timer',
  community: 'Community Share',
  quiz: 'Live Quiz',
  progress: 'Progress',
  vault: 'Account & Data',
  admin: 'Admin',
};

const PLANNER_SUBTAB_LABELS: Record<PlannerSubTab, string> = {
  calendar: 'To-Do List',
  todo: 'To-Do List',
};

function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  const src = (name || email || 'S').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
}

export function TopBar({
  activeTab,
  plannerSubTab = 'calendar',
  selectedSubjectName,
  onSelectTab,
  onOpenMobileSidebar,
  onOpenImport,
  firebaseUser,
  account,
  profile,
  devices,
  chunkCount,
  vaultUnlocked,
  syncState,
  liveTimer,
  isDark,
  onToggleLightDark,
  customizeOpen,
  onOpenCustomize,
  onOpenAuth,
  onForceSync,
  onLockVault,
  onSignOut,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setImgFailed(false);
  }, [firebaseUser?.photoURL]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const contextTitle =
    (activeTab === 'notes' || activeTab === 'flashcards') && selectedSubjectName
      ? `${TAB_LABELS[activeTab]} · ${selectedSubjectName}`
      : activeTab === 'planner'
      ? `${TAB_LABELS.planner} · ${PLANNER_SUBTAB_LABELS[plannerSubTab]}`
      : TAB_LABELS[activeTab] || 'Home';

  const displayName =
    profile?.fullName?.trim() ||
    account?.displayName ||
    firebaseUser?.displayName ||
    firebaseUser?.email?.split('@')[0] ||
    'Guest Student';

  const photoUrl = firebaseUser?.photoURL && !imgFailed ? firebaseUser.photoURL : null;
  const initials = getInitials(displayName, firebaseUser?.email);
  const currentDevice = getDeviceInfo();

  const syncText = !firebaseUser
    ? 'Local only'
    : !vaultUnlocked
    ? 'Vault locked'
    : syncState === 'syncing'
    ? 'Syncing…'
    : syncState === 'error'
    ? 'Sync error'
    : syncState === 'offline'
    ? 'Offline'
    : 'Encrypted sync active';

  return (
    <header className="sticky top-0 z-30 flex h-14 w-full shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--card)] px-3 sm:px-5">
      {/* Left: Mobile Sidebar Toggle + Current Context */}
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          aria-label="Open navigation menu"
          className="sd-btn h-9 w-9 shrink-0 rounded-lg p-0 lg:hidden"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="font-display shrink-0 text-base font-extrabold tracking-tight text-[var(--ink)] lg:hidden">
          StudyWeb
        </span>
        <span className="hidden truncate text-sm font-semibold text-[var(--ink)] sm:inline lg:text-[15px]">
          {contextTitle}
        </span>
      </div>

      {/* Right: Timer, Quick Import, Theme Toggle, Customize, and Google Profile Avatar Menu */}
      <div className="flex shrink-0 items-center gap-2">
        {liveTimer.active && activeTab !== 'timer' && (
          <button
            type="button"
            onClick={() => onSelectTab('timer')}
            title={`Active ${liveTimer.mode} session: ${liveTimer.subject}`}
            className="sd-btn font-mono-num hidden px-2.5 py-1.5 text-xs whitespace-nowrap text-[var(--e3)] sm:inline-flex"
          >
            <Timer className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{liveTimer.text}</span>
          </button>
        )}

        <PWAInstallButton />

        {onOpenImport && (
          <button
            type="button"
            onClick={onOpenImport}
            title="Import notes or flashcards"
            className="sd-btn hidden h-9 px-2.5 text-xs whitespace-nowrap md:inline-flex"
          >
            <Upload className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
            <span>Import</span>
          </button>
        )}

        <button
          type="button"
          onClick={onToggleLightDark}
          title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          className="sd-btn h-9 px-2.5 text-xs whitespace-nowrap sm:px-3"
        >
          {isDark ? (
            <Sun className="h-4 w-4 text-[var(--e2)]" aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">{isDark ? 'Light' : 'Dark'}</span>
        </button>

        <button
          type="button"
          onClick={onOpenCustomize}
          aria-expanded={customizeOpen}
          title="Appearance & Customize"
          className={`h-9 cursor-pointer rounded-lg border px-2.5 text-xs font-semibold whitespace-nowrap transition-colors sm:px-3 sm:text-[13px] ${
            customizeOpen
              ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]'
              : 'border-[var(--line)] bg-[var(--bg)] text-[var(--ink)] hover:border-[var(--mute)]'
          }`}
        >
          Aa <span className="hidden sm:inline">Customize</span>
        </button>

        {/* Google Account / Profile Avatar Popover */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            aria-label={firebaseUser ? `Account menu for ${displayName}` : 'Account and sign in'}
            className="flex h-9 cursor-pointer items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--bg)] p-0.5 pr-2 transition-colors hover:border-[var(--mute)]"
          >
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={displayName}
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="h-7 w-7 rounded-full object-cover"
              />
            ) : firebaseUser ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--e3)] text-xs font-bold text-white">
                {initials}
              </span>
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--card)] text-[var(--mute)]">
                <UserIcon className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <span className="hidden max-w-[120px] truncate text-xs font-semibold text-[var(--ink)] md:inline">
              {firebaseUser ? displayName : 'Sign in'}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-[var(--mute)]" aria-hidden="true" />
          </button>

          {menuOpen && (
            <div
              role="dialog"
              aria-label="Account details"
              className="sd-card absolute right-0 top-[calc(100%+8px)] z-50 w-80 overflow-hidden sm:w-96"
            >
              <div className="flex items-center gap-3 border-b border-[var(--line)] bg-[var(--bg)] p-4">
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt={displayName}
                    referrerPolicy="no-referrer"
                    onError={() => setImgFailed(true)}
                    className="h-12 w-12 shrink-0 rounded-full border border-[var(--line)] object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--e3)] text-base font-bold text-white">
                    {firebaseUser ? initials : <UserIcon className="h-5 w-5" aria-hidden="true" />}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-base font-bold text-[var(--ink)]">
                    {displayName}
                  </div>
                  <div className="truncate text-xs text-[var(--mute)]">
                    {firebaseUser?.email || 'Guest mode · Browser storage only'}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold">
                    {!firebaseUser ? (
                      <span className="text-[var(--mute)]">Not signed in</span>
                    ) : !vaultUnlocked ? (
                      <span className="inline-flex items-center gap-1 text-[var(--e2)]">
                        <Lock className="h-3 w-3" aria-hidden="true" /> Vault locked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[var(--ok)]">
                        <ShieldCheck className="h-3 w-3" aria-hidden="true" /> {syncText}
                      </span>
                    )}
                    {account?.role && (
                      <>
                        <span aria-hidden="true" className="text-[var(--mute)]">
                          ·
                        </span>
                        <span className="capitalize text-[var(--e3)]">{account.role}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3 p-4 text-xs">
                {firebaseUser ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                      <div>
                        <div className="text-[var(--mute)]">Encrypted docs</div>
                        <div className="font-mono-num mt-0.5 text-sm font-bold text-[var(--ink)]">
                          {chunkCount}
                        </div>
                      </div>
                      <div>
                        <div className="text-[var(--mute)]">Key &amp; devices</div>
                        <div className="font-mono-num mt-0.5 text-sm font-bold text-[var(--ink)]">
                          v{account?.keyVersion ?? 1} · {devices.length || 1} dev
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-[var(--mute)]">
                      <Laptop className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        This device: <strong className="text-[var(--ink)]">{currentDevice.deviceName}</strong>
                      </span>
                    </div>

                    {vaultUnlocked && (profile?.school || profile?.yearGroup || profile?.examBoard) && (
                      <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-2.5 text-[var(--mute)]">
                        <div className="font-semibold text-[var(--ink)]">
                          {[profile.school, profile.yearGroup].filter(Boolean).join(' · ') || 'Student Profile'}
                        </div>
                        {profile.examBoard && <div className="mt-0.5">{profile.examBoard}</div>}
                        {profile.targetGrades && (
                          <div className="mt-0.5">Target: {profile.targetGrades}</div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="leading-relaxed text-[var(--mute)]">
                    Sign in with Google to sync your flashcards, structured notes, and revision planner across devices with AES-256-GCM encryption.
                  </p>
                )}

                <div className="space-y-2 border-t border-[var(--line)] pt-3">
                  {!firebaseUser ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenAuth();
                      }}
                      className="sd-btn-pri w-full px-3.5 py-2 text-xs"
                    >
                      <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Sign in with Google</span>
                    </button>
                  ) : !vaultUnlocked ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenAuth();
                      }}
                      className="sd-btn-pri w-full px-3.5 py-2 text-xs"
                    >
                      <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Unlock Encrypted Vault</span>
                    </button>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onSelectTab('vault');
                        }}
                        className="sd-btn-pri px-3 py-2 text-xs"
                      >
                        <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Manage account</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void onForceSync();
                        }}
                        className="sd-btn px-3 py-2 text-xs"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${syncState === 'syncing' ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        <span>Sync now</span>
                      </button>
                    </div>
                  )}

                  {firebaseUser && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-2">
                        {(account?.role === 'admin' ||
                          (Boolean(firebaseUser?.emailVerified) &&
                            firebaseUser?.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL)) && (
                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false);
                              onSelectTab('admin');
                            }}
                            className="sd-btn px-2.5 py-1.5 text-xs"
                          >
                            <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Admin</span>
                          </button>
                        )}
                        {vaultUnlocked && (
                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false);
                              void onLockVault();
                            }}
                            className="sd-btn px-2.5 py-1.5 text-xs"
                          >
                            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Lock vault</span>
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          void onSignOut();
                        }}
                        className="sd-btn px-2.5 py-1.5 text-xs text-[var(--bad)]"
                      >
                        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Sign out</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

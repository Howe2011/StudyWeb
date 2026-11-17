import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Check,
  Copy,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Laptop,
  Library,
  Lock,
  LogOut,
  Palette,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  Upload,
} from 'lucide-react';
import { AdminPanel } from './AdminPanel';
import { getDeviceInfo, setCustomDeviceName } from '../lib/device';
import { isNoteEmpty, structuredNoteToHtml } from '../lib/noteFormat';
import { BOOTSTRAP_ADMIN_EMAIL } from '../lib/syncService';
import {
  convertLegacyEntriesToWorkspace,
  createEmptyWorkspace,
  normalizeWorkspace,
} from '../lib/workspaceStore';
import {
  DecryptedProfile,
  UserAccountDoc,
  UserActivityDoc,
  UserDeviceDoc,
  WorkspaceData,
} from '../types';

export type VaultSection = 'account' | 'data' | 'admin';

export type BackupCategory = 'notes' | 'flashcards' | 'timelines' | 'planner' | 'subjects';

interface ProfileVaultViewProps {
  workspace: WorkspaceData;
  firebaseUser: User | null;
  account: UserAccountDoc | null;
  vaultUnlocked: boolean;
  profile: DecryptedProfile | null;
  devices: UserDeviceDoc[];
  activity: UserActivityDoc[];
  chunkCount: number;
  syncState: 'idle' | 'syncing' | 'synced' | 'error' | 'offline';
  hasGuestData: boolean;
  initialSection?: VaultSection;
  onOpenAuth: () => void;
  onSignOut: () => Promise<void>;
  onLockVault: () => Promise<void>;
  onSaveProfile: (profile: DecryptedProfile) => Promise<void>;
  onRotatePassphrase: (newPassphrase: string) => Promise<string>;
  onForceSync: () => Promise<void>;
  onImportGuestData: () => Promise<void>;
  onRemoveDevice: (deviceId: string) => Promise<void>;
  onDeviceRenamed: () => Promise<void>;
  onOpenCustomize: () => void;
  onOpenUniversalImport: () => void;
  onOpenRevisionCards: () => void;
  onOpenPlannerOptions: () => void;
  onImportWorkspaceData: (incoming: WorkspaceData, mode: 'merge' | 'replace') => Promise<void>;
  onResetWorkspace: () => Promise<void>;
}

const ALL_CATEGORIES: {
  id: BackupCategory;
  label: string;
  desc: string;
}[] = [
  { id: 'subjects', label: 'Subjects & Topics', desc: 'Subjects, exam dates, and topic list' },
  { id: 'notes', label: 'Structured Notes', desc: 'Summaries, sections, key terms & worked examples' },
  { id: 'flashcards', label: 'Flashcards', desc: 'Cards & spaced-repetition progress' },
  { id: 'timelines', label: 'Timelines', desc: 'History timeline milestones & eras' },
  { id: 'planner', label: 'Planner & To-Do', desc: 'Weekly calendar blocks, to-do tasks & logged minutes' },
];

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(val: string): string {
  return `"${String(val || '').replace(/"/g, '""')}"`;
}

function filterWorkspaceByCategories(
  ws: WorkspaceData,
  cats: Record<BackupCategory, boolean>
): WorkspaceData {
  const next = createEmptyWorkspace();
  if (cats.subjects || cats.notes || cats.timelines || cats.flashcards) {
    next.subjects = [...ws.subjects];
  }
  if (cats.notes || cats.timelines || cats.subjects) {
    next.topics = ws.topics.map((t) => ({
      ...t,
      notes: cats.notes
        ? t.notes
        : { summary: '', sections: [], keyTerms: [], examTip: '', workedExample: '', updatedAt: t.notes.updatedAt },
      timelineEvents: cats.timelines ? t.timelineEvents : undefined,
    }));
  }
  if (cats.flashcards) {
    next.flashcards = [...ws.flashcards];
  }
  if (cats.planner) {
    next.todos = [...ws.todos];
    next.calendarBlocks = [...ws.calendarBlocks];
    next.studyMinutesLogged = ws.studyMinutesLogged;
    next.studyStreakDays = ws.studyStreakDays;
    next.lastStudyDate = ws.lastStudyDate;
  }
  return next;
}

export function ProfileVaultView({
  workspace,
  firebaseUser,
  account,
  vaultUnlocked,
  profile,
  devices,
  activity,
  chunkCount,
  syncState,
  hasGuestData,
  initialSection = 'account',
  onOpenAuth,
  onSignOut,
  onLockVault,
  onSaveProfile,
  onRotatePassphrase,
  onForceSync,
  onImportGuestData,
  onRemoveDevice,
  onDeviceRenamed,
  onOpenCustomize,
  onOpenUniversalImport,
  onOpenRevisionCards,
  onOpenPlannerOptions,
  onImportWorkspaceData,
  onResetWorkspace,
}: ProfileVaultViewProps) {
  const currentDev = getDeviceInfo();
  const [section, setSection] = useState<VaultSection>(initialSection);
  const [form, setForm] = useState<DecryptedProfile>({
    email: firebaseUser?.email || '',
    fullName: firebaseUser?.displayName || '',
    school: '',
    yearGroup: '',
    examBoard: 'GCSE / Edexcel',
    targetGrades: '',
    studyNotes: '',
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const [devName, setDevName] = useState(currentDev.deviceName);
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [rotatedCode, setRotatedCode] = useState<string | null>(null);
  const [secError, setSecError] = useState<string | null>(null);
  const [busySec, setBusySec] = useState(false);
  const [armReset, setArmReset] = useState(false);
  const [resettingWorkspace, setResettingWorkspace] = useState(false);

  const [exportCats, setExportCats] = useState<Record<BackupCategory, boolean>>({
    subjects: true,
    notes: true,
    flashcards: true,
    timelines: true,
    planner: true,
  });
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const [importSourceTab, setImportSourceTab] = useState<'file' | 'text'>('file');
  const [importTextRaw, setImportTextRaw] = useState('');
  const [parsedBackup, setParsedBackup] = useState<{
    fileName: string;
    workspace: WorkspaceData;
    available: Record<BackupCategory, boolean>;
  } | null>(null);
  const [importCats, setImportCats] = useState<Record<BackupCategory, boolean>>({
    subjects: true,
    notes: true,
    flashcards: true,
    timelines: true,
    planner: true,
  });
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importStatus, setImportStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (profile) {
      setForm(profile);
    } else if (firebaseUser) {
      setForm((prev) => ({
        ...prev,
        email: firebaseUser.email || prev.email,
        fullName: firebaseUser.displayName || prev.fullName,
      }));
    }
  }, [profile, firebaseUser]);

  const summary = useMemo(() => {
    const noteDocs = workspace.topics.filter((t) => !isNoteEmpty(t.notes)).length;
    const timelineTopics = workspace.topics.filter(
      (t) => t.timelineEvents && t.timelineEvents.length > 0
    ).length;
    const timelineEventsCount = workspace.topics.reduce(
      (acc, t) => acc + (t.timelineEvents?.length || 0),
      0
    );
    const masteredCards = workspace.flashcards.filter((c) => c.box >= 4).length;

    return {
      subjects: workspace.subjects.length,
      topics: workspace.topics.length,
      noteDocs,
      flashcards: workspace.flashcards.length,
      masteredCards,
      timelineTopics,
      timelineEventsCount,
      todos: workspace.todos.length,
      calendarBlocks: workspace.calendarBlocks.length,
    };
  }, [workspace]);

  const handleProfileSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileSaved(false);
    try {
      await onSaveProfile(form);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleRotate = async (e: FormEvent) => {
    e.preventDefault();
    setSecError(null);
    setRotatedCode(null);
    if (newPass.length < 8) {
      setSecError('New passphrase must be at least 8 characters.');
      return;
    }
    if (newPass !== confirmPass) {
      setSecError('Passphrases do not match.');
      return;
    }
    setBusySec(true);
    try {
      const code = await onRotatePassphrase(newPass);
      setRotatedCode(code);
      setNewPass('');
      setConfirmPass('');
    } catch (err) {
      setSecError(err instanceof Error ? err.message : 'Failed to rotate passphrase.');
    } finally {
      setBusySec(false);
    }
  };

  const handleRenameDevice = async (e: FormEvent) => {
    e.preventDefault();
    setCustomDeviceName(devName);
    await onDeviceRenamed();
  };

  const buildBackupJson = () => {
    const filtered = filterWorkspaceByCategories(workspace, exportCats);
    const payload = {
      app: 'studydeck',
      v: 2,
      exported: new Date().toISOString(),
      workspace: filtered,
    };
    const itemCount =
      filtered.subjects.length +
      filtered.topics.length +
      filtered.flashcards.length +
      filtered.todos.length +
      filtered.calendarBlocks.length;
    return {
      json: JSON.stringify(payload, null, 2),
      itemCount,
    };
  };

  const handleDownloadJson = () => {
    const { json, itemCount } = buildBackupJson();
    if (!itemCount) {
      setExportStatus('No saved items matched your selected categories.');
      return;
    }
    downloadBlob(`studydeck-backup-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json');
    setExportStatus(`Downloaded JSON backup (${itemCount} study records).`);
  };

  const handleCopyJson = async () => {
    const { json, itemCount } = buildBackupJson();
    if (!itemCount) {
      setExportStatus('No saved items matched your selected categories.');
      return;
    }
    try {
      await navigator.clipboard.writeText(json);
      setExportStatus(`Copied JSON backup (${itemCount} records) to clipboard.`);
    } catch {
      setExportStatus('Clipboard blocked — use Download JSON instead.');
    }
  };

  const handleDownloadFlashcardsCsv = () => {
    if (workspace.flashcards.length === 0) {
      setExportStatus('No flashcards saved yet.');
      return;
    }
    const subjMap = new Map(workspace.subjects.map((s) => [s.id, s.name]));
    const csv =
      'question,answer,section,subject\n' +
      workspace.flashcards
        .map((c) =>
          [
            csvCell(c.q),
            csvCell(c.a),
            csvCell(c.sectionName || 'Core Deck'),
            csvCell(subjMap.get(c.subjectId) || 'General'),
          ].join(',')
        )
        .join('\n');
    downloadBlob(`studydeck-flashcards-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
    setExportStatus(`Exported ${workspace.flashcards.length} flashcard(s) as CSV.`);
  };

  const handleDownloadNotesHtml = () => {
    const populated = workspace.topics.filter((t) => !isNoteEmpty(t.notes));
    if (populated.length === 0) {
      setExportStatus('No structured notes saved yet.');
      return;
    }
    const subjMap = new Map(workspace.subjects.map((s) => [s.id, s.name]));
    const body = populated
      .map(
        (t) =>
          `<section>${structuredNoteToHtml(
            `${subjMap.get(t.subjectId) || 'Subject'} — ${t.name}`,
            t.notes
          )}</section><hr>`
      )
      .join('\n');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>StudyDeck Notes</title><style>body{font-family:system-ui,sans-serif;max-width:820px;margin:32px auto;padding:0 20px;line-height:1.55}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px}blockquote{border-left:3px solid #2F5F8A;padding-left:12px;color:#333}</style></head><body>${body}</body></html>`;
    downloadBlob(`studydeck-notes-${new Date().toISOString().slice(0, 10)}.html`, html, 'text/html');
    setExportStatus(`Exported ${populated.length} note document(s) as HTML.`);
  };

  const handleDownloadTodosCsv = () => {
    if (workspace.todos.length === 0) {
      setExportStatus('No to-do tasks saved yet.');
      return;
    }
    const subjMap = new Map(workspace.subjects.map((s) => [s.id, s.name]));
    const csv =
      'task,subject,due_date,priority,completed\n' +
      workspace.todos
        .map((t) =>
          [
            csvCell(t.title),
            csvCell(t.subjectId ? subjMap.get(t.subjectId) || '' : ''),
            csvCell(t.dueDate || ''),
            csvCell(t.priority === 3 ? 'High' : t.priority === 1 ? 'Low' : 'Normal'),
            csvCell(t.done ? 'Yes' : 'No'),
          ].join(',')
        )
        .join('\n');
    downloadBlob(`studydeck-todos-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
    setExportStatus(`Exported ${workspace.todos.length} to-do task(s) as CSV.`);
  };

  const parseRawBackupJson = (raw: string, sourceLabel: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setParsedBackup(null);
      setImportStatus({ ok: false, msg: 'Paste a StudyDeck JSON backup first.' });
      return;
    }

    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      let parsedWs: WorkspaceData | null = null;

      if (obj && obj.app === 'studydeck' && obj.v === 2 && obj.workspace) {
        parsedWs = normalizeWorkspace(obj.workspace);
      } else if (obj && obj.version === 2 && Array.isArray(obj.subjects)) {
        parsedWs = normalizeWorkspace(obj);
      } else {
        // Legacy v1 StudyDeck / revision-site / mock-revision-planner backup conversion
        const rev: Record<string, string> = {};
        const pln: Record<string, string> = {};
        if (obj && obj.app === 'studydeck') {
          const rObj = (obj.revision && typeof obj.revision === 'object' ? obj.revision : {}) as Record<string, unknown>;
          const pObj = (obj.planner && typeof obj.planner === 'object' ? obj.planner : {}) as Record<string, unknown>;
          for (const [k, v] of Object.entries(rObj)) if (typeof v === 'string') rev[k] = v;
          for (const [k, v] of Object.entries(pObj)) if (typeof v === 'string') pln[k] = v;
        } else if (obj && obj.app === 'revision-site' && obj.data && typeof obj.data === 'object') {
          for (const [k, v] of Object.entries(obj.data as Record<string, unknown>)) {
            if (typeof v === 'string') rev[k] = v;
          }
        } else if (obj && obj.app === 'mock-revision-planner' && obj.data && typeof obj.data === 'object') {
          pln['mockplanner.v1'] = JSON.stringify(obj.data);
        } else if (
          obj &&
          (Array.isArray(obj.subs) || Array.isArray(obj.todos) || Array.isArray(obj.blocks) || (obj.td && typeof obj.td === 'object'))
        ) {
          pln['mockplanner.v1'] = JSON.stringify(obj);
        }

        const conv = convertLegacyEntriesToWorkspace(rev, pln);
        if (conv.hadLegacyData) parsedWs = conv.workspace;
      }

      if (!parsedWs) {
        setParsedBackup(null);
        setImportStatus({
          ok: false,
          msg: 'Unrecognized JSON format. Use a StudyDeck JSON backup or use Smart Note & Flashcard Import for text/Word/CSV.',
        });
        return;
      }

      const available: Record<BackupCategory, boolean> = {
        subjects: parsedWs.subjects.length > 0 || parsedWs.topics.length > 0,
        notes: parsedWs.topics.some((t) => !isNoteEmpty(t.notes)),
        flashcards: parsedWs.flashcards.length > 0,
        timelines: parsedWs.topics.some((t) => t.timelineEvents && t.timelineEvents.length > 0),
        planner: parsedWs.todos.length > 0 || parsedWs.calendarBlocks.length > 0,
      };

      setParsedBackup({ fileName: sourceLabel, workspace: parsedWs, available });
      setImportCats({ ...available });
      setImportStatus(null);
    } catch {
      setParsedBackup(null);
      setImportStatus({
        ok: false,
        msg: 'Invalid JSON syntax. To import notes, Markdown, CSV, or .docx files, click Smart Import.',
      });
    }
  };

  const handleImportFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus(null);
    const reader = new FileReader();
    reader.onload = () => {
      parseRawBackupJson(String(reader.result || ''), file.name);
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleRunImport = async () => {
    if (!parsedBackup) return;
    const filtered = filterWorkspaceByCategories(parsedBackup.workspace, importCats);
    const hasAny =
      filtered.subjects.length > 0 ||
      filtered.topics.length > 0 ||
      filtered.flashcards.length > 0 ||
      filtered.todos.length > 0 ||
      filtered.calendarBlocks.length > 0;
    if (!hasAny) {
      setImportStatus({ ok: false, msg: 'Select at least one section to restore.' });
      return;
    }

    setImporting(true);
    setImportStatus(null);
    try {
      await onImportWorkspaceData(filtered, importMode);
      setImportStatus({
        ok: true,
        msg: `Restored backup from ${parsedBackup.fileName} (${importMode} mode).`,
      });
      setParsedBackup(null);
      setImportTextRaw('');
    } catch (err) {
      setImportStatus({
        ok: false,
        msg: err instanceof Error ? err.message : 'Restore failed.',
      });
    } finally {
      setImporting(false);
    }
  };

  const isAdmin =
    Boolean(firebaseUser) &&
    (account?.role === 'admin' ||
      (Boolean(firebaseUser?.emailVerified) &&
        firebaseUser?.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL));

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-[1120px] space-y-6 px-4 py-7 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-[var(--ink)] sm:text-3xl">
              Account &amp; Data
            </h1>
            <p className="mt-1 text-sm text-[var(--mute)]">
              {firebaseUser
                ? `${firebaseUser.email} · Role: ${account?.role ?? 'student'} · Key v${account?.keyVersion ?? 1}`
                : 'Guest session · Selective backups, export tools & local browser storage'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="sd-seg" role="tablist" aria-label="Account sections">
              <button
                type="button"
                role="tab"
                aria-selected={section === 'account'}
                aria-pressed={section === 'account'}
                onClick={() => setSection('account')}
                className="sd-seg-btn"
              >
                Account &amp; Sync
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === 'data'}
                aria-pressed={section === 'data'}
                onClick={() => setSection('data')}
                className="sd-seg-btn"
              >
                Data &amp; Backups
              </button>
              {isAdmin && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={section === 'admin'}
                  aria-pressed={section === 'admin'}
                  onClick={() => setSection('admin')}
                  className="sd-seg-btn"
                >
                  Admin
                </button>
              )}
            </div>
            {firebaseUser && (
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span>Sign out</span>
              </button>
            )}
          </div>
        </div>

        {section === 'data' && (
          <div className="space-y-6">
            {/* Stored Data Overview */}
            <div className="sd-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                    Your Stored Study Data
                  </h2>
                  <p className="mt-0.5 text-xs text-[var(--mute)]">
                    {firebaseUser && vaultUnlocked
                      ? 'Synced live in a single compact AES-256-GCM cloud document.'
                      : 'Saved locally in your browser. Export or restore anytime.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenUniversalImport}
                  className="sd-btn-pri px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Import Word / Notes / CSV</span>
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="text-xs font-semibold text-[var(--mute)]">Subjects</div>
                  <div className="font-mono-num mt-1 text-xl font-bold text-[var(--ink)]">
                    {summary.subjects}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--mute)]">
                    {summary.topics} topics
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="text-xs font-semibold text-[var(--mute)]">Notes</div>
                  <div className="font-mono-num mt-1 text-xl font-bold text-[var(--ink)]">
                    {summary.noteDocs}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--mute)]">structured docs</div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="text-xs font-semibold text-[var(--mute)]">Flashcards</div>
                  <div className="font-mono-num mt-1 text-xl font-bold text-[var(--ink)]">
                    {summary.flashcards}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--mute)]">
                    {summary.masteredCards} mastered
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="text-xs font-semibold text-[var(--mute)]">Timelines</div>
                  <div className="font-mono-num mt-1 text-xl font-bold text-[var(--ink)]">
                    {summary.timelineEventsCount}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--mute)]">
                    across {summary.timelineTopics} topics
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="text-xs font-semibold text-[var(--mute)]">Planner</div>
                  <div className="font-mono-num mt-1 text-xl font-bold text-[var(--ink)]">
                    {summary.todos + summary.calendarBlocks}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--mute)]">
                    {summary.todos} todos · {summary.calendarBlocks} blocks
                  </div>
                </div>
              </div>
            </div>

            {/* Selective Export & Restore Grid */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="sd-card flex flex-col justify-between p-6">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                      Export Data
                    </h2>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setExportCats({
                            subjects: true,
                            notes: true,
                            flashcards: true,
                            timelines: true,
                            planner: true,
                          })
                        }
                        className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline"
                      >
                        Select all
                      </button>
                      <span className="text-xs text-[var(--mute)]">·</span>
                      <button
                        type="button"
                        onClick={() =>
                          setExportCats({
                            subjects: false,
                            notes: false,
                            flashcards: false,
                            timelines: false,
                            planner: false,
                          })
                        }
                        className="cursor-pointer text-xs font-semibold text-[var(--mute)] hover:underline"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-[var(--mute)]">
                    Download a full StudyDeck backup or readable CSV / HTML study files.
                  </p>

                  <div className="mt-4 space-y-2">
                    {ALL_CATEGORIES.map((c) => (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 transition-colors hover:border-[var(--e3)]"
                      >
                        <input
                          type="checkbox"
                          checked={exportCats[c.id]}
                          onChange={(e) =>
                            setExportCats((prev) => ({ ...prev, [c.id]: e.target.checked }))
                          }
                          className="mt-0.5 h-4 w-4 accent-[var(--e3)]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-[var(--ink)]">{c.label}</div>
                          <div className="text-xs text-[var(--mute)]">{c.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="mt-5 space-y-3 border-t border-[var(--line)] pt-4">
                  <div className="flex flex-wrap gap-2.5">
                    <button
                      type="button"
                      onClick={handleDownloadJson}
                      className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Download JSON backup</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopyJson()}
                      className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Copy JSON</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-xs font-semibold text-[var(--mute)]">Readable files:</span>
                    <button
                      type="button"
                      onClick={handleDownloadFlashcardsCsv}
                      className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                      <span>Flashcards (.csv)</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadNotesHtml}
                      className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                    >
                      <FileText className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                      <span>Notes (.html)</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadTodosCsv}
                      className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-[var(--e2)]" aria-hidden="true" />
                      <span>To-Do (.csv)</span>
                    </button>
                  </div>

                  {exportStatus && (
                    <p className="text-xs font-semibold text-[var(--ok)]" role="status">
                      {exportStatus}
                    </p>
                  )}
                </div>
              </div>

              {/* Restore JSON Backup Card */}
              <div className="sd-card flex flex-col justify-between p-6">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                      Restore JSON Backup
                    </h2>
                    <div className="sd-seg">
                      <button
                        type="button"
                        aria-pressed={importSourceTab === 'file'}
                        onClick={() => setImportSourceTab('file')}
                        className="sd-seg-btn"
                      >
                        Upload File
                      </button>
                      <button
                        type="button"
                        aria-pressed={importSourceTab === 'text'}
                        onClick={() => setImportSourceTab('text')}
                        className="sd-seg-btn"
                      >
                        Paste JSON
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-[var(--mute)]">
                    Supports both new StudyDeck v2 backups and legacy Revision / Planner JSON backups.
                  </p>

                  {importSourceTab === 'file' ? (
                    <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--line)] bg-[var(--bg)] px-4 py-6 text-center transition-colors hover:border-[var(--e3)]">
                      <Upload className="h-5 w-5 text-[var(--e3)]" aria-hidden="true" />
                      <span className="text-sm font-bold text-[var(--ink)]">
                        {parsedBackup ? parsedBackup.fileName : 'Choose .json backup file'}
                      </span>
                      <span className="text-xs text-[var(--mute)]">
                        Need to import Word (.docx), Markdown, or Quizlet CSV? Click &ldquo;Import Word / Notes / CSV&rdquo; above.
                      </span>
                      <input
                        type="file"
                        accept=".json,application/json"
                        onChange={handleImportFileChange}
                        className="hidden"
                      />
                    </label>
                  ) : (
                    <div className="mt-4 space-y-2.5">
                      <textarea
                        rows={6}
                        value={importTextRaw}
                        onChange={(e) => setImportTextRaw(e.target.value)}
                        placeholder="Paste StudyDeck v1 or v2 JSON backup here..."
                        className="sd-input font-mono-num text-xs leading-relaxed"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => parseRawBackupJson(importTextRaw, 'Pasted JSON')}
                          className="sd-btn px-3.5 py-1.5 text-xs whitespace-nowrap"
                        >
                          Preview Backup
                        </button>
                      </div>
                    </div>
                  )}

                  {parsedBackup && (
                    <div className="mt-4 space-y-3">
                      <div className="text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                        Sections found in {parsedBackup.fileName}
                      </div>
                      <div className="space-y-1.5">
                        {ALL_CATEGORIES.filter((c) => parsedBackup.available[c.id]).map((c) => (
                          <label
                            key={c.id}
                            className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs font-semibold text-[var(--ink)]"
                          >
                            <input
                              type="checkbox"
                              checked={importCats[c.id]}
                              onChange={(e) =>
                                setImportCats((prev) => ({ ...prev, [c.id]: e.target.checked }))
                              }
                              className="h-4 w-4 accent-[var(--e3)]"
                            />
                            <span>{c.label}</span>
                          </label>
                        ))}
                      </div>

                      <div className="pt-1">
                        <label className="block text-xs font-semibold text-[var(--mute)]">
                          Import mode
                          <select
                            value={importMode}
                            onChange={(e) =>
                              setImportMode(e.target.value === 'replace' ? 'replace' : 'merge')
                            }
                            className="sd-input mt-1 py-1.5 text-xs"
                          >
                            <option value="merge">
                              Merge — keep existing data &amp; add missing items
                            </option>
                            <option value="replace">
                              Replace — overwrite workspace with backup
                            </option>
                          </select>
                        </label>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={importing}
                          onClick={() => void handleRunImport()}
                          className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{importing ? 'Restoring...' : 'Apply backup'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setParsedBackup(null)}
                          className="sd-btn px-3 py-2 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {importStatus && (
                  <p
                    className={`mt-4 text-xs font-semibold ${
                      importStatus.ok ? 'text-[var(--ok)]' : 'text-[var(--bad)]'
                    }`}
                    role="status"
                  >
                    {importStatus.msg}
                  </p>
                )}
              </div>
            </div>

            {/* Compact Workspace Tools */}
            <div className="sd-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-bold text-[var(--ink)]">
                    Workspace Tools
                  </h3>
                  <p className="text-xs text-[var(--mute)]">
                    Jump directly to flashcards, focus timer, or website appearance.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onOpenRevisionCards}
                    className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                  >
                    <Library className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                    <span>Flashcard Library</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenPlannerOptions}
                    className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                    <span>Planner &amp; Timer</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenCustomize}
                    className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                  >
                    <Palette className="h-3.5 w-3.5 text-[var(--ok)]" aria-hidden="true" />
                    <span>Website Styling</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Reset Workspace */}
            <div className="sd-card border-[color-mix(in_srgb,var(--bad)_40%,var(--line))] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-bold text-[var(--ink)]">
                    Start Fresh (Clear Workspace Data)
                  </h3>
                  <p className="text-xs text-[var(--mute)]">
                    Clears all subjects, flashcards, notes, timelines, and planner items back to an empty workspace.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {armReset && (
                    <button
                      type="button"
                      disabled={resettingWorkspace}
                      onClick={() => setArmReset(false)}
                      className="sd-btn px-3 py-1.5 text-xs"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={resettingWorkspace}
                    onClick={async () => {
                      if (!armReset) {
                        setArmReset(true);
                        return;
                      }
                      setResettingWorkspace(true);
                      try {
                        await onResetWorkspace();
                        setArmReset(false);
                      } finally {
                        setResettingWorkspace(false);
                      }
                    }}
                    className="sd-btn px-3 py-1.5 text-xs text-[var(--bad)] whitespace-nowrap"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {resettingWorkspace
                        ? 'Clearing…'
                        : armReset
                        ? 'Confirm: Clear all data'
                        : 'Start fresh (clear workspace)'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {section === 'admin' && isAdmin && firebaseUser && (
          <div className="sd-card overflow-hidden">
            <AdminPanel
              currentAdminUid={firebaseUser.uid}
              currentAdminEmail={firebaseUser.email}
              currentAdminAccount={account}
            />
          </div>
        )}

        {section === 'account' && (!firebaseUser || !vaultUnlocked ? (
          <div className="space-y-6">
            <div className="sd-card p-6">
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                    {!firebaseUser
                      ? 'Enable Encrypted Multi-Device Cloud Sync'
                      : 'Your Vault Is Locked'}
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm text-[var(--mute)]">
                    {!firebaseUser
                      ? 'Sign in with Google to protect your flashcards, structured notes, planner schedule, and private profile with client-side AES-256-GCM encryption across every device.'
                      : 'Enter your sync passphrase or recovery code to decrypt your workspace and synchronize changes across devices.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="sd-btn-pri shrink-0 px-5 py-2.5 text-sm whitespace-nowrap"
                >
                  {!firebaseUser ? 'Sign in with Google' : 'Unlock Vault'}
                </button>
              </div>
            </div>

            <div className="sd-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                    Export &amp; Restore Backups
                  </h2>
                  <p className="mt-0.5 text-xs text-[var(--mute)]">
                    Export all your data or specific sections without signing in.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSection('data')}
                  className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap"
                >
                  <Database className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Open Data &amp; Backups</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <section className="space-y-6 lg:col-span-7">
              <form onSubmit={handleProfileSubmit} className="sd-card p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                      Encrypted Student Profile
                    </h2>
                    <p className="mt-0.5 text-xs text-[var(--mute)]">
                      Stored in isolated private subcollection · Encrypted client-side with AES-256-GCM
                    </p>
                  </div>
                  <ShieldCheck className="h-5 w-5 text-[var(--ok)]" aria-hidden="true" />
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--mute)]">
                      Full Name
                      <input
                        type="text"
                        value={form.fullName}
                        onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                        className="sd-input mt-1"
                      />
                    </label>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--mute)]">
                      Verified Email
                      <input
                        type="email"
                        value={form.email}
                        readOnly
                        className="sd-input mt-1"
                      />
                    </label>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--mute)]">
                      School / Institution
                      <input
                        type="text"
                        value={form.school}
                        onChange={(e) => setForm({ ...form, school: e.target.value })}
                        placeholder="Optional"
                        className="sd-input mt-1"
                      />
                    </label>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--mute)]">
                      Year Group
                      <input
                        type="text"
                        value={form.yearGroup}
                        onChange={(e) => setForm({ ...form, yearGroup: e.target.value })}
                        placeholder="e.g. Year 11 / GCSE"
                        className="sd-input mt-1"
                      />
                    </label>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--mute)]">
                      Exam Boards
                      <input
                        type="text"
                        value={form.examBoard}
                        onChange={(e) => setForm({ ...form, examBoard: e.target.value })}
                        className="sd-input mt-1"
                      />
                    </label>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--mute)]">
                      Target Grades
                      <input
                        type="text"
                        value={form.targetGrades}
                        onChange={(e) => setForm({ ...form, targetGrades: e.target.value })}
                        placeholder="e.g. A* / 8-9"
                        className="sd-input mt-1"
                      />
                    </label>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-xs font-semibold text-[var(--mute)]">
                    Encrypted Personal Study Goal
                    <textarea
                      rows={3}
                      value={form.studyNotes}
                      onChange={(e) => setForm({ ...form, studyNotes: e.target.value })}
                      placeholder="Private revision goals or reminders..."
                      className="sd-input mt-1"
                    />
                  </label>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-[var(--mute)]">
                    {profileSaved ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-[var(--ok)]">
                        <Check className="h-3.5 w-3.5" aria-hidden="true" /> Encrypted &amp; saved to cloud
                      </span>
                    ) : (
                      'Changes sync instantly across signed-in devices'
                    )}
                  </span>
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="sd-btn-pri px-4 py-2 text-sm whitespace-nowrap"
                  >
                    {savingProfile ? 'Encrypting...' : 'Save Encrypted Profile'}
                  </button>
                </div>
              </form>

              <div className="sd-card p-6">
                <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                  Vault Security &amp; Key Rotation
                </h2>
                <p className="mt-1 text-xs text-[var(--mute)]">
                  PBKDF2-SHA256 (310,000 iterations) · AES-GCM-256 · Key version{' '}
                  <span className="font-mono-num">{account?.keyVersion ?? 1}</span>
                </p>

                {secError && (
                  <div className="mt-3 rounded-lg border border-[var(--bad)] bg-[var(--bg)] px-3 py-2 text-xs font-medium text-[var(--bad)]">
                    {secError}
                  </div>
                )}

                {rotatedCode && (
                  <div className="mt-3 rounded-lg border border-[var(--ok)] bg-[var(--bg)] p-3 text-xs text-[var(--ink)]">
                    <p className="font-semibold text-[var(--ok)]">
                      Passphrase rotated. Save your new recovery code:
                    </p>
                    <code className="font-mono-num mt-1 block text-sm font-bold">{rotatedCode}</code>
                  </div>
                )}

                <form onSubmit={handleRotate} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    type="password"
                    minLength={8}
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    placeholder="New passphrase (8+ chars)"
                    className="sd-input"
                  />
                  <input
                    type="password"
                    minLength={8}
                    value={confirmPass}
                    onChange={(e) => setConfirmPass(e.target.value)}
                    placeholder="Confirm new passphrase"
                    className="sd-input"
                  />
                  <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                    <button
                      type="submit"
                      disabled={busySec}
                      className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap"
                    >
                      <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{busySec ? 'Rotating...' : 'Rotate Passphrase'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void onLockVault()}
                      className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap"
                    >
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Lock Vault on This Device</span>
                    </button>
                  </div>
                </form>
              </div>
            </section>

            <section className="space-y-6 lg:col-span-5">
              <div className="sd-card p-6">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                    Cloud Synchronization
                  </h2>
                  <button
                    type="button"
                    onClick={() => void onForceSync()}
                    className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${syncState === 'syncing' ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>Sync now</span>
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                    <div className="text-xs text-[var(--mute)]">Encrypted Docs</div>
                    <div className="font-mono-num mt-1 text-xl font-bold text-[var(--ink)]">
                      {chunkCount}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                    <div className="text-xs text-[var(--mute)]">Sync Status</div>
                    <div className="mt-1 text-sm font-semibold capitalize text-[var(--e3)]">
                      {syncState}
                    </div>
                  </div>
                </div>

                {hasGuestData && (
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs">
                    <span className="text-[var(--ink)]">
                      Local guest browser data detected.
                    </span>
                    <button
                      type="button"
                      onClick={() => void onImportGuestData()}
                      className="sd-btn-pri shrink-0 px-2.5 py-1.5 text-xs whitespace-nowrap"
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Merge into Cloud</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="sd-card p-6">
                <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                  Connected Devices
                </h2>
                <form onSubmit={handleRenameDevice} className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={devName}
                    onChange={(e) => setDevName(e.target.value)}
                    placeholder="This device name"
                    className="sd-input min-w-0 flex-1 py-1.5 text-xs"
                  />
                  <button type="submit" className="sd-btn shrink-0 px-3 py-1.5 text-xs">
                    Rename
                  </button>
                </form>

                <div className="mt-4 divide-y divide-[var(--line)]">
                  {devices.map((d) => {
                    const isCurrent = d.deviceId === currentDev.deviceId;
                    const lastSeen =
                      d.lastSeenAt && typeof d.lastSeenAt.toDate === 'function'
                        ? d.lastSeenAt.toDate().toLocaleString()
                        : 'Active now';
                    return (
                      <div key={d.deviceId} className="flex items-center justify-between gap-3 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          {d.platform.includes('iOS') || d.platform.includes('Android') ? (
                            <Smartphone className="h-4 w-4 shrink-0 text-[var(--mute)]" aria-hidden="true" />
                          ) : (
                            <Laptop className="h-4 w-4 shrink-0 text-[var(--mute)]" aria-hidden="true" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-[var(--ink)]">
                              {d.deviceName}
                              {isCurrent && (
                                <span className="ml-2 text-xs font-semibold text-[var(--e3)]">
                                  · This device
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[var(--mute)]">
                              {d.platform} · {lastSeen}
                            </div>
                          </div>
                        </div>
                        {!isCurrent && (
                          <button
                            type="button"
                            onClick={() => void onRemoveDevice(d.deviceId)}
                            title="Remove device"
                            className="cursor-pointer rounded-lg p-1.5 text-[var(--mute)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--bad)]"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {!devices.length && (
                    <p className="py-3 text-xs text-[var(--mute)]">
                      Registering device session...
                    </p>
                  )}
                </div>
              </div>

              <div className="sd-card p-6">
                <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                  Security Audit Trail
                </h2>
                <div className="mt-3 divide-y divide-[var(--line)]">
                  {activity.slice(0, 8).map((a) => {
                    const when =
                      a.createdAt && typeof a.createdAt.toDate === 'function'
                        ? a.createdAt.toDate().toLocaleString()
                        : 'Just now';
                    return (
                      <div key={a.id} className="py-2.5 text-xs">
                        <div className="font-semibold text-[var(--ink)]">{a.action}</div>
                        <div className="mt-0.5 text-[var(--mute)]">
                          {a.deviceName} · {when}
                        </div>
                      </div>
                    );
                  })}
                  {!activity.length && (
                    <p className="py-2 text-xs text-[var(--mute)]">
                      No recent security events.
                    </p>
                  )}
                </div>
              </div>
            </section>
          </div>
        ))}
      </div>
    </div>
  );
}

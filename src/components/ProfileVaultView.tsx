import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
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
import { buildStudyPackFromDraft, parseStudyPackInput } from '../lib/packParser';
import { BOOTSTRAP_ADMIN_EMAIL } from '../lib/syncService';
import {
  DeckSnapshot,
  DecryptedProfile,
  StudyPack,
  UserAccountDoc,
  UserActivityDoc,
  UserDeviceDoc,
} from '../types';

export type VaultSection = 'account' | 'data' | 'admin';

export type BackupCategory =
  | 'notes'
  | 'flashcards'
  | 'timelines'
  | 'planner'
  | 'subjects';

interface WorkspaceSnapshot {
  revision: Record<string, string>;
  planner: Record<string, string>;
}

interface ProfileVaultViewProps {
  firebaseUser: User | null;
  account: UserAccountDoc | null;
  vaultUnlocked: boolean;
  profile: DecryptedProfile | null;
  devices: UserDeviceDoc[];
  activity: UserActivityDoc[];
  chunkCount: number;
  syncState: 'idle' | 'syncing' | 'synced' | 'error' | 'offline';
  hasGuestData: boolean;
  deckSnapshot?: DeckSnapshot;
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
  onOpenRevisionCards: () => void;
  onOpenPlannerOptions: () => void;
  onGetWorkspaceSnapshot: () => Promise<WorkspaceSnapshot>;
  onImportWorkspaceData: (payload: {
    revision: Record<string, string>;
    planner: Record<string, string>;
    mode: 'merge' | 'replace';
  }) => Promise<void>;
  onApplyImportedPack?: (pack: StudyPack) => Promise<void>;
  onResetWorkspace: () => Promise<void>;
}

const ALL_CATEGORIES: {
  id: BackupCategory;
  label: string;
  desc: string;
}[] = [
  { id: 'notes', label: 'Notes', desc: 'Formatted study notes & Word doc imports' },
  { id: 'flashcards', label: 'Flashcards', desc: 'Custom cards, decks & spaced-repetition progress' },
  { id: 'timelines', label: 'Timelines & Mindmaps', desc: 'Custom milestones, eras, known dates & mindmaps' },
  { id: 'planner', label: 'Planner & To-Do', desc: 'Home widgets, to-do tasks, schedule & mocks' },
  { id: 'subjects', label: 'Subjects & Settings', desc: 'Custom subjects/topics, section layouts & theme' },
];

function classifyRevisionKey(key: string): BackupCategory {
  if (/^gdoc-/.test(key) && !/-cfg$/.test(key)) return 'notes';
  if (/^(fc-state|cb-ui)$/.test(key)) return 'flashcards';
  if (/^(edits-|known-|mindmap-)/.test(key)) return 'timelines';
  return 'subjects';
}

function summarizeSnapshot(snap: WorkspaceSnapshot, deckSnapshot?: DeckSnapshot) {
  let noteDocs = 0;
  let customCards = 0;
  let cardProgress = 0;
  let timelineEdits = 0;
  let mindmaps = 0;
  let plannerTasks = 0;
  let plannerMocks = 0;
  let plannerSubjects = 0;
  let customSubjects = 0;

  const countsByCat: Record<BackupCategory, number> = {
    notes: 0,
    flashcards: 0,
    timelines: 0,
    planner: 0,
    subjects: 0,
  };

  for (const [k, v] of Object.entries(snap.revision || {})) {
    const cat = classifyRevisionKey(k);
    countsByCat[cat] += 1;
    if (cat === 'notes' && v) {
      const stripped = v.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
      if (stripped.length > 0) noteDocs += 1;
    }
    if (k === 'fc-state') {
      try {
        const fc = JSON.parse(v) as { add?: unknown[]; prog?: Record<string, unknown> };
        customCards = Array.isArray(fc.add) ? fc.add.length : 0;
        cardProgress = fc.prog ? Object.keys(fc.prog).length : 0;
      } catch {
        // ignore
      }
    }
    if (/^edits-/.test(k)) {
      try {
        const ed = JSON.parse(v) as {
          add?: unknown[];
          mod?: Record<string, unknown>;
          del?: unknown[];
          ne?: unknown[];
        };
        const hasAny =
          (Array.isArray(ed.add) && ed.add.length > 0) ||
          (ed.mod && Object.keys(ed.mod).length > 0) ||
          (Array.isArray(ed.del) && ed.del.length > 0) ||
          (Array.isArray(ed.ne) && ed.ne.length > 0);
        if (hasAny) timelineEdits += 1;
      } catch {
        timelineEdits += 1;
      }
    }
    if (/^mindmap-/.test(k)) mindmaps += 1;
    if (k === 'user-subjects') {
      try {
        const reg = JSON.parse(v) as {
          subs?: unknown[];
          extraTopics?: unknown[];
          baseTopics?: unknown[];
        };
        customSubjects =
          (Array.isArray(reg.subs) ? reg.subs.length : 0) +
          (Array.isArray(reg.baseTopics) && reg.baseTopics.length > 0 ? 1 : 0);
      } catch {
        // ignore
      }
    }
  }

  for (const [, v] of Object.entries(snap.planner || {})) {
    countsByCat.planner += 1;
    try {
      const pl = JSON.parse(v) as {
        todos?: unknown[];
        td?: { items?: unknown[] };
        mocks?: unknown[];
        scores?: unknown[];
        subs?: Array<{ on?: boolean; ex?: unknown[] }>;
      };
      if (Array.isArray(pl.td?.items)) plannerTasks += pl.td.items.length;
      else if (Array.isArray(pl.todos)) plannerTasks += pl.todos.length;

      if (Array.isArray(pl.scores)) plannerMocks += pl.scores.length;
      if (Array.isArray(pl.mocks)) plannerMocks += pl.mocks.length;
      if (Array.isArray(pl.subs)) {
        const activeSubs = pl.subs.filter((s) => s && s.on !== false);
        plannerSubjects += activeSubs.length;
        for (const s of activeSubs) {
          if (Array.isArray(s.ex)) plannerMocks += s.ex.length;
        }
      }
    } catch {
      // ignore
    }
  }

  const totalCards = deckSnapshot ? deckSnapshot.cards.length : customCards;
  const activeSubjects = deckSnapshot
    ? Math.max(deckSnapshot.subjects.length, plannerSubjects)
    : Math.max(customSubjects, plannerSubjects);
  const totalTopics = deckSnapshot ? deckSnapshot.topics.length : 0;

  return {
    countsByCat,
    noteDocs,
    totalCards,
    customCards,
    cardProgress,
    timelineEdits,
    mindmaps,
    plannerTasks,
    plannerMocks,
    plannerSubjects,
    customSubjects,
    activeSubjects,
    totalTopics,
  };
}

function filterSnapshotByCategories(
  snap: WorkspaceSnapshot,
  selected: Record<BackupCategory, boolean>
): WorkspaceSnapshot {
  const revision: Record<string, string> = {};
  for (const [k, v] of Object.entries(snap.revision || {})) {
    const cat = classifyRevisionKey(k);
    if (selected[cat]) revision[k] = v;
  }
  const planner: Record<string, string> = {};
  if (selected.planner) {
    for (const [k, v] of Object.entries(snap.planner || {})) {
      planner[k] = v;
    }
  }
  return { revision, planner };
}

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

export function ProfileVaultView({
  firebaseUser,
  account,
  vaultUnlocked,
  profile,
  devices,
  activity,
  chunkCount,
  syncState,
  hasGuestData,
  deckSnapshot,
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
  onOpenRevisionCards,
  onOpenPlannerOptions,
  onGetWorkspaceSnapshot,
  onImportWorkspaceData,
  onApplyImportedPack,
  onResetWorkspace,
}: ProfileVaultViewProps) {
  const currentDev = getDeviceInfo();
  const [section, setSection] = useState<VaultSection>(initialSection);
  const [form, setForm] = useState<DecryptedProfile>({
    email: firebaseUser?.email || '',
    fullName: firebaseUser?.displayName || '',
    school: '',
    yearGroup: '',
    examBoard: 'Edexcel / Cambridge',
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

  // Data & Backup Center state
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>({ revision: {}, planner: {} });
  const [loadingSnap, setLoadingSnap] = useState(false);
  const [exportCats, setExportCats] = useState<Record<BackupCategory, boolean>>({
    notes: true,
    flashcards: true,
    timelines: true,
    planner: true,
    subjects: true,
  });
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const [importSourceTab, setImportSourceTab] = useState<'file' | 'text'>('file');
  const [importTextRaw, setImportTextRaw] = useState('');
  const [parsedImport, setParsedImport] = useState<{
    fileName: string;
    revision: Record<string, string>;
    planner: Record<string, string>;
    available: Record<BackupCategory, boolean>;
    textPack?: StudyPack;
    textStats?: { subjects: number; topics: number; cards: number; notes: number; todos: number };
  } | null>(null);
  const [importCats, setImportCats] = useState<Record<BackupCategory, boolean>>({
    notes: true,
    flashcards: true,
    timelines: true,
    planner: true,
    subjects: true,
  });
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importStatus, setImportStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [importing, setImporting] = useState(false);

  const refreshSnapshot = useCallback(async () => {
    setLoadingSnap(true);
    try {
      const snap = await onGetWorkspaceSnapshot();
      setSnapshot(snap);
    } finally {
      setLoadingSnap(false);
    }
  }, [onGetWorkspaceSnapshot]);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (section === 'data') {
      void refreshSnapshot();
    }
  }, [section, refreshSnapshot]);

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

  const snapSummary = useMemo(
    () => summarizeSnapshot(snapshot, deckSnapshot),
    [snapshot, deckSnapshot]
  );

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

  const buildBackupJson = async () => {
    const fresh = await onGetWorkspaceSnapshot();
    setSnapshot(fresh);
    const filtered = filterSnapshotByCategories(fresh, exportCats);
    const selectedList = ALL_CATEGORIES.filter((c) => exportCats[c.id]).map((c) => c.id);
    const payload = {
      app: 'studydeck',
      v: 2,
      exported: new Date().toISOString(),
      categories: selectedList,
      revision: filtered.revision,
      planner: filtered.planner,
    };
    return {
      json: JSON.stringify(payload, null, 2),
      itemCount:
        Object.keys(filtered.revision).length + Object.keys(filtered.planner).length,
    };
  };

  const handleDownloadJson = async () => {
    const { json, itemCount } = await buildBackupJson();
    if (!itemCount) {
      setExportStatus('No saved items matched your selected categories.');
      return;
    }
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadBlob(`studydeck-backup-${dateStr}.json`, json, 'application/json');
    setExportStatus(`Downloaded backup with ${itemCount} data records.`);
  };

  const handleCopyJson = async () => {
    const { json, itemCount } = await buildBackupJson();
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

  const handleDownloadFlashcardsCsv = async () => {
    const fresh = await onGetWorkspaceSnapshot();
    setSnapshot(fresh);
    const rawFc = fresh.revision['fc-state'];
    if (!rawFc) {
      setExportStatus('No custom flashcards saved yet.');
      return;
    }
    try {
      const fc = JSON.parse(rawFc) as {
        add?: { q?: string; a?: string; s?: string }[];
        secs?: { id?: string; n?: string }[];
      };
      const secMap = new Map((fc.secs || []).map((s) => [s.id || '', s.n || 'Custom']));
      const cards = fc.add || [];
      if (!cards.length) {
        setExportStatus('No custom flashcards added yet.');
        return;
      }
      const csv =
        'question,answer,section\n' +
        cards
          .map((c) => [csvCell(c.q || ''), csvCell(c.a || ''), csvCell(secMap.get(c.s || '') || 'Custom')].join(','))
          .join('\n');
      downloadBlob(`studydeck-custom-cards-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
      setExportStatus(`Exported ${cards.length} custom flashcard(s) as CSV.`);
    } catch {
      setExportStatus('Could not parse flashcards.');
    }
  };

  const handleDownloadNotesHtml = async () => {
    const fresh = await onGetWorkspaceSnapshot();
    setSnapshot(fresh);
    const docs = Object.entries(fresh.revision).filter(
      ([k, v]) => /^gdoc-/.test(k) && !/-cfg$/.test(k) && v && v.replace(/<[^>]*>/g, '').trim()
    );
    if (!docs.length) {
      setExportStatus('No edited notes saved yet.');
      return;
    }
    const htmlBody = docs
      .map(([k, v]) => `<section><h1>${k.replace(/^gdoc-/, '')}</h1>${v}</section><hr>`)
      .join('\n');
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>StudyDeck Notes</title><style>body{font-family:system-ui,sans-serif;max-width:820px;margin:32px auto;padding:0 20px;line-height:1.55}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px}</style></head><body>${htmlBody}</body></html>`;
    downloadBlob(`studydeck-notes-${new Date().toISOString().slice(0, 10)}.html`, doc, 'text/html');
    setExportStatus(`Exported ${docs.length} note document(s) as HTML.`);
  };

  const handleDownloadTodosCsv = async () => {
    const fresh = await onGetWorkspaceSnapshot();
    setSnapshot(fresh);
    const rawPl = fresh.planner['mockplanner.v1'];
    if (!rawPl) {
      setExportStatus('No planner or to-do data saved yet.');
      return;
    }
    try {
      const pl = JSON.parse(rawPl) as {
        subs?: { n?: string }[];
        td?: {
          items?: {
            t?: string;
            i?: number | null;
            d?: string;
            pri?: number;
            c?: string;
            done?: number | boolean;
          }[];
        };
        todos?: { text?: string; subj?: string; due?: string; pri?: string; done?: boolean }[];
      };
      const rows =
        Array.isArray(pl.td?.items) && pl.td.items.length
          ? pl.td.items.map((item) => ({
              task: item.t || '',
              subject:
                item.i != null && pl.subs?.[item.i]?.n ? pl.subs[item.i].n || '' : '',
              due: item.d || '',
              priority: item.pri === 3 ? 'High' : item.pri === 2 ? 'Medium' : 'Normal',
              done: Boolean(item.done),
            }))
          : (pl.todos || []).map((t) => ({
              task: t.text || '',
              subject: t.subj || '',
              due: t.due || '',
              priority: t.pri || '',
              done: Boolean(t.done),
            }));

      if (!rows.length) {
        setExportStatus('No to-do tasks saved yet.');
        return;
      }
      const csv =
        'task,subject,due_date,priority,completed\n' +
        rows
          .map((t) =>
            [
              csvCell(t.task),
              csvCell(t.subject),
              csvCell(t.due),
              csvCell(t.priority),
              csvCell(t.done ? 'Yes' : 'No'),
            ].join(',')
          )
          .join('\n');
      downloadBlob(`studydeck-todos-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
      setExportStatus(`Exported ${rows.length} to-do task(s) as CSV.`);
    } catch {
      setExportStatus('Could not parse to-do tasks.');
    }
  };

  const parseRawImportText = (raw: string, sourceLabel: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setParsedImport(null);
      setImportStatus({ ok: false, msg: 'Paste JSON backup data or study text first.' });
      return;
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        const rev: Record<string, string> = {};
        const pln: Record<string, string> = {};

        if (obj && obj.app === 'studydeck') {
          const rObj = (obj.revision && typeof obj.revision === 'object' ? obj.revision : {}) as Record<string, unknown>;
          const pObj = (obj.planner && typeof obj.planner === 'object' ? obj.planner : {}) as Record<string, unknown>;
          for (const [k, v] of Object.entries(rObj)) {
            if (typeof v === 'string') rev[k] = v;
          }
          for (const [k, v] of Object.entries(pObj)) {
            if (typeof v === 'string') pln[k] = v;
          }
        } else if (obj && obj.app === 'revision-site' && obj.data && typeof obj.data === 'object') {
          for (const [k, v] of Object.entries(obj.data as Record<string, unknown>)) {
            if (typeof v === 'string') rev[k] = v;
          }
        } else if (
          obj &&
          obj.app === 'mock-revision-planner' &&
          obj.data &&
          typeof obj.data === 'object'
        ) {
          pln['mockplanner.v1'] = JSON.stringify(obj.data);
        } else if (
          obj &&
          (Array.isArray(obj.subs) ||
            Array.isArray(obj.todos) ||
            Array.isArray(obj.blocks) ||
            (obj.td && typeof obj.td === 'object'))
        ) {
          pln['mockplanner.v1'] = JSON.stringify(obj);
        } else {
          setParsedImport(null);
          setImportStatus({
            ok: false,
            msg: 'Unrecognized JSON format. Paste a StudyDeck, Revision, or Planner JSON backup — or plain study text/CSV.',
          });
          return;
        }

        const available: Record<BackupCategory, boolean> = {
          notes: false,
          flashcards: false,
          timelines: false,
          planner: Object.keys(pln).length > 0,
          subjects: false,
        };
        for (const k of Object.keys(rev)) {
          available[classifyRevisionKey(k)] = true;
        }

        if (!Object.values(available).some(Boolean)) {
          setParsedImport(null);
          setImportStatus({ ok: false, msg: 'This JSON contains no data records.' });
          return;
        }

        setParsedImport({ fileName: sourceLabel, revision: rev, planner: pln, available });
        setImportCats({ ...available });
        setImportStatus(null);
        return;
      } catch {
        setParsedImport(null);
        setImportStatus({
          ok: false,
          msg: 'Invalid JSON syntax. Check for missing braces/quotes, or import plain text instead.',
        });
        return;
      }
    }

    // Parse plain text / Markdown / CSV / Study Pack template format
    const draft = parseStudyPackInput(trimmed, {
      fallbackTitle: 'Imported Text Data',
    });
    const hasContent =
      draft.subjects.length > 0 ||
      draft.cards.length > 0 ||
      draft.notesByTopic.some((n) => n.notesLines.length > 0) ||
      draft.todos.length > 0;

    if (!hasContent) {
      setParsedImport(null);
      setImportStatus({
        ok: false,
        msg: 'Could not detect subjects, flashcards (Q | A or CSV), notes, or to-dos in that text.',
      });
      return;
    }

    const pack = buildStudyPackFromDraft(draft, {
      title: draft.title || 'Text Import',
      subtitle: draft.subtitle || 'Imported from pasted text',
      examBoard: draft.examBoard || 'Imported Data',
      category:
        draft.cards.length && !draft.notesByTopic.some((n) => n.notesLines.length)
          ? 'flashcards'
          : 'combo',
      includeSubjects: true,
      includeFlashcards: draft.cards.length > 0,
      includeNotes: draft.notesByTopic.some((n) => n.notesLines.length > 0),
      includeTodos: draft.todos.length > 0,
    });

    const available: Record<BackupCategory, boolean> = {
      notes: draft.notesByTopic.some((n) => n.notesLines.length > 0),
      flashcards: draft.cards.length > 0,
      timelines: false,
      planner: draft.todos.length > 0 || draft.subjects.length > 0,
      subjects: draft.subjects.length > 0,
    };

    setParsedImport({
      fileName: sourceLabel,
      revision: {},
      planner: {},
      available,
      textPack: pack,
      textStats: {
        subjects: draft.subjects.length,
        topics: draft.subjects.reduce((sum, s) => sum + s.topics.length, 0),
        cards: draft.cards.length,
        notes: draft.notesByTopic.filter((n) => n.notesLines.length > 0).length,
        todos: draft.todos.length,
      },
    });
    setImportCats({ ...available });
    setImportStatus(null);
  };

  const handleImportFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus(null);
    const reader = new FileReader();
    reader.onload = () => {
      parseRawImportText(String(reader.result || ''), file.name);
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleRunImport = async () => {
    if (!parsedImport) return;
    if (parsedImport.textPack && onApplyImportedPack) {
      setImporting(true);
      setImportStatus(null);
      try {
        const src = parsedImport.textPack;
        const filteredPack: StudyPack = {
          ...src,
          revision: {
            ...src.revision,
            subjects:
              importCats.subjects || importCats.notes || importCats.flashcards
                ? (src.revision.subjects || []).map((s) => ({
                    ...s,
                    topics: s.topics.map((t) => ({
                      ...t,
                      notesHtml: importCats.notes ? t.notesHtml : '',
                    })),
                  }))
                : [],
            sections: importCats.flashcards ? src.revision.sections : [],
            cards: importCats.flashcards ? src.revision.cards : [],
          },
          planner: {
            ...src.planner,
            subjects: importCats.subjects || importCats.planner ? src.planner.subjects : [],
            todos: importCats.planner ? src.planner.todos : [],
          },
        };
        await onApplyImportedPack(filteredPack);
        await refreshSnapshot();
        setImportStatus({
          ok: true,
          msg: `Imported study data from ${parsedImport.fileName} into your workspace.`,
        });
        setParsedImport(null);
        setImportTextRaw('');
      } catch (err) {
        setImportStatus({
          ok: false,
          msg: err instanceof Error ? err.message : 'Text import failed.',
        });
      } finally {
        setImporting(false);
      }
      return;
    }

    const filtered = filterSnapshotByCategories(
      { revision: parsedImport.revision, planner: parsedImport.planner },
      importCats
    );
    const totalKeys =
      Object.keys(filtered.revision).length + Object.keys(filtered.planner).length;
    if (!totalKeys) {
      setImportStatus({ ok: false, msg: 'Select at least one data section to import.' });
      return;
    }
    setImporting(true);
    setImportStatus(null);
    try {
      await onImportWorkspaceData({
        revision: filtered.revision,
        planner: filtered.planner,
        mode: importMode,
      });
      await refreshSnapshot();
      setImportStatus({
        ok: true,
        msg: `Imported ${totalKeys} section(s) from ${parsedImport.fileName} (${importMode} mode).`,
      });
      setParsedImport(null);
      setImportTextRaw('');
    } catch (err) {
      setImportStatus({
        ok: false,
        msg: err instanceof Error ? err.message : 'Import failed.',
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
                className="sd-btn px-3.5 py-2 text-xs"
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
                      ? 'Synced live with your encrypted AES-256-GCM cloud vault.'
                      : 'Stored in your browser. Export any part or all of your workspace below.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshSnapshot()}
                  disabled={loadingSnap}
                  className="sd-btn px-3 py-1.5 text-xs"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${loadingSnap ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>Refresh counts</span>
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="text-xs font-semibold text-[var(--mute)]">Notes</div>
                  <div className="font-mono-num mt-1 text-xl font-bold text-[var(--ink)]">
                    {snapSummary.noteDocs}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--mute)]">edited topic docs</div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="text-xs font-semibold text-[var(--mute)]">Flashcards</div>
                  <div className="font-mono-num mt-1 text-xl font-bold text-[var(--ink)]">
                    {snapSummary.totalCards}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--mute)]">
                    {snapSummary.customCards} custom · {snapSummary.cardProgress} tracked
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="text-xs font-semibold text-[var(--mute)]">Timelines &amp; Maps</div>
                  <div className="font-mono-num mt-1 text-xl font-bold text-[var(--ink)]">
                    {snapSummary.timelineEdits + snapSummary.mindmaps}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--mute)]">
                    {snapSummary.timelineEdits} timelines · {snapSummary.mindmaps} maps
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="text-xs font-semibold text-[var(--mute)]">Planner &amp; To-Do</div>
                  <div className="font-mono-num mt-1 text-xl font-bold text-[var(--ink)]">
                    {snapSummary.plannerTasks}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--mute)]">
                    tasks · {snapSummary.plannerMocks} papers/scores
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="text-xs font-semibold text-[var(--mute)]">Subjects</div>
                  <div className="font-mono-num mt-1 text-xl font-bold text-[var(--ink)]">
                    {snapSummary.activeSubjects}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--mute)]">
                    {snapSummary.totalTopics} topics total
                  </div>
                </div>
              </div>
            </div>

            {/* Selective Export & Import Grid */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Export Card */}
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
                            notes: true,
                            flashcards: true,
                            timelines: true,
                            planner: true,
                            subjects: true,
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
                            notes: false,
                            flashcards: false,
                            timelines: false,
                            planner: false,
                            subjects: false,
                          })
                        }
                        className="cursor-pointer text-xs font-semibold text-[var(--mute)] hover:underline"
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-[var(--mute)]">
                    Choose everything or just the sections you want to save or transfer.
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
                          <div className="flex items-center justify-between gap-2 text-sm font-bold text-[var(--ink)]">
                            <span>{c.label}</span>
                            <span className="font-mono-num text-xs font-semibold text-[var(--mute)]">
                              {snapSummary.countsByCat[c.id]} key{snapSummary.countsByCat[c.id] === 1 ? '' : 's'}
                            </span>
                          </div>
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
                      onClick={() => void handleDownloadJson()}
                      className="sd-btn-pri px-4 py-2 text-xs"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Download JSON backup</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopyJson()}
                      className="sd-btn px-3.5 py-2 text-xs"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Copy JSON</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-xs font-semibold text-[var(--mute)]">Quick readable files:</span>
                    <button
                      type="button"
                      onClick={() => void handleDownloadFlashcardsCsv()}
                      className="sd-btn px-2.5 py-1.5 text-xs"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                      <span>Flashcards (.csv)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadNotesHtml()}
                      className="sd-btn px-2.5 py-1.5 text-xs"
                    >
                      <FileText className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                      <span>Notes (.html)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadTodosCsv()}
                      className="sd-btn px-2.5 py-1.5 text-xs"
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

              {/* Import Card */}
              <div className="sd-card flex flex-col justify-between p-6">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                      Import Data
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
                        Paste Text / JSON
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-[var(--mute)]">
                    Restore a StudyDeck, Revision, or Planner JSON backup, or paste formatted notes, CSV flashcards, and study text directly.
                  </p>

                  {importSourceTab === 'file' ? (
                    <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--line)] bg-[var(--bg)] px-4 py-6 text-center transition-colors hover:border-[var(--e3)]">
                      <Upload className="h-5 w-5 text-[var(--e3)]" aria-hidden="true" />
                      <span className="text-sm font-bold text-[var(--ink)]">
                        {parsedImport ? parsedImport.fileName : 'Choose .json, .txt, .md, or .csv file'}
                      </span>
                      <span className="text-xs text-[var(--mute)]">
                        Supports StudyDeck JSON backups as well as text, Markdown, and CSV flashcards
                      </span>
                      <input
                        type="file"
                        accept=".json,.txt,.md,.csv,application/json,text/plain,text/csv"
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
                        placeholder={
                          'Paste a StudyDeck JSON backup, or study text/CSV:\n\n[Subject: Biology]\nTopics: Cells, Enzymes\n[Flashcards | Biology > Cells]\nDefine osmosis | Water movement across a partially permeable membrane'
                        }
                        className="sd-input font-mono-num text-xs leading-relaxed"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => parseRawImportText(importTextRaw, 'Pasted Text')}
                          className="sd-btn px-3.5 py-1.5 text-xs whitespace-nowrap"
                        >
                          Parse &amp; Preview Text
                        </button>
                      </div>
                    </div>
                  )}

                  {parsedImport && (
                    <div className="mt-4 space-y-3">
                      <div className="text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                        {parsedImport.textStats
                          ? `Detected from ${parsedImport.fileName}: ${parsedImport.textStats.subjects} subjects · ${parsedImport.textStats.topics} topics · ${parsedImport.textStats.cards} cards · ${parsedImport.textStats.notes} notes · ${parsedImport.textStats.todos} to-dos`
                          : 'Sections found in backup'}
                      </div>
                      <div className="space-y-1.5">
                        {ALL_CATEGORIES.filter((c) => parsedImport.available[c.id]).map((c) => (
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

                      {!parsedImport.textPack && (
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
                                Replace — overwrite selected sections with backup
                              </option>
                            </select>
                          </label>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={importing}
                          onClick={() => void handleRunImport()}
                          className="sd-btn-pri px-4 py-2 text-xs"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{importing ? 'Importing...' : 'Apply selected import'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setParsedImport(null)}
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
                    Jump directly to flashcards, planner preferences, or whole-website styling.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onOpenRevisionCards}
                    className="sd-btn px-3 py-1.5 text-xs"
                  >
                    <Library className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                    <span>Flashcard Library</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenPlannerOptions}
                    className="sd-btn px-3 py-1.5 text-xs"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                    <span>Planner Options</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenCustomize}
                    className="sd-btn px-3 py-1.5 text-xs"
                  >
                    <Palette className="h-3.5 w-3.5 text-[var(--ok)]" aria-hidden="true" />
                    <span>Website Styling</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Reset Workspace to Clean Empty State */}
            <div className="sd-card border-[color-mix(in_srgb,var(--bad)_40%,var(--line))] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-bold text-[var(--ink)]">
                    Start Fresh (Clear Workspace Data)
                  </h3>
                  <p className="text-xs text-[var(--mute)]">
                    Clears all subjects, flashcards, notes, timelines, tasks, and custom packs back
                    to an empty starter workspace. Export a backup above first if you want a copy.
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
                        await refreshSnapshot();
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
                      ? 'Sign in with Google and protect your Revision flashcards, Geography notes, Mock Planner tasks, and private profile with client-side AES-256-GCM encryption across every device and network.'
                      : 'Enter your sync passphrase or recovery code to decrypt your profile and synchronize changes across devices.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="sd-btn-pri shrink-0 px-5 py-2.5 text-sm"
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
                    Export all your data or specific sections (notes, flashcards, timelines, planner) without signing in.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSection('data')}
                  className="sd-btn px-3.5 py-2 text-xs"
                >
                  <Database className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Open Data &amp; Backups</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left column: Encrypted Profile */}
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
                        placeholder="e.g. Year 11 / IGCSE"
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
                    className="sd-btn-pri px-4 py-2 text-sm"
                  >
                    {savingProfile ? 'Encrypting...' : 'Save Encrypted Profile'}
                  </button>
                </div>
              </form>

              {/* Security & Key Rotation */}
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
                      className="sd-btn px-3.5 py-2 text-xs"
                    >
                      <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{busySec ? 'Rotating...' : 'Rotate Passphrase'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void onLockVault()}
                      className="sd-btn px-3.5 py-2 text-xs"
                    >
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Lock Vault on This Device</span>
                    </button>
                  </div>
                </form>
              </div>
            </section>

            {/* Right column: Cloud Sync Status, Devices, Audit Log */}
            <section className="space-y-6 lg:col-span-5">
              <div className="sd-card p-6">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                    Cloud Synchronization
                  </h2>
                  <button
                    type="button"
                    onClick={() => void onForceSync()}
                    className="sd-btn px-3 py-1.5 text-xs"
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
                    <div className="text-xs text-[var(--mute)]">Encrypted Chunks</div>
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
                      className="sd-btn-pri shrink-0 px-2.5 py-1.5 text-xs"
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

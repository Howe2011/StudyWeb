import { ChangeEvent, useMemo, useRef, useState } from 'react';
import {
  BookMarked,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Globe,
  Layers,
  Lock,
  Package,
  Plus,
  Power,
  RefreshCw,
  Repeat,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  buildStudyPackFromDraft,
  markdownLinesToHtml,
  parseDocxFile,
  parseStudyPackInput,
  STUDY_PACK_TEMPLATE_TEXT,
} from '../lib/packParser';
import { getPackFileName, serializeStudyPackFile } from '../lib/packFileStore';
import {
  DeckSnapshot,
  StudyPack,
  StudyPackCategory,
  StudyPackRevisionPayload,
} from '../types';

interface WorkspaceSnapshot {
  revision: Record<string, string>;
  planner: Record<string, string>;
}

interface StudyPacksViewProps {
  deckSnapshot: DeckSnapshot;
  customPacks: StudyPack[];
  appliedPackIds: string[];
  currentUserUid?: string | null;
  isSignedInVerified?: boolean;
  isAdmin?: boolean;
  onOpenAuth?: () => void;
  onApplyPack: (pack: StudyPack, options?: { replaceExisting?: boolean }) => Promise<void>;
  onDisablePack: (packId: string) => Promise<void>;
  onDisableAllPacks: () => Promise<void>;
  onSaveCustomPack: (pack: StudyPack) => Promise<void>;
  onTogglePackVisibility?: (pack: StudyPack, nextVisibility: 'public' | 'private') => Promise<void>;
  onDeleteCustomPack: (packId: string) => Promise<void>;
  onGetWorkspaceSnapshot: () => Promise<WorkspaceSnapshot>;
  onOpenFlashcards: () => void;
  onOpenStudyNotes: () => void;
  onOpenSubjects: () => void;
}

type FilterTab = 'all' | 'standard' | 'community' | 'mine' | 'active';
type BuilderSourceMode = 'quick' | 'file' | 'workspace';

interface QuickCardRow {
  id: string;
  q: string;
  a: string;
}

function stripHtmlPreview(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferCategory(subjCount: number, cardCount: number, noteCount: number): StudyPackCategory {
  if (subjCount > 1 || (cardCount > 0 && noteCount > 0)) return 'combo';
  if (cardCount > 0) return 'flashcards';
  return 'notes';
}

export function StudyPacksView({
  deckSnapshot,
  customPacks,
  appliedPackIds,
  currentUserUid,
  isSignedInVerified = false,
  isAdmin = false,
  onOpenAuth,
  onApplyPack,
  onDisablePack,
  onDisableAllPacks,
  onSaveCustomPack,
  onTogglePackVisibility,
  onDeleteCustomPack,
  onGetWorkspaceSnapshot,
  onOpenFlashcards,
  onOpenStudyNotes,
  onOpenSubjects,
}: StudyPacksViewProps) {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Builder state
  const [builderOpen, setBuilderOpen] = useState<boolean>(false);
  const [sourceMode, setSourceMode] = useState<BuilderSourceMode>('quick');
  const [showTemplateGuide, setShowTemplateGuide] = useState<boolean>(false);

  // Shared creator fields (minimal, clean)
  const [packTitle, setPackTitle] = useState('');
  const [packSubtitle, setPackSubtitle] = useState('');
  const [packBoard, setPackBoard] = useState('GCSE');
  const [packVisibility, setPackVisibility] = useState<'private' | 'public'>('private');
  const [togglingVisId, setTogglingVisId] = useState<string | null>(null);
  const [savingCustom, setSavingCustom] = useState(false);

  // Quick Form fields (no bracket syntax needed)
  const [quickSubject, setQuickSubject] = useState('');
  const [quickSpecs, setQuickSpecs] = useState('');
  const [quickNotes, setQuickNotes] = useState('');
  const [quickCards, setQuickCards] = useState<QuickCardRow[]>([
    { id: 'c1', q: '', a: '' },
    { id: 'c2', q: '', a: '' },
  ]);

  // File / Template mode fields
  const [templateText, setTemplateText] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [uploadedWordHtml, setUploadedWordHtml] = useState<string | undefined>(undefined);

  // Workspace packaging mode
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);

  // Advanced include toggles (tucked inside <details>)
  const [includeSubjects, setIncludeSubjects] = useState(true);
  const [includeFlashcards, setIncludeFlashcards] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeTodos, setIncludeTodos] = useState(true);

  const docInputRef = useRef<HTMLInputElement | null>(null);
  const jsonImportRef = useRef<HTMLInputElement | null>(null);

  const appliedSet = useMemo(() => new Set(appliedPackIds), [appliedPackIds]);

  const activePacks = useMemo(
    () => customPacks.filter((p) => appliedSet.has(p.id)),
    [customPacks, appliedSet]
  );

  const parsedDraft = useMemo(() => {
    if (sourceMode !== 'file') return null;
    if (!templateText.trim() && !uploadedWordHtml) return null;
    return parseStudyPackInput(templateText, {
      fallbackTitle: packTitle.trim() || uploadedFileName.replace(/\.[^.]+$/, ''),
      rawWordHtml: uploadedWordHtml,
    });
  }, [sourceMode, templateText, uploadedWordHtml, packTitle, uploadedFileName]);

  const counts = useMemo(() => {
    let standard = 0;
    let community = 0;
    let mine = 0;
    for (const p of customPacks) {
      if (p.isStandard) standard++;
      else if (p.visibility === 'public') community++;
      if (!p.isStandard && (!p.ownerId || (currentUserUid && p.ownerId === currentUserUid))) {
        mine++;
      }
    }
    return {
      all: customPacks.length,
      standard,
      community,
      mine,
      active: activePacks.length,
    };
  }, [customPacks, currentUserUid, activePacks.length]);

  const filteredPacks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customPacks.filter((pack) => {
      const isMine =
        !pack.isStandard && (!pack.ownerId || (currentUserUid && pack.ownerId === currentUserUid));
      if (filter === 'standard' && !pack.isStandard) return false;
      if (filter === 'community' && (pack.isStandard || pack.visibility !== 'public')) return false;
      if (filter === 'mine' && !isMine) return false;
      if (filter === 'active' && !appliedSet.has(pack.id)) return false;

      if (!q) return true;
      const subjNames = (pack.planner?.subjects || []).map((s) => `${s.name} ${s.topics.join(' ')}`);
      const hay = [
        pack.title,
        pack.subtitle,
        pack.examBoard,
        pack.ownerName || '',
        ...(pack.tags || []),
        ...(pack.highlights || []),
        ...subjNames,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [customPacks, filter, search, currentUserUid, appliedSet]);

  const handleDownloadTemplate = () => {
    const blob = new Blob([STUDY_PACK_TEMPLATE_TEXT], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'studydeck-pack-template.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadTemplateDocument = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setBannerMsg(null);
    const nm = file.name.toLowerCase();
    try {
      if (nm.endsWith('.json')) {
        const raw = JSON.parse(await file.text()) as { pack?: StudyPack } | StudyPack;
        const candidate =
          raw && typeof raw === 'object' && 'pack' in raw && raw.pack
            ? raw.pack
            : (raw as StudyPack);
        if (!candidate || typeof candidate.title !== 'string' || !candidate.revision) {
          throw new Error('This .json file is not a valid StudyDeck Study Pack.');
        }
        const imported: StudyPack = {
          ...candidate,
          id: `custom_${Date.now().toString(36)}`,
          isStandard: false,
          isCustom: true,
          visibility: 'private',
          ownerId: currentUserUid || undefined,
          createdAt: new Date().toISOString(),
        };
        await onSaveCustomPack(imported);
        setBannerMsg({
          text: `Imported "${imported.title}". Click Use Study Pack whenever you want to enable it.`,
          ok: true,
        });
        return;
      }

      if (nm.endsWith('.docx')) {
        const ab = await file.arrayBuffer();
        const { html, text } = await parseDocxFile(ab);
        setUploadedFileName(file.name);
        setUploadedWordHtml(html);
        setTemplateText(text);
        const draft = parseStudyPackInput(text, {
          fallbackTitle: file.name.replace(/\.docx$/i, ''),
          rawWordHtml: html,
        });
        if (!packTitle.trim()) setPackTitle(draft.title);
        if (draft.examBoard && draft.examBoard !== 'Custom Study Pack') {
          setPackBoard(draft.examBoard);
        }
        setBuilderOpen(true);
        setSourceMode('file');
        return;
      }

      if (nm.endsWith('.doc')) {
        throw new Error(
          'Legacy binary .doc files cannot be read directly. Save as .docx, .txt, or .md first.'
        );
      }

      const txt = await file.text();
      setUploadedFileName(file.name);
      setUploadedWordHtml(undefined);
      setTemplateText(txt);
      const draft = parseStudyPackInput(txt, {
        fallbackTitle: file.name.replace(/\.[^.]+$/, ''),
      });
      if (!packTitle.trim()) setPackTitle(draft.title);
      if (draft.subtitle) setPackSubtitle(draft.subtitle);
      if (draft.examBoard && draft.examBoard !== 'Custom Study Pack') {
        setPackBoard(draft.examBoard);
      }
      setBuilderOpen(true);
      setSourceMode('file');
    } catch (err) {
      setBannerMsg({
        text: err instanceof Error ? err.message : 'Could not parse that uploaded file.',
        ok: false,
      });
    }
  };

  const handleImportPackJson = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const txt = await file.text();
      const raw = JSON.parse(txt) as { app?: string; pack?: StudyPack } | StudyPack;
      const candidate =
        raw && typeof raw === 'object' && 'pack' in raw && raw.pack
          ? raw.pack
          : (raw as StudyPack);
      if (!candidate || typeof candidate.title !== 'string' || !candidate.revision) {
        throw new Error('This file is not a valid StudyDeck Study Pack JSON.');
      }
      const imported: StudyPack = {
        ...candidate,
        id: `custom_${Date.now().toString(36)}`,
        isStandard: false,
        isCustom: true,
        visibility: 'private',
        ownerId: currentUserUid || undefined,
        createdAt: new Date().toISOString(),
      };
      await onSaveCustomPack(imported);
      setBannerMsg({
        text: `Imported "${imported.title}". Enable it anytime below.`,
        ok: true,
      });
    } catch (err) {
      setBannerMsg({
        text: err instanceof Error ? err.message : 'Could not read that pack file.',
        ok: false,
      });
    }
  };

  const handleEnablePack = async (pack: StudyPack, replaceExisting: boolean) => {
    setBusyId(pack.id);
    setBannerMsg(null);
    try {
      await onApplyPack(pack, { replaceExisting });
      setBannerMsg({
        text: replaceExisting
          ? `Switched to "${pack.title}" — previous pack disabled and new Subjects, Spec Topics, Flashcards & Notes loaded.`
          : `Enabled "${pack.title}" — Subjects, Specification subtopics, Flashcards & Notes added.`,
        ok: true,
      });
    } catch (err) {
      setBannerMsg({
        text: err instanceof Error ? err.message : 'Could not enable this Study Pack.',
        ok: false,
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDisable = async (pack: StudyPack) => {
    setBusyId(pack.id);
    setBannerMsg(null);
    try {
      await onDisablePack(pack.id);
      setBannerMsg({
        text: `Disabled "${pack.title}" — its subjects, spec topics, flashcards, and notes were removed cleanly.`,
        ok: true,
      });
    } catch (err) {
      setBannerMsg({
        text: err instanceof Error ? err.message : 'Could not disable this Study Pack.',
        ok: false,
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleExportPack = (pack: StudyPack) => {
    const payload = serializeStudyPackFile(pack);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getPackFileName(pack.id);
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetBuilderFields = () => {
    setBuilderOpen(false);
    setPackTitle('');
    setPackSubtitle('');
    setQuickSubject('');
    setQuickSpecs('');
    setQuickNotes('');
    setQuickCards([
      { id: 'c1', q: '', a: '' },
      { id: 'c2', q: '', a: '' },
    ]);
    setTemplateText('');
    setUploadedFileName('');
    setUploadedWordHtml(undefined);
  };

  const handleCreateQuickPack = async (applyImmediately: boolean) => {
    const title = packTitle.trim() || (quickSubject.trim() ? `${quickSubject.trim()} Study Pack` : '');
    if (!title) {
      setBannerMsg({ text: 'Give your Study Pack a title or subject name.', ok: false });
      return;
    }

    const subjName = quickSubject.trim() || title;
    const specList = quickSpecs
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const topics = specList.length ? specList : ['Core Topic'];
    const validCards = quickCards
      .map((c) => ({ q: c.q.trim(), a: c.a.trim() }))
      .filter((c) => c.q && c.a);
    const notesHtml = quickNotes.trim()
      ? markdownLinesToHtml(quickNotes.replace(/\r/g, '').split('\n'))
      : '';

    if (!specList.length && !validCards.length && !notesHtml) {
      setBannerMsg({
        text: 'Add at least some specification topics, study notes, or flashcards first.',
        ok: false,
      });
      return;
    }

    if (packVisibility === 'public' && !isSignedInVerified) {
      setBannerMsg({
        text: 'Sign in with Google to share a Public Study Pack, or keep it Private.',
        ok: false,
      });
      return;
    }

    setSavingCustom(true);
    setBannerMsg(null);
    try {
      const packId = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
      const sid = `${packId}_s0`;
      const firstTid = `${packId}_s0_t0`;
      const secId = `${packId}_sec0`;

      const revTopics = topics.map((label, ti) => ({
        id: `${packId}_s0_t${ti}`,
        label,
        title: `${subjName}: ${label}`,
        sections: ['Specification Notes'],
        notesHtml: ti === 0 && includeNotes ? notesHtml : '',
      }));

      const category = inferCategory(1, validCards.length, notesHtml ? 1 : 0);
      const highlights: string[] = [
        `${subjName} · ${topics.length} specification topic${topics.length === 1 ? '' : 's'}`,
      ];
      if (validCards.length > 0 && includeFlashcards) {
        highlights.push(`${validCards.length} active-recall flashcard${validCards.length === 1 ? '' : 's'}`);
      }
      if (notesHtml && includeNotes) {
        highlights.push('Includes formatted study notes');
      }

      const newPack: StudyPack = {
        id: packId,
        title,
        subtitle:
          packSubtitle.trim() ||
          `${subjName}: ${topics.slice(0, 3).join(', ')}${topics.length > 3 ? '…' : ''}`,
        category,
        examBoard: packBoard.trim() || 'Custom',
        visibility: packVisibility,
        ownerId: currentUserUid || undefined,
        isCustom: true,
        createdAt: new Date().toISOString(),
        subjectCountPreview: includeSubjects ? 1 : 0,
        topicCountPreview: topics.length,
        cardCountPreview: includeFlashcards ? validCards.length : 0,
        tags: [packBoard.trim() || 'Custom', subjName],
        highlights,
        revision: {
          subjects: [
            {
              id: sid,
              name: subjName,
              kind: 'doc',
              views: { notes: true, timeline: false, mindmap: true },
              topics: revTopics,
            },
          ],
          sections:
            includeFlashcards && validCards.length > 0
              ? [
                  {
                    id: secId,
                    topicId: firstTid,
                    topicLabel: topics[0],
                    subjectName: subjName,
                    name: topics[0],
                  },
                ]
              : [],
          cards:
            includeFlashcards && validCards.length > 0
              ? validCards.map((c) => ({
                  sectionId: secId,
                  sectionName: topics[0],
                  topicId: firstTid,
                  topicLabel: topics[0],
                  subjectName: subjName,
                  q: c.q,
                  a: c.a,
                }))
              : [],
        },
        planner: {
          subjects: includeSubjects
            ? [{ name: subjName, weight: 2, topics }]
            : [],
          todos: [],
        },
      };

      await onSaveCustomPack(newPack);
      if (applyImmediately) {
        await onApplyPack(newPack, { replaceExisting: false });
      }
      resetBuilderFields();
      setBannerMsg({
        text: applyImmediately
          ? `Created & enabled "${newPack.title}" (${packVisibility}).`
          : `Saved "${newPack.title}" (${packVisibility}).`,
        ok: true,
      });
    } catch (err) {
      setBannerMsg({
        text: err instanceof Error ? err.message : 'Failed to create Study Pack.',
        ok: false,
      });
    } finally {
      setSavingCustom(false);
    }
  };

  const handleCreateFromFile = async (applyImmediately: boolean) => {
    if (!parsedDraft) {
      setBannerMsg({
        text: 'Upload a .docx, .txt, .md, or .csv file or paste notes/flashcards first.',
        ok: false,
      });
      return;
    }
    if (packVisibility === 'public' && !isSignedInVerified) {
      setBannerMsg({
        text: 'Sign in with Google to share a Public Study Pack, or keep it Private.',
        ok: false,
      });
      return;
    }

    setSavingCustom(true);
    setBannerMsg(null);
    try {
      const category = inferCategory(
        parsedDraft.subjects.length,
        parsedDraft.cards.length,
        parsedDraft.notesByTopic.length
      );
      const built = buildStudyPackFromDraft(parsedDraft, {
        title: packTitle.trim() || parsedDraft.title,
        subtitle: packSubtitle.trim() || parsedDraft.subtitle,
        examBoard: packBoard.trim() || parsedDraft.examBoard,
        category,
        includeSubjects,
        includeFlashcards,
        includeNotes,
        includeTodos,
      });
      const pack: StudyPack = {
        ...built,
        visibility: packVisibility,
        ownerId: currentUserUid || undefined,
      };

      await onSaveCustomPack(pack);
      if (applyImmediately) {
        await onApplyPack(pack, { replaceExisting: false });
      }
      resetBuilderFields();
      setBannerMsg({
        text: applyImmediately
          ? `Created & enabled "${pack.title}" (${packVisibility}).`
          : `Saved "${pack.title}" (${packVisibility}).`,
        ok: true,
      });
    } catch (err) {
      setBannerMsg({
        text: err instanceof Error ? err.message : 'Failed to create Study Pack.',
        ok: false,
      });
    } finally {
      setSavingCustom(false);
    }
  };

  const handleCreateFromWorkspace = async (applyImmediately: boolean) => {
    const title = packTitle.trim();
    if (!title) {
      setBannerMsg({ text: 'Give your Study Pack a title first.', ok: false });
      return;
    }
    if (!selectedSubjectIds.length) {
      setBannerMsg({
        text: 'Select at least one subject from your workspace to package.',
        ok: false,
      });
      return;
    }
    if (packVisibility === 'public' && !isSignedInVerified) {
      setBannerMsg({
        text: 'Sign in with Google to share a Public Study Pack, or keep it Private.',
        ok: false,
      });
      return;
    }

    setSavingCustom(true);
    setBannerMsg(null);
    try {
      const snap = await onGetWorkspaceSnapshot();
      const chosenIds = new Set(selectedSubjectIds);
      const chosenSubjects = deckSnapshot.subjects.filter((s) => chosenIds.has(s.id));
      const chosenTopics = deckSnapshot.topics.filter((t) => chosenIds.has(t.subjId));
      const chosenTopicIds = new Set(chosenTopics.map((t) => t.id));
      const chosenSections = deckSnapshot.sections.filter((s) => chosenTopicIds.has(s.topicId));
      const chosenSecIds = new Set(chosenSections.map((s) => s.id));
      const chosenCards = deckSnapshot.cards.filter((c) => chosenSecIds.has(c.secId));

      const packSubjects: NonNullable<StudyPackRevisionPayload['subjects']> = chosenSubjects.map(
        (subj) => ({
          id: subj.id,
          name: subj.n,
          kind: subj.kind,
          topics: chosenTopics
            .filter((t) => t.subjId === subj.id)
            .map((t) => ({
              id: t.id,
              label: t.label,
              title: t.name,
              views: t.views,
              sections: chosenSections.filter((s) => s.topicId === t.id).map((s) => s.name),
              notesHtml: includeNotes ? snap.revision[`gdoc-${t.id}`] || '' : '',
            })),
        })
      );

      const category = inferCategory(
        chosenSubjects.length,
        includeFlashcards ? chosenCards.length : 0,
        includeNotes ? chosenTopics.length : 0
      );

      const newPack: StudyPack = {
        id: `custom_${Date.now().toString(36)}`,
        title,
        subtitle:
          packSubtitle.trim() ||
          `${chosenSubjects.map((s) => s.n).join(', ')} · ${chosenCards.length} flashcards`,
        category,
        examBoard: packBoard.trim() || 'Custom',
        visibility: packVisibility,
        ownerId: currentUserUid || undefined,
        isCustom: true,
        createdAt: new Date().toISOString(),
        subjectCountPreview: chosenSubjects.length,
        topicCountPreview: chosenTopics.length,
        cardCountPreview: includeFlashcards ? chosenCards.length : 0,
        tags: [packBoard.trim() || 'Custom', ...chosenSubjects.slice(0, 3).map((s) => s.n)],
        highlights: [
          `${chosenSubjects.map((s) => s.n).join(', ')} · ${chosenTopics.length} spec topic${chosenTopics.length === 1 ? '' : 's'}`,
          includeFlashcards
            ? `${chosenCards.length} active-recall flashcard${chosenCards.length === 1 ? '' : 's'}`
            : 'Subjects & specification topics',
          includeNotes ? 'Includes study notes' : 'Notes excluded',
        ],
        revision: {
          subjects: packSubjects,
          sections: includeFlashcards
            ? chosenSections.map((sc) => {
                const top = chosenTopics.find((t) => t.id === sc.topicId);
                return {
                  id: sc.id,
                  topicId: sc.topicId,
                  topicLabel: top?.label,
                  subjectName: top?.subjName,
                  name: sc.name,
                };
              })
            : [],
          cards: includeFlashcards
            ? chosenCards.map((c) => ({
                sectionId: c.secId,
                sectionName: c.secName,
                topicId: c.topicId,
                topicLabel: c.topicName,
                subjectName: c.subjName,
                q: c.q,
                a: c.a,
              }))
            : [],
        },
        planner: {
          subjects: includeSubjects
            ? chosenSubjects.map((s) => ({
                name: s.n,
                weight: 2,
                topics: chosenTopics.filter((t) => t.subjId === s.id).map((t) => t.label),
              }))
            : [],
        },
      };

      await onSaveCustomPack(newPack);
      if (applyImmediately) {
        await onApplyPack(newPack, { replaceExisting: false });
      }
      resetBuilderFields();
      setBannerMsg({
        text: `Packaged "${newPack.title}" (${packVisibility}). Ready to share or switch anytime.`,
        ok: true,
      });
    } catch (err) {
      setBannerMsg({
        text: err instanceof Error ? err.message : 'Failed to package Study Pack.',
        ok: false,
      });
    } finally {
      setSavingCustom(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="sd-card flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--e3)]">
              <Package className="h-4 w-4" aria-hidden="true" />
              <span>Study Packs · Standard Combos &amp; Community Decks</span>
            </div>
            <h1 className="font-display mt-1 text-2xl font-extrabold tracking-tight text-[var(--ink)]">
              Browse &amp; Use Study Packs
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--mute)]">
              Pick a curated GCSE subject combo or a pack shared by friends — each pack loads
              Subjects &amp; Specification subtopics, Study Notes, and Flashcards. Enable, combine,
              switch, or disable any pack cleanly in one click.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={jsonImportRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => void handleImportPackJson(e)}
            />
            <button
              type="button"
              onClick={() => jsonImportRef.current?.click()}
              className="sd-btn px-3 py-2 text-xs whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Import .json</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedSubjectIds(deckSnapshot.subjects.map((s) => s.id));
                setBuilderOpen((v) => !v);
                setBannerMsg(null);
              }}
              className="sd-btn-pri px-3.5 py-2 text-xs whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{builderOpen ? 'Close Creator' : 'Create Study Pack'}</span>
            </button>
          </div>
        </div>

        {/* Active Study Packs Bar */}
        {activePacks.length > 0 && (
          <section className="sd-card border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_6%,var(--card))] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--ok)]">
                  <Check className="h-4 w-4" aria-hidden="true" />
                  <span>
                    Active in Workspace ({activePacks.length} pack
                    {activePacks.length === 1 ? '' : 's'})
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--mute)]">
                  Disable any pack to cleanly remove its subjects, spec subtopics, notes &amp;
                  flashcards — or click &ldquo;Switch to Pack&rdquo; on another card to swap sets.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenSubjects}
                  className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                >
                  <BookMarked className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                  <span>Subjects &amp; Spec</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenFlashcards}
                  className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                >
                  <Layers className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                  <span>Flashcards</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenStudyNotes}
                  className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                >
                  <BookOpen className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                  <span>Study Notes</span>
                </button>
                {activePacks.length > 1 && (
                  <button
                    type="button"
                    onClick={() => void onDisableAllPacks()}
                    className="sd-btn px-2.5 py-1.5 text-xs text-[var(--bad)] whitespace-nowrap"
                  >
                    <Power className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Disable All</span>
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {activePacks.map((ap) => (
                <div
                  key={ap.id}
                  className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-1.5 text-xs"
                >
                  <span className="font-semibold text-[var(--ink)]">{ap.title}</span>
                  <button
                    type="button"
                    disabled={busyId === ap.id}
                    onClick={() => void handleDisable(ap)}
                    aria-label={`Disable ${ap.title}`}
                    className="inline-flex cursor-pointer items-center gap-1 rounded border border-[var(--line)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--bad)] hover:border-[var(--bad)]"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                    <span>Disable</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Status Banner */}
        {bannerMsg && (
          <div
            role="status"
            className={`sd-card flex flex-wrap items-center justify-between gap-3 p-4 text-sm ${
              bannerMsg.ok
                ? 'border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_9%,var(--card))]'
                : 'border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_9%,var(--card))]'
            }`}
          >
            <span className="font-medium text-[var(--ink)]">{bannerMsg.text}</span>
            {bannerMsg.ok && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenSubjects}
                  className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                >
                  <BookMarked className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                  <span>Subjects</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenFlashcards}
                  className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                >
                  <Layers className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                  <span>Flashcards</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenStudyNotes}
                  className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                >
                  <BookOpen className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                  <span>Study &amp; Notes</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Streamlined Study Pack Creator */}
        {builderOpen && (
          <section className="sd-card space-y-4 border-[var(--e3)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
              <div>
                <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                  Create a Study Pack
                </h2>
                <p className="mt-0.5 text-xs text-[var(--mute)]">
                  Name your pack, choose who can see it, and fill in topics, notes, or flashcards.
                </p>
              </div>
              <div className="sd-seg">
                <button
                  type="button"
                  aria-pressed={sourceMode === 'quick'}
                  onClick={() => setSourceMode('quick')}
                  className="sd-seg-btn"
                >
                  Quick Form
                </button>
                <button
                  type="button"
                  aria-pressed={sourceMode === 'file'}
                  onClick={() => setSourceMode('file')}
                  className="sd-seg-btn"
                >
                  Upload File / Paste
                </button>
                <button
                  type="button"
                  aria-pressed={sourceMode === 'workspace'}
                  onClick={() => {
                    setSelectedSubjectIds(deckSnapshot.subjects.map((s) => s.id));
                    setSourceMode('workspace');
                  }}
                  className="sd-seg-btn"
                >
                  From My Workspace
                </button>
              </div>
            </div>

            {/* Minimal Core Row: Title + Level + Visibility */}
            <div className="grid gap-3 md:grid-cols-12">
              <label className="block text-xs font-semibold text-[var(--mute)] md:col-span-5">
                Pack Name
                <input
                  type="text"
                  value={packTitle}
                  onChange={(e) => setPackTitle(e.target.value)}
                  placeholder="e.g. GCSE Biology Genetics Revision"
                  className="sd-input mt-1 text-sm"
                />
              </label>

              <div className="md:col-span-3">
                <div className="text-xs font-semibold text-[var(--mute)]">Level / Exam Board</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <input
                    type="text"
                    value={packBoard}
                    onChange={(e) => setPackBoard(e.target.value)}
                    placeholder="GCSE / A-Level"
                    className="sd-input text-sm"
                  />
                </div>
              </div>

              <div className="md:col-span-4">
                <div className="text-xs font-semibold text-[var(--mute)]">Visibility</div>
                <div className="sd-seg mt-1 w-full">
                  <button
                    type="button"
                    aria-pressed={packVisibility === 'private'}
                    onClick={() => setPackVisibility('private')}
                    className="sd-seg-btn flex-1 justify-center"
                  >
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Private</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={packVisibility === 'public'}
                    onClick={() => setPackVisibility('public')}
                    className="sd-seg-btn flex-1 justify-center"
                  >
                    <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Public (Everyone)</span>
                  </button>
                </div>
              </div>
            </div>

            {packVisibility === 'public' && !isSignedInVerified && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--e2)] bg-[var(--bg)] px-3 py-2 text-xs">
                <span className="text-[var(--ink)]">
                  Sign in with Google to publish Public Study Packs so friends and other students can
                  use them.
                </span>
                {onOpenAuth && (
                  <button
                    type="button"
                    onClick={onOpenAuth}
                    className="sd-btn-pri px-3 py-1 text-xs whitespace-nowrap"
                  >
                    Sign In
                  </button>
                )}
              </div>
            )}

            {/* Mode 1: Quick Guided Form */}
            {sourceMode === 'quick' && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-semibold text-[var(--mute)]">
                    Subject Name
                    <input
                      type="text"
                      value={quickSubject}
                      onChange={(e) => setQuickSubject(e.target.value)}
                      placeholder="e.g. Biology, Maths, History"
                      className="sd-input mt-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs font-semibold text-[var(--mute)]">
                    Specification Subtopics (comma separated)
                    <input
                      type="text"
                      value={quickSpecs}
                      onChange={(e) => setQuickSpecs(e.target.value)}
                      placeholder="e.g. Cells, Osmosis, Enzymes, Respiration"
                      className="sd-input mt-1 text-sm"
                    />
                  </label>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--mute)]">
                      Flashcards (Question &amp; Answer)
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setQuickCards((prev) => [
                          ...prev,
                          { id: `c_${Date.now()}_${prev.length}`, q: '', a: '' },
                        ])
                      }
                      className="sd-btn px-2.5 py-1 text-xs whitespace-nowrap"
                    >
                      <Plus className="h-3 w-3" aria-hidden="true" />
                      <span>Add Card</span>
                    </button>
                  </div>
                  <div className="space-y-2">
                    {quickCards.map((row, idx) => (
                      <div key={row.id} className="grid items-center gap-2 sm:grid-cols-12">
                        <input
                          type="text"
                          value={row.q}
                          onChange={(e) =>
                            setQuickCards((prev) =>
                              prev.map((c) => (c.id === row.id ? { ...c, q: e.target.value } : c))
                            )
                          }
                          placeholder={`Question ${idx + 1}`}
                          className="sd-input text-xs sm:col-span-5"
                        />
                        <input
                          type="text"
                          value={row.a}
                          onChange={(e) =>
                            setQuickCards((prev) =>
                              prev.map((c) => (c.id === row.id ? { ...c, a: e.target.value } : c))
                            )
                          }
                          placeholder={`Answer ${idx + 1}`}
                          className="sd-input text-xs sm:col-span-6"
                        />
                        <button
                          type="button"
                          disabled={quickCards.length <= 1}
                          onClick={() =>
                            setQuickCards((prev) => prev.filter((c) => c.id !== row.id))
                          }
                          aria-label="Remove flashcard row"
                          className="sd-btn justify-center px-2 py-1.5 text-xs text-[var(--bad)] sm:col-span-1"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Study Notes (optional — headings &amp; bullet points auto-format cleanly)
                  <textarea
                    rows={4}
                    value={quickNotes}
                    onChange={(e) => setQuickNotes(e.target.value)}
                    placeholder={`## Key Points\n- Diffusion moves particles down a concentration gradient\n- Osmosis is the diffusion of water across a partially permeable membrane`}
                    className="sd-input mt-1 text-xs leading-relaxed"
                  />
                </label>

                <details className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs">
                  <summary className="cursor-pointer font-semibold text-[var(--mute)]">
                    Optional settings (subtitle &amp; custom level presets)
                  </summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block font-semibold text-[var(--mute)]">
                      Short Subtitle
                      <input
                        type="text"
                        value={packSubtitle}
                        onChange={(e) => setPackSubtitle(e.target.value)}
                        placeholder="Auto-generated if left blank"
                        className="sd-input mt-1 text-xs"
                      />
                    </label>
                    <div>
                      <div className="font-semibold text-[var(--mute)]">Quick Level Presets</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {['GCSE', 'AQA GCSE', 'Edexcel GCSE', 'A-Level', 'Custom'].map((lvl) => (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => setPackBoard(lvl)}
                            className="sd-btn px-2 py-1 text-[11px]"
                          >
                            {lvl}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </details>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={savingCustom}
                    onClick={() => void handleCreateQuickPack(false)}
                    className="sd-btn px-4 py-2 text-xs whitespace-nowrap"
                  >
                    Save Pack Only
                  </button>
                  <button
                    type="button"
                    disabled={savingCustom}
                    onClick={() => void handleCreateQuickPack(true)}
                    className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{savingCustom ? 'Saving…' : 'Create & Enable Pack'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Mode 2: File Upload / Paste Text */}
            {sourceMode === 'file' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-[var(--mute)]">
                    Upload a Word doc (<code>.docx</code>), text (<code>.txt</code>), markdown, or
                    CSV — or paste notes / flashcards (<code>Question | Answer</code>).
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={docInputRef}
                      type="file"
                      accept=".docx,.txt,.md,.csv,.json"
                      className="hidden"
                      onChange={(e) => void handleUploadTemplateDocument(e)}
                    />
                    <button
                      type="button"
                      onClick={() => docInputRef.current?.click()}
                      className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {uploadedFileName ? `Uploaded: ${uploadedFileName}` : 'Upload Document'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTemplateText(STUDY_PACK_TEMPLATE_TEXT);
                        setUploadedFileName('sample-template.txt');
                        setUploadedWordHtml(undefined);
                      }}
                      className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                    >
                      Load Sample
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadTemplate}
                      className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Template .txt</span>
                    </button>
                  </div>
                </div>

                <textarea
                  rows={8}
                  value={templateText}
                  onChange={(e) => {
                    setTemplateText(e.target.value);
                    setUploadedWordHtml(undefined);
                  }}
                  placeholder={`[Subject: Biology]\nTopics: Cells, Osmosis, Enzymes\n\n[Flashcards | Biology > Cells]\nDefine osmosis | Net movement of water across a partially permeable membrane\n\n[Notes | Biology > Cells]\n## Cell Membranes\n- Controls movement into and out of the cell`}
                  className="sd-input font-mono-num text-xs leading-relaxed"
                />

                {parsedDraft && (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3.5 py-2.5 text-xs text-[var(--mute)]">
                    <strong className="text-[var(--ink)]">Detected:</strong>{' '}
                    {parsedDraft.subjects.length} subject
                    {parsedDraft.subjects.length === 1 ? '' : 's'} ·{' '}
                    {parsedDraft.subjects.reduce((s, x) => s + x.topics.length, 0)} spec topics ·{' '}
                    {parsedDraft.cards.length} flashcards · {parsedDraft.notesByTopic.length} note
                    sections
                  </div>
                )}

                <details className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs">
                  <summary className="cursor-pointer font-semibold text-[var(--mute)]">
                    Advanced import options &amp; template syntax guide
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-4 text-[var(--ink)]">
                      <label className="inline-flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={includeSubjects}
                          onChange={(e) => setIncludeSubjects(e.target.checked)}
                        />
                        <span>Subjects &amp; Spec Topics</span>
                      </label>
                      <label className="inline-flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={includeFlashcards}
                          onChange={(e) => setIncludeFlashcards(e.target.checked)}
                        />
                        <span>Flashcards</span>
                      </label>
                      <label className="inline-flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={includeNotes}
                          onChange={(e) => setIncludeNotes(e.target.checked)}
                        />
                        <span>Notes</span>
                      </label>
                      <label className="inline-flex cursor-pointer items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={includeTodos}
                          onChange={(e) => setIncludeTodos(e.target.checked)}
                        />
                        <span>To-do Tasks</span>
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowTemplateGuide((v) => !v)}
                      className="sd-btn px-2.5 py-1 text-xs"
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{showTemplateGuide ? 'Hide Template Syntax' : 'View Template Syntax'}</span>
                    </button>
                    {showTemplateGuide && (
                      <pre className="font-mono-num max-h-60 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--card)] p-3 text-[11px]">
                        {STUDY_PACK_TEMPLATE_TEXT}
                      </pre>
                    )}
                  </div>
                </details>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={savingCustom || !parsedDraft}
                    onClick={() => void handleCreateFromFile(false)}
                    className="sd-btn px-4 py-2 text-xs whitespace-nowrap"
                  >
                    Save Pack Only
                  </button>
                  <button
                    type="button"
                    disabled={savingCustom || !parsedDraft}
                    onClick={() => void handleCreateFromFile(true)}
                    className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{savingCustom ? 'Creating…' : 'Create & Enable Pack'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Mode 3: Package From My Workspace */}
            {sourceMode === 'workspace' && (
              <>
                {deckSnapshot.subjects.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-4 text-sm text-[var(--mute)]">
                    No active subjects in your workspace yet. Enable a pack below or use Quick Form
                    to build one right away.
                  </div>
                ) : (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {deckSnapshot.subjects.map((subj) => {
                        const checked = selectedSubjectIds.includes(subj.id);
                        const topicCount = deckSnapshot.topics.filter(
                          (t) => t.subjId === subj.id
                        ).length;
                        const cardCount = deckSnapshot.cards.filter(
                          (c) => c.subjId === subj.id
                        ).length;
                        return (
                          <label
                            key={subj.id}
                            className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border p-3 text-xs ${
                              checked
                                ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_8%,var(--bg))]'
                                : 'border-[var(--line)] bg-[var(--bg)]'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setSelectedSubjectIds((prev) =>
                                    checked
                                      ? prev.filter((id) => id !== subj.id)
                                      : [...prev, subj.id]
                                  )
                                }
                              />
                              <span className="truncate font-semibold text-[var(--ink)]">
                                {subj.n}
                              </span>
                            </span>
                            <span className="font-mono-num shrink-0 text-[var(--mute)]">
                              {topicCount}t · {cardCount}c
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap justify-end gap-2 pt-2">
                      <button
                        type="button"
                        disabled={savingCustom}
                        onClick={() => void handleCreateFromWorkspace(false)}
                        className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{savingCustom ? 'Saving…' : 'Save & Share Workspace Pack'}</span>
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        )}

        {/* Discovery Filter Tabs & Search */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['all', `All Packs (${counts.all})`],
                ['standard', `GCSE & Standard (${counts.standard})`],
                ['community', `Community (${counts.community})`],
                ['mine', `My Packs (${counts.mine})`],
                ['active', `Active (${counts.active})`],
              ] as [FilterTab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  filter === id
                    ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]'
                    : 'border-[var(--line)] bg-[var(--card)] text-[var(--mute)] hover:text-[var(--ink)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--mute)]"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subjects, GCSE, topics…"
              aria-label="Search study packs"
              className="sd-input pl-8 text-xs"
            />
          </div>
        </div>

        {/* Packs Grid */}
        {filteredPacks.length === 0 ? (
          <div className="sd-card p-8 text-center">
            <p className="font-display text-lg font-bold text-[var(--ink)]">
              No Study Packs match that view
            </p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-[var(--mute)]">
              {filter === 'community'
                ? 'No community-shared packs yet. Create a pack and choose Public to share yours with every student!'
                : filter === 'active'
                ? 'No Study Packs are currently active. Switch to All Packs or GCSE & Standard to enable one.'
                : 'Try clearing your search or switching back to All Packs.'}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setFilter('all');
                  setSearch('');
                }}
                className="sd-btn px-4 py-2 text-xs"
              >
                Show All Packs
              </button>
              <button
                type="button"
                onClick={() => {
                  setBuilderOpen(true);
                  setSourceMode('quick');
                }}
                className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Create Study Pack</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {filteredPacks.map((pack) => {
              const isApplied = appliedSet.has(pack.id);
              const isExpanded = expandedId === pack.id;
              const isBusy = busyId === pack.id;
              const isPublic = pack.visibility === 'public';
              const isStd = Boolean(pack.isStandard);
              const isOwner = Boolean(
                !isStd && (!pack.ownerId || (currentUserUid && pack.ownerId === currentUserUid))
              );
              const canManage = !isStd && (isAdmin || isOwner);
              const authorLabel = pack.ownerName || pack.author;
              const notesTopicCount = (pack.revision?.subjects || []).reduce(
                (acc, s) => acc + s.topics.filter((t) => Boolean(t.notesHtml)).length,
                0
              );
              const otherActiveCount = activePacks.filter((a) => a.id !== pack.id).length;

              return (
                <article
                  key={pack.id}
                  className={`sd-card flex flex-col justify-between p-5 ${
                    isApplied ? 'border-[var(--ok)]' : ''
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--e3)]">
                          <span>{pack.examBoard}</span>
                          <span className="text-[var(--mute)]">·</span>
                          {isStd ? (
                            <span className="inline-flex items-center gap-1 text-[var(--e3)]">
                              <Sparkles className="h-3 w-3" aria-hidden="true" />
                              <span>Standard Pack</span>
                            </span>
                          ) : isPublic ? (
                            <span className="inline-flex items-center gap-1 text-[var(--ok)]">
                              <Users className="h-3 w-3" aria-hidden="true" />
                              <span>Community Public</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[var(--mute)]">
                              <Lock className="h-3 w-3" aria-hidden="true" />
                              <span>Private</span>
                            </span>
                          )}
                          {!isStd && authorLabel && (
                            <>
                              <span className="text-[var(--mute)]">·</span>
                              <span className="normal-case text-[var(--mute)]">
                                By {authorLabel}
                              </span>
                            </>
                          )}
                        </div>
                        <h2 className="font-display mt-0.5 text-lg font-bold leading-snug text-[var(--ink)]">
                          {pack.title}
                        </h2>
                      </div>
                      {isApplied && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_12%,transparent)] px-2 py-0.5 text-[11px] font-bold text-[var(--ok)]">
                          <Check className="h-3 w-3" aria-hidden="true" />
                          <span>Active</span>
                        </span>
                      )}
                    </div>

                    <p className="mt-1.5 text-sm text-[var(--mute)]">{pack.subtitle}</p>

                    <div className="font-mono-num mt-3 flex flex-wrap items-center gap-2 border-y border-[var(--line)] py-2 text-xs font-semibold text-[var(--ink)]">
                      <span>
                        {pack.subjectCountPreview} subject
                        {pack.subjectCountPreview === 1 ? '' : 's'}
                      </span>
                      <span className="text-[var(--mute)]">·</span>
                      <span>
                        {pack.topicCountPreview} spec topic{pack.topicCountPreview === 1 ? '' : 's'}
                      </span>
                      <span className="text-[var(--mute)]">·</span>
                      <span>
                        {pack.cardCountPreview} flashcard
                        {pack.cardCountPreview === 1 ? '' : 's'}
                      </span>
                      {notesTopicCount > 0 && (
                        <>
                          <span className="text-[var(--mute)]">·</span>
                          <span>
                            {notesTopicCount} note{notesTopicCount === 1 ? '' : 's'}
                          </span>
                        </>
                      )}
                    </div>

                    <ul className="mt-3 space-y-1 text-xs text-[var(--mute)]">
                      {pack.highlights.slice(0, 3).map((hl, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-sm bg-[var(--e3)]" />
                          <span>{hl}</span>
                        </li>
                      ))}
                    </ul>

                    {isExpanded && (
                      <div className="mt-3 space-y-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs">
                        {pack.revision?.subjects && pack.revision.subjects.length > 0 && (
                          <div>
                            <div className="font-bold text-[var(--ink)]">
                              Subjects &amp; Specification Subtopics
                            </div>
                            {pack.revision.subjects.map((rs, sIdx) => (
                              <div key={sIdx} className="mt-1.5">
                                <span className="font-semibold text-[var(--e3)]">{rs.name}</span>
                                <span className="text-[var(--mute)]">
                                  {' '}
                                  — {rs.topics.map((t) => t.label).join(' · ')}
                                </span>
                                {rs.topics.find((t) => t.notesHtml)?.notesHtml && (
                                  <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--mute)]">
                                    Notes preview:{' '}
                                    {stripHtmlPreview(
                                      rs.topics.find((t) => t.notesHtml)?.notesHtml || ''
                                    )}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {pack.revision.cards && pack.revision.cards.length > 0 && (
                          <div className="border-t border-[var(--line)] pt-2">
                            <div className="font-bold text-[var(--ink)]">Sample Flashcards</div>
                            {pack.revision.cards.slice(0, 3).map((c, cIdx) => (
                              <div key={cIdx} className="mt-1 text-[var(--mute)]">
                                <strong className="text-[var(--ink)]">Q:</strong> {c.q}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : pack.id)}
                        className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Hide</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Preview</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportPack(pack)}
                        title="Export pack as .json"
                        aria-label={`Export ${pack.title}`}
                        className="sd-btn px-2 py-1.5 text-xs whitespace-nowrap"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      {canManage && onTogglePackVisibility && isSignedInVerified && (
                        <button
                          type="button"
                          disabled={togglingVisId === pack.id}
                          onClick={async () => {
                            setTogglingVisId(pack.id);
                            setBannerMsg(null);
                            try {
                              const nextVis = isPublic ? 'private' : 'public';
                              await onTogglePackVisibility(pack, nextVis);
                              setBannerMsg({
                                text:
                                  nextVis === 'public'
                                    ? `"${pack.title}" is now Public for all StudyDeck users.`
                                    : `"${pack.title}" is now Private.`,
                                ok: true,
                              });
                            } catch (err) {
                              setBannerMsg({
                                text:
                                  err instanceof Error
                                    ? err.message
                                    : 'Could not update pack visibility.',
                                ok: false,
                              });
                            } finally {
                              setTogglingVisId(null);
                            }
                          }}
                          title={isPublic ? 'Make Private' : 'Share Publicly'}
                          className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                        >
                          {isPublic ? (
                            <>
                              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Private</span>
                            </>
                          ) : (
                            <>
                              <Globe className="h-3.5 w-3.5 text-[var(--ok)]" aria-hidden="true" />
                              <span>Share</span>
                            </>
                          )}
                        </button>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (confirmDeleteId === pack.id) {
                              setConfirmDeleteId(null);
                              try {
                                if (isApplied) await onDisablePack(pack.id);
                                await onDeleteCustomPack(pack.id);
                              } catch (err) {
                                setBannerMsg({
                                  text:
                                    err instanceof Error
                                      ? err.message
                                      : 'Could not delete pack.',
                                  ok: false,
                                });
                              }
                            } else {
                              setConfirmDeleteId(pack.id);
                            }
                          }}
                          className="sd-btn px-2.5 py-1.5 text-xs text-[var(--bad)] whitespace-nowrap"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{confirmDeleteId === pack.id ? 'Confirm' : 'Delete'}</span>
                        </button>
                      )}
                    </div>

                    {/* Enable / Disable / Switch Action Group */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {isApplied ? (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleEnablePack(pack, false)}
                            title="Re-sync missing items from this pack"
                            aria-label={`Re-sync ${pack.title}`}
                            className="sd-btn px-2 py-1.5 text-xs whitespace-nowrap"
                          >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleDisable(pack)}
                            className="sd-btn border-[var(--bad)] px-3 py-1.5 text-xs font-semibold text-[var(--bad)] whitespace-nowrap hover:bg-[color-mix(in_srgb,var(--bad)_10%,var(--card))]"
                          >
                            <Power className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{isBusy ? 'Removing…' : 'Disable Pack'}</span>
                          </button>
                        </>
                      ) : otherActiveCount > 0 ? (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleEnablePack(pack, false)}
                            title="Keep active packs enabled and add this alongside"
                            className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Combine</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleEnablePack(pack, true)}
                            title="Disable active packs and switch to this pack"
                            className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap"
                          >
                            <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{isBusy ? 'Switching…' : 'Switch to Pack'}</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleEnablePack(pack, false)}
                          className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{isBusy ? 'Loading…' : 'Use Study Pack'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

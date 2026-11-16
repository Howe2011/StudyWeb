import { ChangeEvent, useMemo, useRef, useState } from 'react';
import {
  BookMarked,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileText,
  Globe,
  Layers,
  Lock,
  Package,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  buildStudyPackFromDraft,
  parseDocxFile,
  parseStudyPackInput,
  STUDY_PACK_TEMPLATE_TEXT,
} from '../lib/packParser';
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
  onApplyPack: (pack: StudyPack) => Promise<void>;
  onSaveCustomPack: (pack: StudyPack) => Promise<void>;
  onTogglePackVisibility?: (pack: StudyPack, nextVisibility: 'public' | 'private') => Promise<void>;
  onDeleteCustomPack: (packId: string) => Promise<void>;
  onGetWorkspaceSnapshot: () => Promise<WorkspaceSnapshot>;
  onOpenFlashcards: () => void;
  onOpenStudyNotes: () => void;
  onOpenSubjects: () => void;
}

type FilterTab = 'all' | 'public' | 'private' | 'combo' | 'flashcards' | 'notes';
type BuilderSourceMode = 'template' | 'workspace';

export function StudyPacksView({
  deckSnapshot,
  customPacks,
  appliedPackIds,
  currentUserUid,
  isSignedInVerified = false,
  isAdmin = false,
  onOpenAuth,
  onApplyPack,
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
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Builder state
  const [builderOpen, setBuilderOpen] = useState<boolean>(false);
  const [sourceMode, setSourceMode] = useState<BuilderSourceMode>('template');
  const [showTemplateGuide, setShowTemplateGuide] = useState<boolean>(false);
  const [copiedTemplate, setCopiedTemplate] = useState<boolean>(false);

  // Template / File upload input state
  const [templateText, setTemplateText] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [uploadedWordHtml, setUploadedWordHtml] = useState<string | undefined>(undefined);
  const [packTitle, setPackTitle] = useState('');
  const [packSubtitle, setPackSubtitle] = useState('');
  const [packBoard, setPackBoard] = useState('Custom Study Pack');
  const [packCategory, setPackCategory] = useState<StudyPackCategory>('combo');
  const [packVisibility, setPackVisibility] = useState<'private' | 'public'>('private');
  const [togglingVisId, setTogglingVisId] = useState<string | null>(null);
  const [includeSubjects, setIncludeSubjects] = useState(true);
  const [includeFlashcards, setIncludeFlashcards] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeTodos, setIncludeTodos] = useState(true);
  const [savingCustom, setSavingCustom] = useState(false);

  // Package from Workspace state
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);

  const docInputRef = useRef<HTMLInputElement | null>(null);
  const jsonImportRef = useRef<HTMLInputElement | null>(null);

  const parsedDraft = useMemo(() => {
    if (!templateText.trim() && !uploadedWordHtml) return null;
    return parseStudyPackInput(templateText, {
      fallbackTitle: packTitle.trim() || uploadedFileName.replace(/\.[^.]+$/, ''),
      rawWordHtml: uploadedWordHtml,
    });
  }, [templateText, uploadedWordHtml, packTitle, uploadedFileName]);

  const publicCount = useMemo(
    () => customPacks.filter((p) => p.visibility === 'public').length,
    [customPacks]
  );
  const privateCount = useMemo(
    () => customPacks.filter((p) => p.visibility !== 'public').length,
    [customPacks]
  );

  const filteredPacks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customPacks.filter((pack) => {
      if (filter === 'public' && pack.visibility !== 'public') return false;
      if (filter === 'private' && pack.visibility === 'public') return false;
      if (
        (filter === 'combo' || filter === 'flashcards' || filter === 'notes') &&
        pack.category !== filter
      ) {
        return false;
      }
      if (!q) return true;
      const hay = [
        pack.title,
        pack.subtitle,
        pack.examBoard,
        pack.ownerName || '',
        ...(pack.tags || []),
        ...(pack.highlights || []),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [customPacks, filter, search]);

  const appliedSet = useMemo(() => new Set(appliedPackIds), [appliedPackIds]);

  const handleDownloadTemplate = () => {
    const blob = new Blob([STUDY_PACK_TEMPLATE_TEXT], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'studydeck-pack-template.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyTemplate = () => {
    void navigator.clipboard.writeText(STUDY_PACK_TEMPLATE_TEXT);
    setCopiedTemplate(true);
    window.setTimeout(() => setCopiedTemplate(false), 1800);
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
          isCustom: true,
          visibility: 'private',
          ownerId: currentUserUid || undefined,
          createdAt: new Date().toISOString(),
        };
        await onSaveCustomPack(imported);
        setBannerMsg({
          text: `Imported pack "${imported.title}". Click "Use Study Pack" to load it into your workspace.`,
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
        setSourceMode('template');
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
      setSourceMode('template');
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
        isCustom: true,
        visibility: 'private',
        ownerId: currentUserUid || undefined,
        createdAt: new Date().toISOString(),
      };
      await onSaveCustomPack(imported);
      setBannerMsg({
        text: `Imported pack "${imported.title}". Click "Use Study Pack" to add it into your workspace.`,
        ok: true,
      });
    } catch (err) {
      setBannerMsg({
        text: err instanceof Error ? err.message : 'Could not read that pack file.',
        ok: false,
      });
    }
  };

  const handleUsePack = async (pack: StudyPack) => {
    setApplyingId(pack.id);
    setBannerMsg(null);
    try {
      await onApplyPack(pack);
      setBannerMsg({
        text: `Loaded "${pack.title}" into your workspace — Subjects, Flashcards, and Notes are ready.`,
        ok: true,
      });
    } catch (err) {
      setBannerMsg({
        text: err instanceof Error ? err.message : 'Could not apply this Study Pack.',
        ok: false,
      });
    } finally {
      setApplyingId(null);
    }
  };

  const handleExportPack = (pack: StudyPack) => {
    const payload = JSON.stringify(
      {
        app: 'studydeck-pack',
        v: 1,
        exportedAt: new Date().toISOString(),
        pack,
      },
      null,
      2
    );
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pack.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'study-pack'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateFromTemplate = async (applyImmediately: boolean) => {
    if (!parsedDraft) {
      setBannerMsg({
        text: 'Upload a .txt, .md, .csv, or .docx document or paste template content first.',
        ok: false,
      });
      return;
    }
    if (!includeSubjects && !includeFlashcards && !includeNotes && !includeTodos) {
      setBannerMsg({
        text: 'Check at least one option to include (Subjects & Topics, Flashcards, Notes, or To-dos).',
        ok: false,
      });
      return;
    }

    if (packVisibility === 'public' && !isSignedInVerified) {
      setBannerMsg({
        text: 'Sign in with Google to publish a Public Study Pack, or switch visibility to Private.',
        ok: false,
      });
      return;
    }

    setSavingCustom(true);
    setBannerMsg(null);
    try {
      const built = buildStudyPackFromDraft(parsedDraft, {
        title: packTitle.trim() || parsedDraft.title,
        subtitle: packSubtitle.trim() || parsedDraft.subtitle,
        examBoard: packBoard.trim() || parsedDraft.examBoard,
        category: packCategory,
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
        await onApplyPack(pack);
      }

      setBuilderOpen(false);
      setTemplateText('');
      setUploadedFileName('');
      setUploadedWordHtml(undefined);
      setPackTitle('');
      setPackSubtitle('');
      setBannerMsg({
        text: applyImmediately
          ? `Created & applied ${packVisibility} Study Pack "${pack.title}" into your workspace.`
          : `Saved ${packVisibility} Study Pack "${pack.title}".`,
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

  const handleCreateFromWorkspace = async () => {
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
        text: 'Sign in with Google to publish a Public Study Pack, or switch visibility to Private.',
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

      const newPack: StudyPack = {
        id: `custom_${Date.now().toString(36)}`,
        title,
        subtitle:
          packSubtitle.trim() ||
          `${chosenSubjects.length} subject${chosenSubjects.length === 1 ? '' : 's'} · ${
            chosenCards.length
          } flashcard${chosenCards.length === 1 ? '' : 's'}`,
        category: packCategory,
        examBoard: packBoard.trim() || 'Custom Study Pack',
        visibility: packVisibility,
        ownerId: currentUserUid || undefined,
        isCustom: true,
        createdAt: new Date().toISOString(),
        subjectCountPreview: chosenSubjects.length,
        topicCountPreview: chosenTopics.length,
        cardCountPreview: includeFlashcards ? chosenCards.length : 0,
        tags: ['Custom Pack', ...chosenSubjects.slice(0, 3).map((s) => s.n)],
        highlights: [
          `Includes ${chosenSubjects.map((s) => s.n).join(', ')}`,
          includeFlashcards
            ? `${chosenCards.length} flashcard${chosenCards.length === 1 ? '' : 's'}`
            : 'Subjects & topics structure',
          includeNotes ? 'Includes study notes content' : 'Notes excluded',
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
      setBuilderOpen(false);
      setPackTitle('');
      setPackSubtitle('');
      setBannerMsg({
        text: `Saved Study Pack "${newPack.title}". Export or apply it anytime.`,
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
              <span>Study Packs · Template &amp; Document Import</span>
            </div>
            <h1 className="font-display mt-1 text-2xl font-extrabold tracking-tight text-[var(--ink)]">
              Study Packs
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--mute)]">
              Build custom Study Packs from a Word document (<code>.docx</code>), text/markdown
              file, or template — choose whether to populate Subjects &amp; nested Topics,
              Flashcards, Notes, or To-do tasks.
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
              onClick={handleDownloadTemplate}
              className="sd-btn px-3 py-2 text-xs whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Download Template</span>
            </button>
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
              <span>{builderOpen ? 'Close Builder' : 'Create Study Pack'}</span>
            </button>
          </div>
        </div>

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

        {/* Study Pack Template Reference Card (always easy to inspect or copy) */}
        <section className="sd-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display flex items-center gap-2 text-base font-bold text-[var(--ink)]">
                <FileText className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                <span>Study Pack Document Template</span>
              </h2>
              <p className="mt-0.5 text-xs text-[var(--mute)]">
                Write your notes, topics, and flashcards in any <code>.txt</code>,{' '}
                <code>.md</code>, or Word <code>.docx</code> file using these section markers — or
                load the sample template directly into the builder.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyTemplate}
                className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{copiedTemplate ? 'Copied!' : 'Copy Template'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTemplateText(STUDY_PACK_TEMPLATE_TEXT);
                  setUploadedFileName('studydeck-pack-template.txt');
                  setUploadedWordHtml(undefined);
                  setBuilderOpen(true);
                  setSourceMode('template');
                }}
                className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
              >
                Use Sample in Builder
              </button>
              <button
                type="button"
                onClick={() => setShowTemplateGuide((v) => !v)}
                className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
              >
                {showTemplateGuide ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Hide Template</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>View Template</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {showTemplateGuide && (
            <pre className="font-mono-num mt-4 max-h-80 overflow-auto rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 text-xs leading-relaxed text-[var(--ink)]">
              {STUDY_PACK_TEMPLATE_TEXT}
            </pre>
          )}
        </section>

        {/* Study Pack Builder */}
        {builderOpen && (
          <section className="sd-card space-y-4 border-[var(--e3)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
              <div>
                <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                  Create Study Pack
                </h2>
                <p className="mt-0.5 text-xs text-[var(--mute)]">
                  Upload a formatted document or package existing subjects already inside your
                  workspace.
                </p>
              </div>
              <div className="sd-seg">
                <button
                  type="button"
                  aria-pressed={sourceMode === 'template'}
                  onClick={() => setSourceMode('template')}
                  className="sd-seg-btn"
                >
                  From File / Template
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

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block text-xs font-semibold text-[var(--mute)]">
                Pack Title
                <input
                  type="text"
                  value={packTitle}
                  onChange={(e) => setPackTitle(e.target.value)}
                  placeholder={parsedDraft?.title || 'e.g. Biology Paper 1 Pack'}
                  className="sd-input mt-1 text-sm"
                />
              </label>
              <label className="block text-xs font-semibold text-[var(--mute)]">
                Subtitle
                <input
                  type="text"
                  value={packSubtitle}
                  onChange={(e) => setPackSubtitle(e.target.value)}
                  placeholder={parsedDraft?.subtitle || 'Short summary'}
                  className="sd-input mt-1 text-sm"
                />
              </label>
              <label className="block text-xs font-semibold text-[var(--mute)]">
                Exam Board / Level
                <input
                  type="text"
                  value={packBoard}
                  onChange={(e) => setPackBoard(e.target.value)}
                  placeholder="Edexcel / Cambridge / Custom"
                  className="sd-input mt-1 text-sm"
                />
              </label>
              <label className="block text-xs font-semibold text-[var(--mute)]">
                Category
                <select
                  value={packCategory}
                  onChange={(e) => setPackCategory(e.target.value as StudyPackCategory)}
                  className="sd-input mt-1 text-sm"
                >
                  <option value="combo">Subject Combo</option>
                  <option value="flashcards">Flashcard Set</option>
                  <option value="notes">Notes &amp; Topics</option>
                </select>
              </label>
            </div>

            {/* Visibility: Public vs Private */}
            <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-[var(--ink)]">
                    Who can see this Study Pack?
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--mute)]">
                    {packVisibility === 'public'
                      ? 'Public packs appear in the Study Packs library for every StudyDeck student.'
                      : 'Private packs stay in your encrypted workspace and never appear to other users.'}
                  </p>
                </div>

                <div className="sd-seg shrink-0">
                  <button
                    type="button"
                    aria-pressed={packVisibility === 'private'}
                    onClick={() => setPackVisibility('private')}
                    className="sd-seg-btn"
                  >
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Private (Only Me)</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={packVisibility === 'public'}
                    onClick={() => setPackVisibility('public')}
                    className="sd-seg-btn"
                  >
                    <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Public (Everyone)</span>
                  </button>
                </div>
              </div>

              {packVisibility === 'public' && !isSignedInVerified && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--e2)] bg-[var(--card)] px-3 py-2 text-xs">
                  <span className="text-[var(--ink)]">
                    Sign in with Google to publish Public Study Packs so every user can see them.
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
            </div>

            {sourceMode === 'template' ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-[var(--mute)]">
                    Upload a Word document (<code>.docx</code>), text (<code>.txt</code>), or
                    markdown (<code>.md</code>) file — or paste below
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
                  </div>
                </div>

                <textarea
                  rows={10}
                  value={templateText}
                  onChange={(e) => {
                    setTemplateText(e.target.value);
                    setUploadedWordHtml(undefined);
                  }}
                  placeholder={
                    '[Subject: Biology]\nTopics: Cells, Enzymes\n\n[Flashcards | Biology > Cells | Core]\nDefine osmosis | Net movement of water across a partially permeable membrane\n\n[Notes | Biology > Cells]\n## Cell Membranes\n- Controls movement into and out of the cell'
                  }
                  className="sd-input font-mono-num text-xs leading-relaxed"
                />

                {/* Include Options Checkboxes */}
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                  <div className="mb-2 text-xs font-bold text-[var(--ink)]">
                    Choose what to include in this Study Pack:
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-[var(--ink)]">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={includeSubjects}
                        onChange={(e) => setIncludeSubjects(e.target.checked)}
                      />
                      <span>
                        Subjects &amp; nested Topics{' '}
                        <span className="font-mono-num text-[var(--mute)]">
                          ({parsedDraft?.subjects.length || 0}s /{' '}
                          {parsedDraft?.subjects.reduce((sum, s) => sum + s.topics.length, 0) || 0}
                          t)
                        </span>
                      </span>
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={includeFlashcards}
                        onChange={(e) => setIncludeFlashcards(e.target.checked)}
                      />
                      <span>
                        Flashcards{' '}
                        <span className="font-mono-num text-[var(--mute)]">
                          ({parsedDraft?.cards.length || 0})
                        </span>
                      </span>
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={includeNotes}
                        onChange={(e) => setIncludeNotes(e.target.checked)}
                      />
                      <span>
                        Notes{' '}
                        <span className="font-mono-num text-[var(--mute)]">
                          ({parsedDraft?.notesByTopic.length || 0})
                        </span>
                      </span>
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={includeTodos}
                        onChange={(e) => setIncludeTodos(e.target.checked)}
                      />
                      <span>
                        To-do Tasks{' '}
                        <span className="font-mono-num text-[var(--mute)]">
                          ({parsedDraft?.todos.length || 0})
                        </span>
                      </span>
                    </label>
                  </div>

                  {parsedDraft && (
                    <div className="mt-3 space-y-2 border-t border-[var(--line)] pt-3 text-xs text-[var(--mute)]">
                      {parsedDraft.subjects.length > 0 && (
                        <div>
                          <strong className="text-[var(--ink)]">Detected Subjects &amp; Topics:</strong>{' '}
                          {parsedDraft.subjects
                            .map((s) => `${s.name} (${s.topics.join(', ') || 'Core Topic'})`)
                            .join(' · ')}
                        </div>
                      )}
                      {parsedDraft.cards.length > 0 && (
                        <div>
                          <strong className="text-[var(--ink)]">First Flashcard:</strong> Q:{' '}
                          {parsedDraft.cards[0].q} → A: {parsedDraft.cards[0].a}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={savingCustom || !parsedDraft}
                    onClick={() => void handleCreateFromTemplate(false)}
                    className="sd-btn px-4 py-2 text-xs whitespace-nowrap"
                  >
                    Save Pack Only
                  </button>
                  <button
                    type="button"
                    disabled={savingCustom || !parsedDraft}
                    onClick={() => void handleCreateFromTemplate(true)}
                    className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{savingCustom ? 'Creating…' : 'Create & Load into Workspace'}</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                {deckSnapshot.subjects.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-4 text-sm text-[var(--mute)]">
                    No active subjects in your workspace yet. Use &ldquo;From File / Template&rdquo;
                    above or add subjects in the Subjects tab first.
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

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
                      <div className="flex flex-wrap gap-4 text-xs text-[var(--mute)]">
                        <label className="inline-flex cursor-pointer items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={includeSubjects}
                            onChange={(e) => setIncludeSubjects(e.target.checked)}
                          />
                          <span>Subjects &amp; Topics</span>
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
                          <span>Formatted Notes</span>
                        </label>
                      </div>

                      <button
                        type="button"
                        disabled={savingCustom}
                        onClick={() => void handleCreateFromWorkspace()}
                        className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Save Workspace Pack</span>
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        )}

        {/* Filter & Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['all', `All Packs (${customPacks.length})`],
                ['public', `Public (${publicCount})`],
                ['private', `My Private (${privateCount})`],
                ['combo', 'Subject Combos'],
                ['flashcards', 'Flashcard Sets'],
                ['notes', 'Notes & Topics'],
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
              placeholder="Search your Study Packs…"
              aria-label="Search study packs"
              className="sd-input pl-8 text-xs"
            />
          </div>
        </div>

        {/* Empty State or Packs Grid */}
        {filteredPacks.length === 0 ? (
          <div className="sd-card p-8 text-center">
            <p className="font-display text-lg font-bold text-[var(--ink)]">
              {customPacks.length === 0
                ? 'No Study Packs yet'
                : 'No Study Packs match that search'}
            </p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-[var(--mute)]">
              {customPacks.length === 0
                ? 'Download or view the template above, upload a Word (.docx) or text file, and choose whether to create Subjects & Topics, Flashcards, or Notes.'
                : 'Try clearing your filter or search query.'}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {customPacks.length === 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setBuilderOpen(true);
                      setSourceMode('template');
                    }}
                    className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Create Study Pack</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="sd-btn px-4 py-2 text-xs whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Download Template</span>
                  </button>
                </>
              ) : (
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
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {filteredPacks.map((pack) => {
              const isApplied = appliedSet.has(pack.id);
              const isExpanded = expandedId === pack.id;
              const isBusy = applyingId === pack.id;
              const isPublic = pack.visibility === 'public';
              const isOwner = Boolean(
                !pack.ownerId || (currentUserUid && pack.ownerId === currentUserUid)
              );
              const canManage = isAdmin || isOwner;
              const authorLabel = pack.ownerName || pack.author;

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
                          <span
                            className={`inline-flex items-center gap-1 ${
                              isPublic ? 'text-[var(--ok)]' : 'text-[var(--mute)]'
                            }`}
                          >
                            {isPublic ? (
                              <>
                                <Globe className="h-3 w-3" aria-hidden="true" />
                                <span>Public</span>
                              </>
                            ) : (
                              <>
                                <Lock className="h-3 w-3" aria-hidden="true" />
                                <span>Private</span>
                              </>
                            )}
                          </span>
                          {authorLabel && (
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
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-[var(--ok)]">
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Loaded</span>
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
                        {pack.topicCountPreview} topic{pack.topicCountPreview === 1 ? '' : 's'}
                      </span>
                      <span className="text-[var(--mute)]">·</span>
                      <span>
                        {pack.cardCountPreview} flashcard
                        {pack.cardCountPreview === 1 ? '' : 's'}
                      </span>
                    </div>

                    <ul className="mt-3 space-y-1 text-xs text-[var(--mute)]">
                      {pack.highlights.slice(0, 4).map((hl, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-sm bg-[var(--e3)]" />
                          <span>{hl}</span>
                        </li>
                      ))}
                    </ul>

                    {isExpanded && (
                      <div className="mt-3 space-y-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs">
                        {pack.planner.subjects && pack.planner.subjects.length > 0 && (
                          <div>
                            <div className="font-bold text-[var(--ink)]">
                              Subjects &amp; Nested Topics
                            </div>
                            {pack.planner.subjects.map((ps, sIdx) => (
                              <div key={sIdx} className="mt-1">
                                <span className="font-semibold text-[var(--e3)]">{ps.name}</span>
                                <span className="text-[var(--mute)]">
                                  {' '}
                                  — {ps.topics.join(', ')}
                                </span>
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
                        className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
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
                          title={isPublic ? 'Make Private' : 'Make Public for all users'}
                          className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                        >
                          {isPublic ? (
                            <>
                              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Make Private</span>
                            </>
                          ) : (
                            <>
                              <Globe className="h-3.5 w-3.5 text-[var(--ok)]" aria-hidden="true" />
                              <span>Make Public</span>
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

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleUsePack(pack)}
                      className={`${
                        isApplied ? 'sd-btn' : 'sd-btn-pri'
                      } px-3.5 py-1.5 text-xs whitespace-nowrap`}
                    >
                      {isBusy
                        ? 'Loading…'
                        : isApplied
                        ? 'Re-apply Missing Items'
                        : 'Use Study Pack'}
                    </button>
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

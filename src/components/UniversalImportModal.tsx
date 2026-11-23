import {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BookOpen,
  Calendar,
  Check,
  Database,
  Download,
  FileCheck2,
  FileText,
  Globe,
  ImagePlus,
  Indent,
  KeyRound,
  Layers,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { isRichFormattedHtml, sanitizeDocumentHtml } from '../lib/documentRenderer';
import {
  encodeNoteImagePoint,
  extractClipboardImageFiles,
  extractHtmlImageSrcs,
  fileToOptimizedDataUrl,
  parseNoteImagePoint,
} from '../lib/imageUtils';
import { saveByokConfig, useByokConfig } from '../lib/byokStore';
import {
  downloadFlashcardsCsvTemplate,
  downloadNotesMarkdownTemplate,
  downloadWorkspaceBackupTemplate,
} from '../lib/backupTemplates';
import {
  clearGoogleDocsAccessToken,
  fetchGoogleDocById,
  getGoogleDocsAccessToken,
  GoogleDocListItem,
  initGoogleDocsAuth,
  listGoogleDocsFiles,
  signInWithGoogleDocs,
} from '../lib/googleDocsImport';
import { getTableSurfaceStyles, renderRichInline } from '../lib/inlineRichText';
import { renderDocumentHtmlWithLatex, renderKatexToHtml } from '../lib/latexRenderer';
import {
  applyVerifiedPartColors,
  NOTE_PART_ROLE_MAP,
  normalizeNoteColor,
  stripSectionPartColors,
} from '../lib/noteColors';
import {
  assessExistingFormattingQuality,
  AutoFormatOptions,
  createEmptyStructuredNote,
  groupSectionPoints,
  makeNoteId,
  NoteFormatPreset,
} from '../lib/noteFormat';
import { parsePdfFile } from '../lib/pdfImporter';
import { parseBackupJsonToWorkspace, parseDocxFile, parseUniversalStudyImport, QuizletDelimiterMode } from '../lib/smartImporter';
import { FlowchartBlock } from './FlowchartBlock';
import { SUBJECT_COLOR_SWATCHES } from '../lib/subjectCatalog';
import {
  buildTopicTreeList,
  makeId,
  mergeWorkspaces,
  normalizeWorkspace,
} from '../lib/workspaceStore';
import {
  KeyTermPair,
  NoteAccentColor,
  NotePartRole,
  NoteSectionBlock,
  StudyFlashcard,
  StudySubject,
  StudyTopic,
  TimelineEventItem,
  WorkspaceData,
} from '../types';

interface UniversalImportModalProps {
  open: boolean;
  onClose: () => void;
  workspace: WorkspaceData;
  defaultSubjectId?: string;
  onOpenApiKeySettings?: () => void;
  onApplyImport: (
    updater: (prev: WorkspaceData) => WorkspaceData,
    summaryMsg: string,
    targetSubjectId: string,
    targetTopicId: string
  ) => void;
}

type ImportSourceTab = 'paste' | 'quizlet' | 'web' | 'file' | 'gdocs';
type PreviewEditorTab = 'notes' | 'timeline' | 'cards';

interface EditableCardDraft {
  id: string;
  q: string;
  a: string;
  sectionName: string;
}

const SAMPLE_SNIPPET = `# Weimar Republic & Early Challenges (1918–1923)
Summary: How Germany transitioned from imperial rule to a fragile democracy facing economic and political crises.

## Political Collapse & Birth of Democracy
- **November Revolution** caused Kaiser Wilhelm II to abdicate on 9 November 1918.
  - Friedrich Ebert signed the Armistice on 11 November 1918, ending WWI fighting.
- **Treaty of Versailles** refers to the 1919 peace settlement forcing Germany to pay £6.6 billion in reparations and lose 13% of its territory.
- 1919 — Weimar Constitution adopted: Introduced proportional representation and Article 48 emergency powers.

## Economic Crisis & Hyperinflation
- Jan 1923 — French & Belgian troops invaded the Ruhr after Germany defaulted on reparations, triggering passive resistance.
- By November 1923, hyperinflation made the German mark worthless — a loaf of bread cost 200 billion marks.

| Crisis Event | Date | Impact on Weimar |
| --- | --- | --- |
| Spartacist Uprising | Jan 1919 | Crushed by Freikorps; deepened left-wing distrust |
| Kapp Putsch | Mar 1920 | General strike defeated right-wing coup attempt |
| Munich Putsch | Nov 1923 | Hitler arrested; Nazis shifted to legal elections |

Examiner Tip: Always link the Treaty of Versailles ("Diktat") to why Germans blamed Weimar politicians ("November Criminals").`;

const QUIZLET_SAMPLE = `Mitochondria\tSite of aerobic respiration where ATP is produced
Ribosome\tSite of protein synthesis (translation) in cytoplasm or rough ER
Osmosis\tNet movement of water molecules from high to low water potential through a partially permeable membrane
Active Transport\tMovement of substances against a concentration gradient using energy from respiration (ATP)
Enzyme\tBiological catalyst made of protein that lowers activation energy without being used up`;

const GIZMO_CLOZE_SAMPLE = `- In photosynthesis, {{chlorophyll}} absorbs light energy inside the {{chloroplasts}}.
- The balanced symbol equation for aerobic respiration is {{C6H12O6 + 6O2 -> 6CO2 + 6H2O}}.
- During {{mitosis}}, one parent cell divides to produce {{two genetically identical}} daughter cells.
- The {{Treaty of Versailles}} forced Germany to pay {{£6.6 billion}} in reparations in 1919.`;



const FORMAT_PRESETS: Array<{ id: NoteFormatPreset; label: string; hint: string }> = [
  {
    id: 'balanced-visual',
    label: 'Pretty & Balanced',
    hint: 'Clear headings, short paragraphs, bullets, tables, fact boxes & arrow diagrams with clean spacing',
  },
  {
    id: 'save-my-exams',
    label: 'Exam Revision',
    hint: 'Mark-scheme structure: bold key terms, concise points, tables & examiner tips',
  },
  {
    id: 'cornell',
    label: 'Summary & Cues',
    hint: 'Big-picture top summary with cue headings, indented details & glossary terms',
  },
  {
    id: 'timeline-causal',
    label: 'Timeline & Cause-Effect',
    hint: 'Chronological stages, date highlights, causal arrow chains & turning points',
  },
  {
    id: 'compact',
    label: 'Quick Cheat Sheet',
    hint: 'Condensed high-yield cram points & essential terms only',
  },
];

const QUIZLET_DELIMITERS: Array<{ id: QuizletDelimiterMode; label: string }> = [
  { id: 'auto', label: 'Auto-detect (Tab, Blank-line, ::, |, Cloze)' },
  { id: 'tab', label: 'Tab-separated (Quizlet Export)' },
  { id: 'blank-line', label: 'Blank-line pairs (Copied Quizlet cards)' },
  { id: 'alternating', label: 'Alternating lines (Line 1 Term ↵ Line 2 Def)' },
  { id: 'cloze', label: 'Gizmo Cloze ({{answer}} / ==answer==)' },
  { id: 'semicolon', label: 'Semicolon (;)' },
  { id: 'pipe', label: 'Pipe (|)' },
];

export function UniversalImportModal({
  open,
  onClose,
  workspace,
  defaultSubjectId,
  onOpenApiKeySettings,
  onApplyImport,
}: UniversalImportModalProps) {
  const byokConfig = useByokConfig();
  const [sourceTab, setSourceTab] = useState<ImportSourceTab>('paste');
  const [rawText, setRawText] = useState('');
  const [sourceLabel, setSourceLabel] = useState('Pasted Notes');
  const [legacyHtml, setLegacyHtml] = useState<string | undefined>(undefined);
  const [originalHtml, setOriginalHtml] = useState<string | undefined>(undefined);
  const [preferOriginalFormat, setPreferOriginalFormat] = useState<boolean>(true);
  const [preExtractedCards, setPreExtractedCards] = useState<
    Array<{ q: string; a: string; sectionName: string }> | undefined
  >(undefined);
  const [attachedImages, setAttachedImages] = useState<
    Array<{ id: string; dataUrl: string; caption?: string }>
  >([]);

  // Autoformatter & Quizlet/Gizmo options
  const [formatOptions, setFormatOptions] = useState<AutoFormatOptions>({
    preset: 'balanced-visual',
    extractKeyTerms: true,
    detectFlowDiagrams: true,
    autoTables: true,
    splitDenseParagraphs: true,
    strictHeadings: false,
  });
  const [colorCodeParts, setColorCodeParts] = useState<boolean>(true);
  const [deckDelimiter, setDeckDelimiter] = useState<QuizletDelimiterMode>('auto');

  const [targetSubjectId, setTargetSubjectId] = useState<string>(
    defaultSubjectId || workspace.subjects[0]?.id || '__new__'
  );
  const [targetParentTopicId, setTargetParentTopicId] = useState<string>('');
  const [linkToTopicId, setLinkToTopicId] = useState<string>('');
  const [linkCardsWithNoteTopic, setLinkCardsWithNoteTopic] = useState<boolean>(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [topicNameOverride, setTopicNameOverride] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeCards, setIncludeCards] = useState(false);
  const [includeTimeline, setIncludeTimeline] = useState(false);
  const [previewTab, setPreviewTab] = useState<PreviewEditorTab>('notes');
  const [previewNotesMode, setPreviewNotesMode] = useState<'original' | 'visual' | 'edit'>('visual');

  // Editable Pre-Save Drafts (hydrated from parsed structure + entities)
  const [draftSummary, setDraftSummary] = useState('');
  const [draftSections, setDraftSections] = useState<NoteSectionBlock[]>([]);
  const [draftKeyTerms, setDraftKeyTerms] = useState<KeyTermPair[]>([]);
  const [draftExamTip, setDraftExamTip] = useState('');
  const [draftWorkedExample, setDraftWorkedExample] = useState('');
  const [draftCards, setDraftCards] = useState<EditableCardDraft[]>([]);
  const [draftTimeline, setDraftTimeline] = useState<TimelineEventItem[]>([]);

  const [backupImportMode, setBackupImportMode] = useState<'merge' | 'replace'>('merge');
  const [readingFile, setReadingFile] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  // Web & Quizlet/Gizmo URL fetch state
  const [webUrlInput, setWebUrlInput] = useState('');
  const [quizletUrlInput, setQuizletUrlInput] = useState('');
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [aiFormatting, setAiFormatting] = useState(false);
  const [aiFormattedApplied, setAiFormattedApplied] = useState(false);
  const [keptGoodFormatNotice, setKeptGoodFormatNotice] = useState(false);
  const [aiProgressText, setAiProgressText] = useState<string | null>(null);
  const [aiElapsedMs, setAiElapsedMs] = useState(0);
  const aiAbortRef = useRef<AbortController | null>(null);

  // Google Docs state (in-memory token only)
  const [hasGoogleToken, setHasGoogleToken] = useState<boolean>(() =>
    Boolean(getGoogleDocsAccessToken())
  );
  const [gDocsLoading, setGDocsLoading] = useState(false);
  const [gDocsList, setGDocsList] = useState<GoogleDocListItem[]>([]);
  const [gDocsSearch, setGDocsSearch] = useState('');
  const [gDocUrlInput, setGDocUrlInput] = useState('');

  const backupBundle = useMemo(() => {
    const t = rawText.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) return null;
    return parseBackupJsonToWorkspace(t);
  }, [rawText]);

  const existingFormatQuality = useMemo(
    () => assessExistingFormattingQuality(rawText),
    [rawText]
  );

  const parsedPreview = useMemo(() => {
    if (
      !rawText.trim() &&
      !preExtractedCards?.length &&
      !originalHtml &&
      attachedImages.length === 0
    ) {
      return null;
    }
    if (backupBundle) return null;
    const base = parseUniversalStudyImport(rawText, {
      sourceLabel,
      legacyHtml,
      originalHtml,
      preferOriginalFormat,
      formatOptions,
      deckDelimiter: sourceTab === 'quizlet' ? deckDelimiter : 'auto',
      preExtractedCards,
    });
    if (attachedImages.length === 0) return base;
    const imgPoints = attachedImages.map((img) =>
      encodeNoteImagePoint({
        src: img.dataUrl,
        caption: img.caption?.trim() || undefined,
        width: 'wide',
      })
    );
    const existingSecs = base.note.sections.filter(
      (s) => s.points.length > 0 || (s.heading && s.heading !== 'Key Points')
    );
    const nextSections =
      existingSecs.length > 0
        ? [
            ...existingSecs.slice(0, -1),
            {
              ...existingSecs[existingSecs.length - 1],
              points: [...existingSecs[existingSecs.length - 1].points, ...imgPoints],
            },
          ]
        : [
            {
              id: makeNoteId('sec'),
              heading: 'Visual Figures',
              points: imgPoints,
            },
          ];
    return {
      ...base,
      mode: 'notes' as const,
      note: {
        ...base.note,
        sections: nextSections,
      },
    };
  }, [
    rawText,
    sourceLabel,
    legacyHtml,
    originalHtml,
    preferOriginalFormat,
    backupBundle,
    formatOptions,
    sourceTab,
    deckDelimiter,
    preExtractedCards,
    attachedImages,
  ]);

  // Keep Google Docs in-memory token synchronized with Firebase Auth sign-out
  useEffect(() => {
    const unsub = initGoogleDocsAuth(({ hasToken }) => {
      setHasGoogleToken(hasToken);
      if (!hasToken) {
        setGDocsList([]);
      }
    });
    return () => unsub();
  }, []);

  const loadGoogleDocsFiles = useCallback(async (query = '') => {
    setGDocsLoading(true);
    setErrorMsg(null);
    try {
      const files = await listGoogleDocsFiles(query);
      setGDocsList(files);
    } catch (err) {
      if (err instanceof Error && err.message === 'AUTH_REQUIRED') {
        setHasGoogleToken(false);
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Could not list Google Docs.');
      }
    } finally {
      setGDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && sourceTab === 'gdocs' && hasGoogleToken && gDocsList.length === 0) {
      void loadGoogleDocsFiles('');
    }
  }, [open, sourceTab, hasGoogleToken, gDocsList.length, loadGoogleDocsFiles]);

  // Hydrate editable Pre-Save Preview drafts whenever parsedPreview changes
  useEffect(() => {
    if (!parsedPreview) {
      setDraftSummary('');
      setDraftSections([]);
      setDraftKeyTerms([]);
      setDraftExamTip('');
      setDraftWorkedExample('');
      setDraftCards([]);
      setDraftTimeline([]);
      return;
    }

    setDraftSummary(parsedPreview.note.summary || '');
    setDraftSections(
      parsedPreview.note.sections.map((s) => ({
        id: s.id,
        heading: s.heading,
        points: [...s.points],
        ...(s.accentColor ? { accentColor: s.accentColor } : {}),
        ...(s.partRole ? { partRole: s.partRole } : {}),
      }))
    );
    setDraftKeyTerms(parsedPreview.note.keyTerms.map((k) => ({ ...k })));
    setDraftExamTip(parsedPreview.note.examTip || '');
    setDraftWorkedExample(parsedPreview.note.workedExample || '');
    setDraftCards(
      parsedPreview.cards.map((c) => ({
        id: makeNoteId('fc'),
        q: c.q,
        a: c.a,
        sectionName: c.sectionName,
      }))
    );
    setDraftTimeline(parsedPreview.timelineEvents.map((ev) => ({ ...ev })));
    setAiFormattedApplied(false);
    setKeptGoodFormatNotice(false);

    const selectedSubj = workspace.subjects.find((s) => s.id === targetSubjectId);
    const looksLikeHistory =
      Boolean(selectedSubj?.hasTimeline) ||
      /history/i.test(selectedSubj?.name || newSubjectName) ||
      parsedPreview.timelineEvents.length >= 2;

    if (parsedPreview.mode === 'flashcards-only') {
      setIncludeNotes(false);
      setIncludeCards(true);
      setIncludeTimeline(false);
      setPreviewTab('cards');
      setLinkToTopicId('');
      setLinkCardsWithNoteTopic(false);
    } else {
      setIncludeNotes(true);
      // Keep Make Flashcards user-triggered by default for notes
      setIncludeCards(false);
      setIncludeTimeline(parsedPreview.timelineEvents.length > 0 && looksLikeHistory);
      setPreviewTab('notes');
      setLinkToTopicId('');
      setLinkCardsWithNoteTopic(false);
    }
  }, [parsedPreview, targetSubjectId, newSubjectName, workspace.subjects]);

  if (!open) return null;

  const effectiveTopicName =
    topicNameOverride.trim() || parsedPreview?.suggestedTitle || 'Imported Study Topic';

  const parsedTags = tagsInput
    .split(/[,;]/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);

  const ingestImageFiles = async (files: File[], statusPrefix = 'Attached') => {
    const added: Array<{ id: string; dataUrl: string; caption?: string }> = [];
    for (const file of files) {
      const { dataUrl } = await fileToOptimizedDataUrl(file);
      added.push({
        id: makeNoteId('img'),
        dataUrl,
      });
    }
    if (added.length === 0) return;
    setAttachedImages((prev) => [...prev, ...added]);
    if (!topicNameOverride.trim() && files[0]?.name) {
      const stem = files[0].name.replace(/\.[^.]+$/, '').trim();
      if (stem && !/^image$/i.test(stem)) {
        setTopicNameOverride(stem);
      }
    }
    setPreviewTab('notes');
    setPreviewNotesMode('visual');
    setStatusNote(
      `${statusPrefix} ${added.length} image${added.length === 1 ? '' : 's'} — review integrated preview below.`
    );
  };

  const ingestFile = async (file: File) => {
    setErrorMsg(null);
    setStatusNote(null);
    setPreExtractedCards(undefined);
    setReadingFile(true);
    try {
      setSourceLabel(file.name);
      const lower = file.name.toLowerCase();

      if (
        file.type.startsWith('image/') ||
        /\.(?:png|jpe?g|webp|gif|bmp|avif)$/i.test(lower)
      ) {
        await ingestImageFiles([file], 'Loaded');
        return;
      }

      if (lower.endsWith('.pdf')) {
        if (!topicNameOverride.trim()) {
          setTopicNameOverride(file.name.replace(/\.[^.]+$/, ''));
        }
        const ab = await file.arrayBuffer();
        const res = await parsePdfFile(ab);
        const cleanPdfHtml = res.html ? sanitizeDocumentHtml(res.html) : '';
        if (!res.text.trim() && res.pageImages.length === 0 && !cleanPdfHtml) {
          throw new Error('Could not read any pages or text from this PDF.');
        }
        setLegacyHtml(undefined);
        setOriginalHtml(cleanPdfHtml || undefined);
        setPreferOriginalFormat(Boolean(cleanPdfHtml));
        if (!res.text.trim() && res.pageImages.length > 0) {
          setAttachedImages(
            res.pageImages.map((pg) => ({
              id: makeNoteId('img'),
              dataUrl: pg.dataUrl,
              caption: `Page ${pg.pageNum}`,
            }))
          );
          setRawText('');
          setPreviewNotesMode(cleanPdfHtml ? 'original' : 'visual');
          setStatusNote(
            `Rendered ${res.pageCount} scanned PDF page${res.pageCount === 1 ? '' : 's'} as visual pages.`
          );
        } else {
          setAttachedImages([]);
          if (cleanPdfHtml) setPreviewNotesMode('original');
          setRawText(res.text);
          setStatusNote(
            `Rendered ${res.pageCount} PDF page${res.pageCount === 1 ? '' : 's'} with exact visual formatting & extracted text.`
          );
        }
      } else if (lower.endsWith('.docx')) {
        if (!topicNameOverride.trim()) {
          setTopicNameOverride(file.name.replace(/\.[^.]+$/, ''));
        }
        const ab = await file.arrayBuffer();
        const res = await parseDocxFile(ab);
        const cleanDocxHtml = res.html ? sanitizeDocumentHtml(res.html) : '';
        setLegacyHtml(cleanDocxHtml || res.html);
        setOriginalHtml(cleanDocxHtml || undefined);
        setPreferOriginalFormat(Boolean(cleanDocxHtml));
        if (cleanDocxHtml) setPreviewNotesMode('original');
        setRawText(res.text);
        setStatusNote(
          'Parsed Word (.docx) fonts, colors, highlights, alignments, lists, and tables.'
        );
      } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
        const htmlRaw = await file.text();
        if (!topicNameOverride.trim()) {
          setTopicNameOverride(file.name.replace(/\.[^.]+$/, ''));
        }
        const cleanHtml = sanitizeDocumentHtml(htmlRaw);
        const doc = new DOMParser().parseFromString(htmlRaw, 'text/html');
        const extractedText = (doc.body?.innerText || doc.body?.textContent || '').trim();
        setLegacyHtml(undefined);
        setOriginalHtml(cleanHtml || undefined);
        setPreferOriginalFormat(Boolean(cleanHtml));
        if (cleanHtml) setPreviewNotesMode('original');
        setRawText(extractedText || file.name);
        setStatusNote(`Loaded exact formatting from ${file.name}.`);
      } else {
        const text = await file.text();
        setLegacyHtml(undefined);
        setOriginalHtml(undefined);
        setPreviewNotesMode('visual');
        if (!lower.endsWith('.json') && !topicNameOverride.trim()) {
          setTopicNameOverride(file.name.replace(/\.[^.]+$/, ''));
        }
        setRawText(text);
        setStatusNote(`Loaded ${file.name}.`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not read the selected file.');
    } finally {
      setReadingFile(false);
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    const allImages = files.every(
      (f) => f.type.startsWith('image/') || /\.(?:png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name)
    );
    if (allImages) {
      setErrorMsg(null);
      setReadingFile(true);
      try {
        await ingestImageFiles(files, 'Loaded');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Could not load image.');
      } finally {
        setReadingFile(false);
      }
      return;
    }
    await ingestFile(files[0]);
  };

  const handleDropFile = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;
    const imageFiles = files.filter(
      (f) => f.type.startsWith('image/') || /\.(?:png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name)
    );
    if (imageFiles.length > 0 && imageFiles.length === files.length) {
      setErrorMsg(null);
      setReadingFile(true);
      try {
        await ingestImageFiles(imageFiles, 'Dropped');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Could not load dropped image.');
      } finally {
        setReadingFile(false);
      }
      return;
    }
    await ingestFile(files[0]);
  };

  const parseJsonResponseSafe = async <T,>(res: Response, fallbackLabel: string): Promise<T> => {
    const raw = await res.text();
    if (!raw.trim()) {
      throw new Error(`${fallbackLabel} failed (empty response, HTTP ${res.status}).`);
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(
        res.ok
          ? `${fallbackLabel} returned an unexpected non-JSON response.`
          : `${fallbackLabel} error (HTTP ${res.status}). Please verify the server connection and try again.`
      );
    }
  };

  const handleFetchFromUrl = async (targetUrl: string, mode: 'quizlet' | 'web') => {
    const cleaned = targetUrl.trim();
    if (!cleaned) return;

    setErrorMsg(null);
    setStatusNote(null);
    setFetchingUrl(true);

    try {
      const normalized = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
      const res = await fetch('/api/import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized }),
      });

      const data = await parseJsonResponseSafe<{
        url?: string;
        domain?: string;
        kind?: 'notes' | 'flashcards';
        title?: string;
        markdown?: string;
        originalHtml?: string;
        cards?: Array<{ q: string; a: string; sectionName: string }>;
        error?: string;
        blocked?: boolean;
      }>(res, 'Web import');

      if (!res.ok) {
        throw new Error(data.error || `Could not fetch ${normalized} (HTTP ${res.status}).`);
      }

      const pageTitle = (data.title || data.domain || 'Web Import').trim();
      setTopicNameOverride(pageTitle);
      setLegacyHtml(undefined);

      const safeOrig = data.originalHtml ? sanitizeDocumentHtml(data.originalHtml, normalized) : '';
      const isGDoc = /docs\.google\.com/i.test(normalized);
      setOriginalHtml(safeOrig || undefined);
      setPreferOriginalFormat(Boolean(safeOrig && isGDoc));
      setPreviewNotesMode(safeOrig && isGDoc ? 'original' : 'visual');

      if (data.kind === 'flashcards' && Array.isArray(data.cards) && data.cards.length > 0) {
        setPreExtractedCards(data.cards);
        setSourceLabel(`${data.domain || 'Deck'} · ${pageTitle}`);
        setRawText(
          data.markdown || data.cards.map((c) => `${c.q}\t${c.a}`).join('\n')
        );
        setStatusNote(`Extracted ${data.cards.length} flashcards from "${pageTitle}".`);
      } else {
        setPreExtractedCards(undefined);
        setSourceLabel(`${data.domain || 'Web'} · ${pageTitle}`);
        setRawText(data.markdown || '');
        setStatusNote(
          mode === 'quizlet'
            ? `Fetched page "${pageTitle}". Check cards or switch to paste mode if the deck is behind a login.`
            : safeOrig && isGDoc
            ? `Fetched "${pageTitle}" with exact Google Docs formatting.`
            : `Fetched and structured "${pageTitle}" from ${data.domain || 'the web'}.`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to fetch web page.');
    } finally {
      setFetchingUrl(false);
    }
  };

  const handleGoogleDocsSignIn = async () => {
    setErrorMsg(null);
    setGDocsLoading(true);
    try {
      await signInWithGoogleDocs();
      setHasGoogleToken(true);
      await loadGoogleDocsFiles(gDocsSearch);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setGDocsLoading(false);
    }
  };

  const handleImportGoogleDoc = async (docIdOrUrl: string, knownTitle?: string) => {
    const trimmed = docIdOrUrl.trim();
    if (!trimmed) return;
    setErrorMsg(null);
    setStatusNote(null);
    setPreExtractedCards(undefined);
    setGDocsLoading(true);
    try {
      // If user is not signed in with Google Docs OAuth and pasted a URL, fetch directly via server export!
      if (!hasGoogleToken && /docs\.google\.com\/document/i.test(trimmed)) {
        const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        const res = await fetch('/api/import/url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: normalized }),
        });
        const data = await parseJsonResponseSafe<{
          title?: string;
          markdown?: string;
          originalHtml?: string;
          error?: string;
        }>(res, 'Google Doc fetch');
        if (!res.ok) {
          throw new Error(data.error || `Could not import Google Doc (HTTP ${res.status}).`);
        }
        const docTitle = knownTitle || data.title || 'Google Doc';
        const safeOrig = data.originalHtml ? sanitizeDocumentHtml(data.originalHtml, normalized) : '';
        setSourceLabel(`Google Doc · ${docTitle}`);
        setTopicNameOverride(docTitle);
        setLegacyHtml(undefined);
        setOriginalHtml(safeOrig || undefined);
        setPreferOriginalFormat(Boolean(safeOrig));
        setPreviewNotesMode(safeOrig ? 'original' : 'visual');
        setRawText(data.markdown || '');
        setStatusNote(`Loaded link-shared "${docTitle}" from Google Docs with original formatting.`);
        return;
      }

      const res = await fetchGoogleDocById(trimmed);
      const docTitle = knownTitle || res.title || 'Google Doc';
      const safeOrig = res.html ? sanitizeDocumentHtml(res.html) : '';
      setSourceLabel(`Google Doc · ${docTitle}`);
      setTopicNameOverride(docTitle);
      setLegacyHtml(undefined);
      setOriginalHtml(safeOrig || undefined);
      setPreferOriginalFormat(Boolean(safeOrig));
      setPreviewNotesMode(safeOrig ? 'original' : 'visual');
      setRawText(res.markdown);
      setStatusNote(`Loaded "${docTitle}" from Google Docs with exact formatting.`);
    } catch (err) {
      if (err instanceof Error && err.message === 'AUTH_REQUIRED') {
        clearGoogleDocsAccessToken();
        setHasGoogleToken(false);
        setErrorMsg(
          'Paste a full link-shared Google Docs URL (https://docs.google.com/document/d/...), or click Sign in with Google for private docs.'
        );
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Could not import Google Doc.');
      }
    } finally {
      setGDocsLoading(false);
    }
  };

  const handleConfirmBackupAll = () => {
    if (!backupBundle) return;
    const incoming = backupBundle.workspace;
    const firstIncoming = incoming.subjects[0];
    const matchingExisting = firstIncoming
      ? workspace.subjects.find(
          (s) => s.name.toLowerCase() === firstIncoming.name.toLowerCase()
        )
      : undefined;
    const firstSubjId =
      backupImportMode === 'replace'
        ? firstIncoming?.id || ''
        : matchingExisting?.id || firstIncoming?.id || workspace.subjects[0]?.id || '';
    const firstTopicId = incoming.topics[0]?.id || '';

    const parts: string[] = [];
    if (backupBundle.counts.subjects > 0) parts.push(`${backupBundle.counts.subjects} subjects`);
    if (backupBundle.counts.topics > 0) parts.push(`${backupBundle.counts.topics} topics`);
    if (backupBundle.counts.notes > 0) parts.push(`${backupBundle.counts.notes} notes`);
    if (backupBundle.counts.flashcards > 0) parts.push(`${backupBundle.counts.flashcards} flashcards`);
    if (backupBundle.counts.timelines > 0) parts.push(`${backupBundle.counts.timelines} timeline nodes`);
    if (backupBundle.counts.planner > 0) parts.push(`${backupBundle.counts.planner} planner items`);
    if (backupBundle.counts.studyLogs > 0) parts.push(`${backupBundle.counts.studyLogs} study logs`);

    onApplyImport(
      (prev) =>
        backupImportMode === 'replace'
          ? normalizeWorkspace(incoming)
          : mergeWorkspaces(prev, incoming),
      `Imported ${parts.join(', ') || 'backup data'} from ${sourceLabel}.`,
      firstSubjId,
      firstTopicId
    );

    setRawText('');
    setPreExtractedCards(undefined);
    setAttachedImages([]);
    setTopicNameOverride('');
    setTagsInput('');
    setLegacyHtml(undefined);
    setIncludeCards(false);
    onClose();
  };

  const handleConfirmImport = () => {
    if (backupBundle) {
      handleConfirmBackupAll();
      return;
    }

    if (!parsedPreview) {
      setErrorMsg(
        'Paste study notes, import a Quizlet/Gizmo deck, fetch a Web URL, upload PDF/DOCX/Markdown, or choose a Google Doc first.'
      );
      return;
    }
    if (targetSubjectId === '__new__' && !newSubjectName.trim()) {
      setErrorMsg('Enter a name for the new subject.');
      return;
    }

    let resolvedSubjId = '';
    let resolvedTopicId = '';
    const finalTopicName = effectiveTopicName;

    const cleanSections = draftSections
      .map((s) => ({
        ...s,
        heading: s.heading.trim() || 'Key Points',
        points: s.points.map((p) => p.trimEnd()).filter((p) => p.trim().length > 0),
      }))
      .filter((s) => s.points.length > 0 || s.heading !== 'Key Points');

    const cleanOrig = originalHtml
      ? sanitizeDocumentHtml(originalHtml)
      : parsedPreview.originalHtml || undefined;

    const builtNote = {
      summary: draftSummary.trim(),
      sections: cleanSections.length
        ? cleanSections
        : [{ id: makeNoteId('sec'), heading: 'Key Points', points: [] }],
      keyTerms: draftKeyTerms.filter((k) => k.term.trim() && k.definition.trim()),
      examTip: draftExamTip.trim(),
      workedExample: draftWorkedExample.trim(),
      legacyHtml: parsedPreview.legacyHtml,
      originalHtml: cleanOrig,
      preferOriginalFormat: cleanOrig ? preferOriginalFormat : undefined,
      updatedAt: new Date().toISOString(),
    };

    const validTimeline = includeTimeline
      ? draftTimeline
          .map((ev) => ({
            ...ev,
            date: ev.date.trim() || 'Undated',
            title: ev.title.trim(),
            detail: ev.detail.trim(),
            significance: ev.significance?.trim() || undefined,
            era: ev.era?.trim() || undefined,
          }))
          .filter((ev) => ev.title)
      : [];

    const validCards = includeCards
      ? draftCards.filter((c) => c.q.trim() && c.a.trim())
      : [];

    onApplyImport(
      (prev) => {
        const nextSubjects = [...prev.subjects];
        let subj: StudySubject | undefined =
          targetSubjectId !== '__new__'
            ? nextSubjects.find((s) => s.id === targetSubjectId)
            : nextSubjects.find(
                (s) => s.name.toLowerCase() === newSubjectName.trim().toLowerCase()
              );

        if (!subj) {
          subj = {
            id: makeId('subj'),
            name: newSubjectName.trim() || 'General',
            examBoard: 'GCSE / Revision',
            color: SUBJECT_COLOR_SWATCHES[nextSubjects.length % SUBJECT_COLOR_SWATCHES.length],
            examDate: '',
            weight: 2,
            hasTimeline:
              validTimeline.length > 0 || /history/i.test(newSubjectName.trim()),
            createdAt: new Date().toISOString(),
          };
          nextSubjects.push(subj);
        } else if (validTimeline.length > 0 && !subj.hasTimeline) {
          const sIdx = nextSubjects.findIndex((s) => s.id === subj!.id);
          nextSubjects[sIdx] = { ...subj, hasTimeline: true };
          subj = nextSubjects[sIdx];
        }
        resolvedSubjId = subj.id;

        const willSaveNoteTopic = includeNotes || includeTimeline;
        const nextTopics = [...prev.topics];

        if (willSaveNoteTopic) {
          const topic = nextTopics.find(
            (t) =>
              t.subjectId === subj!.id &&
              t.name.toLowerCase() === finalTopicName.toLowerCase()
          );

          if (topic) {
            resolvedTopicId = topic.id;
            const mergedTags = Array.from(
              new Set([...(topic.tags || []), ...parsedTags])
            );
            const mergedNote = includeNotes
              ? {
                  ...topic.notes,
                  summary: topic.notes.summary || builtNote.summary,
                  sections: [...topic.notes.sections, ...builtNote.sections],
                  keyTerms: [...topic.notes.keyTerms, ...builtNote.keyTerms],
                  examTip: topic.notes.examTip || builtNote.examTip,
                  workedExample: topic.notes.workedExample || builtNote.workedExample,
                  legacyHtml: builtNote.legacyHtml || topic.notes.legacyHtml,
                  originalHtml: builtNote.originalHtml || topic.notes.originalHtml,
                  preferOriginalFormat: builtNote.originalHtml
                    ? builtNote.preferOriginalFormat
                    : topic.notes.preferOriginalFormat,
                  updatedAt: new Date().toISOString(),
                }
              : topic.notes;

            const existingTimeline = topic.timelineEvents || [];
            const mergedTimeline =
              validTimeline.length > 0
                ? [...existingTimeline, ...validTimeline]
                : existingTimeline;

            const idx = nextTopics.findIndex((t) => t.id === topic.id);
            nextTopics[idx] = {
              ...topic,
              tags: mergedTags.length ? mergedTags : topic.tags,
              notes: mergedNote,
              timelineEvents: mergedTimeline.length ? mergedTimeline : topic.timelineEvents,
            };
          } else {
            const validParentId =
              targetParentTopicId &&
              nextTopics.some((t) => t.id === targetParentTopicId && t.subjectId === subj!.id)
                ? targetParentTopicId
                : undefined;
            resolvedTopicId = makeId('top');
            const createdTopic: StudyTopic = {
              id: resolvedTopicId,
              subjectId: subj.id,
              ...(validParentId ? { parentTopicId: validParentId } : {}),
              name: finalTopicName,
              tags: parsedTags.length ? parsedTags : undefined,
              completed: false,
              notes: includeNotes
                ? builtNote
                : createEmptyStructuredNote(''),
              timelineEvents: validTimeline.length ? validTimeline : undefined,
              createdAt: new Date().toISOString(),
            };
            nextTopics.push(createdTopic);
          }
        }

        const optionalLinkedTopicId = willSaveNoteTopic
          ? linkCardsWithNoteTopic
            ? resolvedTopicId
            : undefined
          : linkToTopicId &&
            nextTopics.some((t) => t.id === linkToTopicId && t.subjectId === subj!.id)
          ? linkToTopicId
          : undefined;

        const nextCards = [...prev.flashcards];
        if (validCards.length > 0) {
          const existingQ = new Set(
            nextCards
              .filter((c) => c.subjectId === subj!.id)
              .map((c) => c.q.trim().toLowerCase())
          );
          for (const c of validCards) {
            if (!c.q.trim() || !c.a.trim() || existingQ.has(c.q.trim().toLowerCase())) continue;
            existingQ.add(c.q.trim().toLowerCase());
            const fc: StudyFlashcard = {
              id: makeId('fc'),
              subjectId: subj.id,
              ...(optionalLinkedTopicId ? { topicId: optionalLinkedTopicId } : {}),
              sectionName:
                c.sectionName && c.sectionName !== 'Imported Deck'
                  ? c.sectionName
                  : finalTopicName,
              q: c.q.trim(),
              a: c.a.trim(),
              box: 1,
              dueAt: Date.now(),
              flagged: false,
              createdAt: new Date().toISOString(),
            };
            nextCards.push(fc);
          }
        }

        return {
          ...prev,
          subjects: nextSubjects,
          topics: nextTopics,
          flashcards: nextCards,
          updatedAt: new Date().toISOString(),
        };
      },
      !includeNotes && !includeTimeline
        ? `Imported ${validCards.length} flashcard${validCards.length === 1 ? '' : 's'} into "${finalTopicName}" (kept separate from Study Notes).`
        : `Imported "${finalTopicName}"${validTimeline.length ? ` · ${validTimeline.length} timeline nodes` : ''}${validCards.length ? ` · ${validCards.length} flashcards` : ''}.`,
      resolvedSubjId || targetSubjectId,
      includeNotes || includeTimeline ? resolvedTopicId : ''
    );

    setRawText('');
    setPreExtractedCards(undefined);
    setAttachedImages([]);
    setTopicNameOverride('');
    setTargetParentTopicId('');
    setLinkToTopicId('');
    setLinkCardsWithNoteTopic(false);
    setTagsInput('');
    setLegacyHtml(undefined);
    setOriginalHtml(undefined);
    setPreferOriginalFormat(true);
    setIncludeCards(false);
    setIncludeTimeline(false);
    onClose();
  };

  const convertTimelineToCards = () => {
    const existingQ = new Set(draftCards.map((c) => c.q.trim().toLowerCase()));
    const additions: EditableCardDraft[] = [];
    for (const ev of draftTimeline) {
      if (!ev.title.trim()) continue;
      const q = `When did ${ev.title.trim()} happen (and why was it significant)?`;
      if (existingQ.has(q.toLowerCase())) continue;
      existingQ.add(q.toLowerCase());
      const a = [ev.date, ev.detail, ev.significance].filter(Boolean).join(' — ');
      additions.push({
        id: makeNoteId('fc'),
        q,
        a,
        sectionName: ev.era || 'Timeline',
      });
    }
    if (additions.length > 0) {
      setDraftCards((prev) => [...prev, ...additions]);
      setIncludeCards(true);
      setPreviewTab('cards');
    }
  };

  useEffect(() => {
    if (!aiFormatting) {
      setAiElapsedMs(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => {
      setAiElapsedMs(Date.now() - started);
    }, 100);
    return () => window.clearInterval(id);
  }, [aiFormatting]);

  useEffect(() => {
    if (!open) {
      setAttachedImages([]);
      if (aiAbortRef.current) {
        aiAbortRef.current.abort();
        aiAbortRef.current = null;
      }
    }
  }, [open]);

  const handleCancelAiAutoformat = () => {
    if (aiAbortRef.current) {
      aiAbortRef.current.abort();
      aiAbortRef.current = null;
    }
  };

  const handleAiAutoformat = async (forceRewrite = true) => {
    if (!byokConfig) {
      setErrorMsg(
        'AI Autoformat requires your own API key. Add one in Account & Data (the website key is strictly for Live Quiz marking).'
      );
      return;
    }
    if (!rawText.trim()) return;

    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    const timeoutMs = rawText.length > 15000 ? 120000 : 90000;
    const clientTimeout = window.setTimeout(() => controller.abort('timeout'), timeoutMs);
    const startedAt = Date.now();

    setAiFormatting(true);
    setKeptGoodFormatNotice(false);
    setAiProgressText('Compacting notes & connecting…');
    setErrorMsg(null);
    setStatusNote(null);

    try {
      const selectedSubj = workspace.subjects.find((s) => s.id === targetSubjectId);
      const wantsTimeline =
        includeTimeline ||
        Boolean(selectedSubj?.hasTimeline) ||
        /history/i.test(selectedSubj?.name || newSubjectName) ||
        (parsedPreview?.timelineEvents.length || 0) > 0;

      const res = await fetch('/api/ai/autoformat', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
        },
        body: JSON.stringify({
          rawText,
          preset: formatOptions.preset || 'balanced-visual',
          includeCards,
          includeTimeline: wantsTimeline,
          detectFlowDiagrams: formatOptions.detectFlowDiagrams !== false,
          autoTables: formatOptions.autoTables !== false,
          colorCodeParts,
          forceRewrite,
          stream: true,
          byok: byokConfig,
        }),
      });

      type FormattedData = {
        title?: string;
        summary: string;
        sections: Array<{
          heading: string;
          points: string[];
          partRole?: NotePartRole;
          accentColor?: NoteAccentColor;
        }>;
        keyTerms: Array<{ term: string; definition: string }>;
        examTip: string;
        workedExample: string;
        timelineEvents: Array<{
          date: string;
          title: string;
          detail: string;
          significance?: string;
          era?: string;
          keyEvent?: boolean;
        }>;
        cards: Array<{ q: string; a: string; sectionName: string }>;
      };
      type UsageData = {
        model: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cachedTokens?: number;
      };

      let formattedResult: FormattedData | undefined;
      let usageResult: UsageData | undefined;
      let keptExisting = false;

      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';
          for (const frame of frames) {
            const dataLines = frame
              .split('\n')
              .map((l) => l.trim())
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trim());
            if (!dataLines.length) continue;
            const rawJson = dataLines.join('');
            let ev: {
              type?: string;
              message?: string;
              model?: string;
              chars?: number;
              formatted?: FormattedData;
              usage?: UsageData;
              keptExistingFormat?: boolean;
              error?: string;
            } = {};
            try {
              ev = JSON.parse(rawJson);
            } catch {
              continue;
            }

            if (ev.type === 'status' && ev.message) {
              setAiProgressText(ev.message);
            } else if (ev.type === 'progress') {
              setAiProgressText(
                `Streaming from ${ev.model || 'AI'} (${ev.chars || 0} chars)…`
              );
            } else if (ev.type === 'error') {
              throw new Error(ev.error || 'AI Autoformat failed.');
            } else if (ev.type === 'done') {
              formattedResult = ev.formatted;
              usageResult = ev.usage;
              keptExisting = Boolean(ev.keptExistingFormat);
            }
          }
        }
      } else {
        const data = await parseJsonResponseSafe<{
          formatted?: FormattedData;
          usage?: UsageData;
          keptExistingFormat?: boolean;
          error?: string;
        }>(res, 'AI Autoformat');

        if (!res.ok || !data.formatted) {
          throw new Error(data.error || `AI Autoformat failed (HTTP ${res.status}).`);
        }
        formattedResult = data.formatted;
        usageResult = data.usage;
        keptExisting = Boolean(data.keptExistingFormat);
      }

      if (!formattedResult) {
        throw new Error('AI Autoformat finished without formatted output. Please try again.');
      }

      const f = formattedResult;
      if (f.title && !topicNameOverride.trim()) {
        setTopicNameOverride(f.title);
      }
      setDraftSummary(f.summary || '');
      setDraftSections(
        f.sections.map((s) => ({
          id: makeNoteId('sec'),
          heading: s.heading,
          points: [...s.points],
          ...(colorCodeParts && s.partRole ? { partRole: s.partRole } : {}),
          ...(colorCodeParts && s.accentColor && s.accentColor !== 'default'
            ? { accentColor: s.accentColor }
            : {}),
        }))
      );
      setDraftKeyTerms(
        f.keyTerms.map((k) => ({
          id: makeNoteId('term'),
          term: k.term,
          definition: k.definition,
        }))
      );
      setDraftExamTip(f.examTip || '');
      setDraftWorkedExample(f.workedExample || '');

      if (f.timelineEvents?.length) {
        setDraftTimeline(
          f.timelineEvents.map((ev) => ({
            id: makeNoteId('ev'),
            date: ev.date,
            title: ev.title,
            detail: ev.detail,
            significance: ev.significance,
            era: ev.era,
            keyEvent: ev.keyEvent,
          }))
        );
      }

      if (f.cards?.length) {
        setDraftCards(
          f.cards.map((c) => ({
            id: makeNoteId('fc'),
            q: c.q,
            a: c.a,
            sectionName: c.sectionName,
          }))
        );
      }

      setAiFormattedApplied(!keptExisting);
      setKeptGoodFormatNotice(keptExisting);
      setPreferOriginalFormat(false);
      setPreviewNotesMode('visual');
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      const u = usageResult;
      let switchedModelNotice = '';
      if (!keptExisting && u?.model && u.model !== 'kept-existing' && byokConfig) {
        const prevCustom = (byokConfig.model || '').trim();
        const prevVerified = (byokConfig.verifiedModel || '').trim();
        if (prevCustom && prevCustom !== u.model) {
          saveByokConfig({ ...byokConfig, model: u.model, verifiedModel: u.model });
          switchedModelNotice = `Auto-switched from ${prevCustom} to ${u.model} · `;
        } else if (prevVerified !== u.model) {
          saveByokConfig({ ...byokConfig, verifiedModel: u.model });
          if (prevVerified) {
            switchedModelNotice = `Auto-switched from ${prevVerified} to ${u.model} · `;
          }
        }
      }
      const cacheNote = u?.cachedTokens ? ` · ${u.cachedTokens} cached` : '';
      setStatusNote(
        keptExisting
          ? 'Format is already good — kept existing layout (0 AI tokens used).'
          : u
          ? `${switchedModelNotice}AI Autoformatted in ${elapsedSec}s (${u.model}${u.totalTokens ? ` · ${u.totalTokens} tokens` : ''}${cacheNote}).`
          : `AI Autoformatted in ${elapsedSec}s using your personal API key.`
      );
    } catch (err) {
      if (controller.signal.aborted) {
        setErrorMsg(
          controller.signal.reason === 'timeout'
            ? `AI Autoformat timed out after ${Math.round(timeoutMs / 1000)}s. Try shorter text or check your API key.`
            : 'AI Autoformat cancelled.'
        );
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'AI Autoformat failed.');
      }
    } finally {
      window.clearTimeout(clientTimeout);
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null;
      }
      setAiFormatting(false);
      setAiProgressText(null);
    }
  };

  const handleRevertInstantFormat = () => {
    if (!parsedPreview) return;
    setDraftSummary(parsedPreview.note.summary || '');
    setDraftSections(
      parsedPreview.note.sections.map((s) => ({
        id: s.id,
        heading: s.heading,
        points: [...s.points],
      }))
    );
    setDraftKeyTerms(parsedPreview.note.keyTerms.map((k) => ({ ...k })));
    setDraftExamTip(parsedPreview.note.examTip || '');
    setDraftWorkedExample(parsedPreview.note.workedExample || '');
    setDraftCards(
      parsedPreview.cards.map((c) => ({
        id: makeNoteId('fc'),
        q: c.q,
        a: c.a,
        sectionName: c.sectionName,
      }))
    );
    setDraftTimeline(parsedPreview.timelineEvents.map((ev) => ({ ...ev })));
    setAiFormattedApplied(false);
    setStatusNote('Restored local instant autoformatted preview.');
  };

  const toggleFormatFlag = (
    key:
      | 'detectFlowDiagrams'
      | 'autoTables'
      | 'extractKeyTerms'
      | 'splitDenseParagraphs'
      | 'strictHeadings'
  ) => {
    setFormatOptions((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? (key === 'strictHeadings' ? false : true)),
    }));
  };

  const handleToggleColorCodeParts = () => {
    setColorCodeParts((prev) => {
      const next = !prev;
      if (!next) {
        setDraftSections((secs) => stripSectionPartColors(secs));
      } else if (aiFormattedApplied || keptGoodFormatNotice) {
        setDraftSections((secs) => applyVerifiedPartColors(secs, true));
      }
      return next;
    });
  };

  const totalDraftPoints = draftSections.reduce((acc, s) => acc + s.points.length, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="universal-import-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sd-card flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <div>
            <h2
              id="universal-import-title"
              className="font-display text-xl font-bold text-[var(--ink)]"
            >
              Note &amp; Study Importer
            </h2>
            <p className="mt-0.5 text-xs text-[var(--mute)]">
              Ingest pasted notes, Quizlet &amp; Gizmo decks, revision webpages (Save My Exams, BBC
              Bitesize), PDF/DOCX, or Google Docs — customize the autoformatter before saving.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close importer"
            className="sd-btn h-8 w-8 shrink-0 p-0"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {errorMsg && (
            <div className="rounded-xl border border-[var(--bad)] bg-[var(--bg)] px-3.5 py-2.5 text-xs font-semibold text-[var(--bad)]">
              {errorMsg}
            </div>
          )}
          {statusNote && !errorMsg && (
            <div className="rounded-xl border border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_8%,var(--bg))] px-3.5 py-2 text-xs font-semibold text-[var(--ok)]">
              {statusNote}
            </div>
          )}

          {/* Source Switcher */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="sd-seg flex-wrap" role="tablist" aria-label="Import source">
                <button
                  type="button"
                  role="tab"
                  aria-selected={sourceTab === 'paste'}
                  aria-pressed={sourceTab === 'paste'}
                  onClick={() => setSourceTab('paste')}
                  className="sd-seg-btn whitespace-nowrap"
                >
                  Paste Text
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sourceTab === 'quizlet'}
                  aria-pressed={sourceTab === 'quizlet'}
                  onClick={() => setSourceTab('quizlet')}
                  className="sd-seg-btn whitespace-nowrap"
                >
                  Quizlet &amp; Gizmo
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sourceTab === 'web'}
                  aria-pressed={sourceTab === 'web'}
                  onClick={() => setSourceTab('web')}
                  className="sd-seg-btn whitespace-nowrap"
                >
                  Web URL
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sourceTab === 'file'}
                  aria-pressed={sourceTab === 'file'}
                  onClick={() => setSourceTab('file')}
                  className="sd-seg-btn whitespace-nowrap"
                >
                  Upload File
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sourceTab === 'gdocs'}
                  aria-pressed={sourceTab === 'gdocs'}
                  onClick={() => setSourceTab('gdocs')}
                  className="sd-seg-btn whitespace-nowrap"
                >
                  Google Docs
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setSourceTab('paste');
                  setSourceLabel('Sample History Notes');
                  setLegacyHtml(undefined);
                  setOriginalHtml(undefined);
                  setPreviewNotesMode('visual');
                  setPreExtractedCards(undefined);
                  setRawText(SAMPLE_SNIPPET);
                  setTopicNameOverride('Weimar Republic & Early Challenges (1918–1923)');
                  setTagsInput('History, Paper 1, Core');
                  setErrorMsg(null);
                  setStatusNote('Loaded structured lecture sample with dates and definitions.');
                }}
                className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
              >
                Load Example
              </button>
            </div>

            {/* Source 1: Paste Text */}
            {sourceTab === 'paste' && (
              <div className="space-y-2.5">
                <textarea
                  rows={6}
                  value={rawText}
                  onPaste={(e: ClipboardEvent<HTMLTextAreaElement>) => {
                    const clipImages = extractClipboardImageFiles(e.clipboardData);
                    if (clipImages.length > 0) {
                      e.preventDefault();
                      void ingestImageFiles(clipImages, 'Pasted');
                      return;
                    }
                    const htmlData = e.clipboardData?.getData('text/html') || '';
                    if (htmlData && isRichFormattedHtml(htmlData)) {
                      const cleanClipHtml = sanitizeDocumentHtml(htmlData);
                      if (cleanClipHtml) {
                        setOriginalHtml(cleanClipHtml);
                        setPreferOriginalFormat(true);
                        setPreviewNotesMode('original');
                        setStatusNote(
                          'Captured rich formatting (colors, highlights, headings, tables) from clipboard!'
                        );
                      }
                      return;
                    }
                    const imgSrcs = extractHtmlImageSrcs(htmlData);
                    if (imgSrcs.length > 0 && !e.clipboardData?.getData('text/plain')?.trim()) {
                      e.preventDefault();
                      setAttachedImages((prev) => [
                        ...prev,
                        ...imgSrcs.map((src) => ({ id: makeNoteId('img'), dataUrl: src })),
                      ]);
                      setPreviewTab('notes');
                      setPreviewNotesMode('visual');
                      setStatusNote(
                        `Pasted ${imgSrcs.length} image${imgSrcs.length === 1 ? '' : 's'} into import preview.`
                      );
                    }
                  }}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    setPreExtractedCards(undefined);
                    setErrorMsg(null);
                  }}
                  placeholder={
                    'Paste raw lecture notes, Ctrl+V screenshots/images, Word/Google Docs copy, Markdown, Q:/A:, CSV, or a .json backup:\n• Press Ctrl+V to attach copied images or rich formatted Word/Google Docs text\n• Or type # Headings, ## Subsections, - Bullets, and Term: Definition'
                  }
                  className="sd-input font-mono-num text-xs leading-relaxed"
                />
                {attachedImages.length > 0 && (
                  <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                    <div className="flex items-center justify-between text-xs font-semibold text-[var(--ink)]">
                      <span className="inline-flex items-center gap-1.5">
                        <ImagePlus className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                        Attached Images ({attachedImages.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => setAttachedImages([])}
                        className="cursor-pointer text-[11px] font-semibold text-[var(--mute)] hover:text-[var(--bad)]"
                      >
                        Clear all
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                      {attachedImages.map((img) => (
                        <div
                          key={img.id}
                          className="relative flex flex-col gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--card)] p-2"
                        >
                          <img
                            src={img.dataUrl}
                            alt={img.caption || 'Attached figure'}
                            className="h-24 w-full rounded object-contain bg-[var(--bg)]"
                          />
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={img.caption || ''}
                              onChange={(e) =>
                                setAttachedImages((prev) =>
                                  prev.map((item) =>
                                    item.id === img.id
                                      ? { ...item, caption: e.target.value }
                                      : item
                                  )
                                )
                              }
                              placeholder="Caption (optional)…"
                              className="sd-input flex-1 py-0.5 text-[11px]"
                            />
                            <button
                              type="button"
                              aria-label="Remove attached image"
                              onClick={() =>
                                setAttachedImages((prev) =>
                                  prev.filter((item) => item.id !== img.id)
                                )
                              }
                              className="sd-btn h-6 w-6 shrink-0 p-0 text-[var(--mute)] hover:text-[var(--bad)]"
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {originalHtml && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color-mix(in_srgb,var(--e3)_35%,var(--line))] bg-[color-mix(in_srgb,var(--e3)_7%,var(--bg))] px-3 py-1.5 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink)]">
                      <FileCheck2 className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                      Rich document formatting preserved — open &ldquo;Original Document&rdquo; in preview below.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setOriginalHtml(undefined);
                        setPreferOriginalFormat(false);
                        setPreviewNotesMode('visual');
                      }}
                      className="cursor-pointer font-semibold text-[var(--mute)] hover:text-[var(--bad)]"
                    >
                      Clear formatting
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mute)]">
                  <span className="font-semibold">Download template:</span>
                  <button
                    type="button"
                    onClick={downloadFlashcardsCsvTemplate}
                    className="cursor-pointer inline-flex items-center gap-1 font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                  >
                    <Download className="h-3 w-3" aria-hidden="true" />
                    <span>Flashcards (.csv)</span>
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={downloadNotesMarkdownTemplate}
                    className="cursor-pointer inline-flex items-center gap-1 font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                  >
                    <Download className="h-3 w-3" aria-hidden="true" />
                    <span>Notes (.md)</span>
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={downloadWorkspaceBackupTemplate}
                    className="cursor-pointer inline-flex items-center gap-1 font-semibold text-[var(--e2)] hover:underline whitespace-nowrap"
                  >
                    <Download className="h-3 w-3" aria-hidden="true" />
                    <span>Full Backup (.json)</span>
                  </button>
                </div>
              </div>
            )}

            {/* Source 2: Quizlet & Gizmo (URL Fetch + Paste Export / Cloze) */}
            {sourceTab === 'quizlet' && (
              <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-bold text-[var(--ink)]">
                      <Layers className="h-4 w-4 text-[var(--ok)]" aria-hidden="true" />
                      <span>Quizlet &amp; Gizmo Deck Importer</span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--mute)]">
                      Fetch a public Quizlet/Gizmo set URL, or paste Quizlet Export text, copied
                      term/definition pairs, or Gizmo <code className="font-mono-num">{'{{cloze}}'}</code>{' '}
                      highlights below.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setDeckDelimiter('tab');
                        setPreExtractedCards(undefined);
                        setSourceLabel('Quizlet Biology Deck');
                        setTopicNameOverride('Cell Biology & Transport');
                        setRawText(QUIZLET_SAMPLE);
                        setErrorMsg(null);
                        setStatusNote('Loaded sample Quizlet tab-exported flashcard set.');
                      }}
                      className="sd-btn px-2.5 py-1 text-xs whitespace-nowrap"
                    >
                      Quizlet Sample
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeckDelimiter('cloze');
                        setPreExtractedCards(undefined);
                        setSourceLabel('Gizmo Cloze Deck');
                        setTopicNameOverride('Key Cloze Recall Cards');
                        setRawText(GIZMO_CLOZE_SAMPLE);
                        setErrorMsg(null);
                        setStatusNote('Loaded sample Gizmo {{cloze}} flashcard deck.');
                      }}
                      className="sd-btn px-2.5 py-1 text-xs whitespace-nowrap"
                    >
                      Gizmo Cloze Sample
                    </button>
                  </div>
                </div>

                {/* Quizlet / Gizmo URL input */}
                <div className="flex flex-wrap gap-2">
                  <input
                    type="url"
                    value={quizletUrlInput}
                    onChange={(e) => setQuizletUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && quizletUrlInput.trim()) {
                        void handleFetchFromUrl(quizletUrlInput, 'quizlet');
                      }
                    }}
                    placeholder="https://quizlet.com/... or https://gizmo.ai/..."
                    className="sd-input min-w-[230px] flex-1 text-xs"
                  />
                  <button
                    type="button"
                    disabled={fetchingUrl || !quizletUrlInput.trim()}
                    onClick={() => void handleFetchFromUrl(quizletUrlInput, 'quizlet')}
                    className="sd-btn-pri px-3.5 py-2 text-xs whitespace-nowrap"
                  >
                    {fetchingUrl ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span>{fetchingUrl ? 'Fetching Deck…' : 'Fetch Deck'}</span>
                  </button>
                </div>

                {/* Format / Delimiter Selector */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="font-semibold text-[var(--mute)]" htmlFor="quizlet-delim">
                    Card Format:
                  </label>
                  <select
                    id="quizlet-delim"
                    value={deckDelimiter}
                    onChange={(e) => {
                      setDeckDelimiter(e.target.value as QuizletDelimiterMode);
                      setPreExtractedCards(undefined);
                    }}
                    className="sd-input w-auto flex-1 py-1.5 text-xs font-semibold text-[var(--ink)]"
                  >
                    {QUIZLET_DELIMITERS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>

                <textarea
                  rows={5}
                  value={rawText}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    setSourceLabel('Quizlet / Gizmo Deck');
                    setPreExtractedCards(undefined);
                    setErrorMsg(null);
                  }}
                  placeholder={
                    'Paste Quizlet Export (Tab/Semicolon) or copied Quizlet/Gizmo cards:\n• Term [Tab] Definition\n• Term (line 1) / Definition (line 2)\n• In Gizmo format: Germany paid {{£6.6 billion}} in 1919.'
                  }
                  className="sd-input font-mono-num text-xs leading-relaxed"
                />
              </div>
            )}

            {/* Source 3: Web URL Importer (Save My Exams, BBC Bitesize, Wikipedia, etc.) */}
            {sourceTab === 'web' && (
              <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-bold text-[var(--ink)]">
                    <Globe className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                    <span>Import Revision Webpage (Save My Exams, BBC Bitesize, Wikipedia…)</span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--mute)]">
                    Automatically strips site menus, banners, and sidebars — preserving revision
                    headings, nested bullet lists, comparison tables, worked examples, and examiner
                    tips.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <input
                    type="url"
                    value={webUrlInput}
                    onChange={(e) => setWebUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && webUrlInput.trim()) {
                        void handleFetchFromUrl(webUrlInput, 'web');
                      }
                    }}
                    placeholder="https://www.savemyexams.com/... or https://www.bbc.co.uk/bitesize/..."
                    className="sd-input min-w-[240px] flex-1 text-xs"
                  />
                  <button
                    type="button"
                    disabled={fetchingUrl || !webUrlInput.trim()}
                    onClick={() => void handleFetchFromUrl(webUrlInput, 'web')}
                    className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                  >
                    {fetchingUrl ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span>{fetchingUrl ? 'Extracting Notes…' : 'Fetch & Format Notes'}</span>
                  </button>
                </div>

                <div className="text-[11px] text-[var(--mute)]">
                  Tip: If a webpage requires a paid login or blocks automated access, select &amp;
                  copy the article text and paste it in the <strong className="text-[var(--ink)]">Paste Text</strong>{' '}
                  tab — the autoformatter cleans navigation lines and rebuilds headings &amp; tables automatically.
                </div>
              </div>
            )}

            {/* Source 4: File Upload (PDF / DOCX / MD / TXT / CSV / JSON) */}
            {sourceTab === 'file' && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => void handleDropFile(e)}
                className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                  dragActive
                    ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_8%,var(--bg))]'
                    : 'border-[var(--line)] bg-[var(--bg)]'
                }`}
              >
                {readingFile ? (
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--e3)]" aria-hidden="true" />
                ) : (
                  <Upload className="h-6 w-6 text-[var(--e3)]" aria-hidden="true" />
                )}
                <p className="mt-2 text-sm font-semibold text-[var(--ink)]">
                  {readingFile
                    ? 'Rendering PDF pages / optimizing files…'
                    : 'Drop a PDF, image (PNG/JPG/WebP), Word (.docx), HTML, Markdown (.md), CSV, or Planner / Backup file'}
                </p>
                <p className="mt-1 text-xs text-[var(--mute)]">
                  Renders PDF pages visually, integrates images seamlessly into notes, imports Revision Planner / StudyWeb backups (with or without .json extension), and extracts flashcards.
                </p>
                <label className="sd-btn-pri mt-3 cursor-pointer px-4 py-2 text-xs whitespace-nowrap">
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Choose File</span>
                  <input
                    type="file"
                    multiple
                    onChange={(e) => void handleFileChange(e)}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            {/* Source 5: Google Docs */}
            {sourceTab === 'gdocs' && (
              <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                {/* Always allow fetching a link-shared Google Doc URL even without OAuth */}
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-[var(--ink)]">
                    Import by Google Docs URL (works directly for link-shared docs):
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={gDocUrlInput}
                      onChange={(e) => setGDocUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && gDocUrlInput.trim()) {
                          void handleImportGoogleDoc(gDocUrlInput);
                        }
                      }}
                      placeholder="https://docs.google.com/document/d/…"
                      className="sd-input min-w-[240px] flex-1 text-xs"
                    />
                    <button
                      type="button"
                      disabled={gDocsLoading || !gDocUrlInput.trim()}
                      onClick={() => void handleImportGoogleDoc(gDocUrlInput)}
                      className="sd-btn-pri px-3 py-2 text-xs whitespace-nowrap"
                    >
                      {gDocsLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>{gDocsLoading ? 'Importing…' : 'Fetch Doc'}</span>
                    </button>
                  </div>
                </div>

                {!hasGoogleToken ? (
                  <div className="flex flex-col items-start justify-between gap-3 border-t border-[var(--line)] pt-3 sm:flex-row sm:items-center">
                    <div>
                      <div className="text-sm font-bold text-[var(--ink)]">
                        Or connect private Google Docs
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--mute)]">
                        Sign in to browse private Drive documents, or export from Google Docs (File
                        → Download → Word .docx) and drop it in Upload File.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={gDocsLoading}
                      onClick={() => void handleGoogleDocsSignIn()}
                      className="gsi-material-button shrink-0"
                    >
                      <div className="gsi-material-button-state" />
                      <div className="gsi-material-button-content-wrapper">
                        <div className="gsi-material-button-icon">
                          <svg
                            version="1.1"
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 48 48"
                            style={{ display: 'block' }}
                          >
                            <path
                              fill="#EA4335"
                              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                            />
                            <path
                              fill="#4285F4"
                              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                            />
                            <path
                              fill="#FBBC05"
                              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                            />
                            <path
                              fill="#34A853"
                              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                            />
                            <path fill="none" d="M0 0h48v48H0z" />
                          </svg>
                        </div>
                        <span className="gsi-material-button-contents">Sign in with Google</span>
                        <span style={{ display: 'none' }}>Sign in with Google</span>
                      </div>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3 border-t border-[var(--line)] pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="relative min-w-[200px] flex-1">
                        <Search
                          className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--mute)]"
                          aria-hidden="true"
                        />
                        <input
                          type="text"
                          value={gDocsSearch}
                          onChange={(e) => setGDocsSearch(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void loadGoogleDocsFiles(gDocsSearch);
                          }}
                          placeholder="Search your Google Docs by title…"
                          className="sd-input pl-8 text-xs"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={gDocsLoading}
                        onClick={() => void loadGoogleDocsFiles(gDocsSearch)}
                        className="sd-btn px-3 py-2 text-xs whitespace-nowrap"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${gDocsLoading ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        <span>Search</span>
                      </button>
                    </div>

                    {gDocsList.length > 0 ? (
                      <div className="max-h-44 divide-y divide-[var(--line)] overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--card)]">
                        {gDocsList.map((docItem) => (
                          <div
                            key={docItem.id}
                            className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-[var(--ink)]">
                                {docItem.name}
                              </div>
                              <div className="font-mono-num text-[11px] text-[var(--mute)]">
                                Modified{' '}
                                {docItem.modifiedTime ? docItem.modifiedTime.slice(0, 10) : 'Recently'}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={gDocsLoading}
                              onClick={() => void handleImportGoogleDoc(docItem.id, docItem.name)}
                              className="sd-btn px-2.5 py-1 text-xs whitespace-nowrap"
                            >
                              Import
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--mute)]">
                        {gDocsLoading
                          ? 'Loading your Google Docs…'
                          : 'No documents listed yet. Search above or paste a Google Docs link.'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Full Backup Bundle Mode (.json file) */}
          {backupBundle && (
            <div className="space-y-4 border-t border-[var(--line)] pt-4">
              <div className="rounded-xl border border-[var(--e3)] bg-[var(--bg)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--e3)]">
                    <Database className="h-4 w-4" aria-hidden="true" />
                    <span>{backupBundle.formatLabel} Detected</span>
                  </div>
                  <span className="font-mono-num text-xs font-semibold text-[var(--mute)]">
                    {sourceLabel}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--mute)]">
                      <FileText className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                      <span>Subjects &amp; Topics</span>
                    </div>
                    <div className="font-mono-num mt-1 text-lg font-bold text-[var(--ink)]">
                      {backupBundle.counts.topics}
                    </div>
                    <div className="text-[11px] text-[var(--mute)]">
                      across {backupBundle.counts.subjects} subject(s)
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--mute)]">
                      <BookOpen className="h-3.5 w-3.5 text-[var(--e2)]" aria-hidden="true" />
                      <span>Notes &amp; Timelines</span>
                    </div>
                    <div className="font-mono-num mt-1 text-lg font-bold text-[var(--ink)]">
                      {backupBundle.counts.notes}
                    </div>
                    <div className="text-[11px] text-[var(--mute)]">
                      {backupBundle.counts.timelines > 0
                        ? `+ ${backupBundle.counts.timelines} timeline node(s)`
                        : 'structured note pages'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--mute)]">
                      <Layers className="h-3.5 w-3.5 text-[var(--ok)]" aria-hidden="true" />
                      <span>Flashcards</span>
                    </div>
                    <div className="font-mono-num mt-1 text-lg font-bold text-[var(--ink)]">
                      {backupBundle.counts.flashcards}
                    </div>
                    <div className="text-[11px] text-[var(--mute)]">with box progress</div>
                  </div>
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--mute)]">
                      <Calendar className="h-3.5 w-3.5 text-[var(--mute)]" aria-hidden="true" />
                      <span>Planner &amp; Logs</span>
                    </div>
                    <div className="font-mono-num mt-1 text-lg font-bold text-[var(--ink)]">
                      {backupBundle.counts.planner}
                    </div>
                    <div className="text-[11px] text-[var(--mute)]">
                      +{backupBundle.counts.studyLogs} study log(s)
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <label className="text-xs font-semibold text-[var(--mute)]">
                    Import Mode:
                    <select
                      value={backupImportMode}
                      onChange={(e) =>
                        setBackupImportMode(e.target.value === 'replace' ? 'replace' : 'merge')
                      }
                      className="sd-input ml-2 inline-block w-auto py-1 text-xs font-semibold text-[var(--ink)]"
                    >
                      <option value="merge">Merge with existing workspace</option>
                      <option value="replace">Replace entire workspace</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={handleConfirmBackupAll}
                    className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Import Full Backup</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Interactive Editable Pre-Save Preview */}
          {parsedPreview && (
            <div className="space-y-4 border-t border-[var(--line)] pt-4">
              {!includeNotes && !includeTimeline && includeCards && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ok)]/40 bg-[color-mix(in_srgb,var(--ok)_7%,var(--bg))] px-4 py-2.5 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-[var(--ink)]">
                    <Layers className="h-4 w-4 shrink-0 text-[var(--ok)]" aria-hidden="true" />
                    <span>
                      Flashcard deck detected ({draftCards.length} cards) — no Study Notes page will be added.
                    </span>
                  </div>
                  <span className="text-[11px] text-[var(--mute)]">
                    Separate from Study Notes by default
                  </span>
                </div>
              )}

              {/* Assignment & Tags / Optional Link Row */}
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Course / Subject
                  <select
                    value={targetSubjectId}
                    onChange={(e) => {
                      setTargetSubjectId(e.target.value);
                      setTargetParentTopicId('');
                      setLinkToTopicId('');
                    }}
                    className="sd-input mt-1 text-sm"
                  >
                    {workspace.subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                    <option value="__new__">+ Create a new subject</option>
                  </select>
                </label>

                {targetSubjectId === '__new__' ? (
                  <label className="block text-xs font-semibold text-[var(--mute)]">
                    New Subject Name *
                    <input
                      type="text"
                      value={newSubjectName}
                      onChange={(e) => setNewSubjectName(e.target.value)}
                      placeholder="e.g. History"
                      className="sd-input mt-1 text-sm"
                    />
                  </label>
                ) : (
                  <label className="block text-xs font-semibold text-[var(--mute)]">
                    {!includeNotes && !includeTimeline ? 'Deck / Section Name' : 'Topic Name'}
                    <input
                      type="text"
                      value={topicNameOverride}
                      onChange={(e) => setTopicNameOverride(e.target.value)}
                      placeholder={parsedPreview.suggestedTitle}
                      className="sd-input mt-1 text-sm"
                    />
                  </label>
                )}

                {includeNotes || includeTimeline ? (
                  <label className="block text-xs font-semibold text-[var(--mute)]">
                    <span className="inline-flex items-center gap-1">
                      <Tag className="h-3 w-3" aria-hidden="true" />
                      Tags (comma-separated)
                    </span>
                    <input
                      type="text"
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                      placeholder="e.g. Paper 1, Causes, Exam Core"
                      className="sd-input mt-1 text-sm"
                    />
                  </label>
                ) : targetSubjectId !== '__new__' ? (
                  (() => {
                    const subjTopics = workspace.topics.filter(
                      (t) => t.subjectId === targetSubjectId
                    );
                    const tree = buildTopicTreeList(subjTopics);
                    return (
                      <label className="block text-xs font-semibold text-[var(--mute)]">
                        Link to Study Notes Topic (optional)
                        <select
                          value={linkToTopicId}
                          onChange={(e) => setLinkToTopicId(e.target.value)}
                          className="sd-input mt-1 text-sm"
                        >
                          <option value="">None — Keep separate from Study Notes</option>
                          {tree.map((node) => (
                            <option key={node.topic.id} value={node.topic.id}>
                              {'\u00A0\u00A0'.repeat(node.depth)}
                              {node.depth > 0 ? '↳ ' : ''}
                              {node.topic.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })()
                ) : (
                  <label className="block text-xs font-semibold text-[var(--mute)]">
                    Deck / Section Name
                    <input
                      type="text"
                      value={topicNameOverride}
                      onChange={(e) => setTopicNameOverride(e.target.value)}
                      placeholder={parsedPreview.suggestedTitle}
                      className="sd-input mt-1 text-sm"
                    />
                  </label>
                )}
              </div>

              {(includeNotes || includeTimeline) &&
                targetSubjectId !== '__new__' &&
                (() => {
                  const subjTopics = workspace.topics.filter(
                    (t) => t.subjectId === targetSubjectId
                  );
                  if (subjTopics.length === 0) return null;
                  const tree = buildTopicTreeList(subjTopics);
                  return (
                    <label className="block text-xs font-semibold text-[var(--mute)]">
                      Place Under Parent Topic (optional — leave as top-level or nest as a sub-topic)
                      <select
                        value={targetParentTopicId}
                        onChange={(e) => setTargetParentTopicId(e.target.value)}
                        className="sd-input mt-1 text-sm"
                      >
                        <option value="">Top-level topic</option>
                        {tree.map((node) => (
                          <option key={node.topic.id} value={node.topic.id}>
                            {'\u00A0\u00A0'.repeat(node.depth)}
                            {node.depth > 0 ? '↳ ' : ''}
                            {node.topic.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })()}

              {(includeNotes || includeTimeline) && targetSubjectId === '__new__' && (
                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Topic Name
                  <input
                    type="text"
                    value={topicNameOverride}
                    onChange={(e) => setTopicNameOverride(e.target.value)}
                    placeholder={parsedPreview.suggestedTitle}
                    className="sd-input mt-1 text-sm"
                  />
                </label>
              )}

              {/* Autoformatter Style & Exact Document Mode Bar */}
              {(includeNotes || includeTimeline) && (
                <div className="space-y-2.5 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3.5">
                  {originalHtml && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ink)]">
                          <FileCheck2 className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                          <span>Default Topic View Mode</span>
                        </div>
                        <p className="text-[11px] text-[var(--mute)]">
                          Choose whether opening this topic displays the exact original document first or auto-formatted revision notes. (Both tabs remain saved!)
                        </p>
                      </div>
                      <div className="sd-seg" role="group" aria-label="Document formatting mode">
                        <button
                          type="button"
                          aria-pressed={preferOriginalFormat}
                          onClick={() => {
                            setPreferOriginalFormat(true);
                            setPreviewNotesMode('original');
                          }}
                          className="sd-seg-btn whitespace-nowrap"
                        >
                          Keep Original Formatting
                        </button>
                        <button
                          type="button"
                          aria-pressed={!preferOriginalFormat}
                          onClick={() => {
                            setPreferOriginalFormat(false);
                            if (previewNotesMode === 'original') {
                              setPreviewNotesMode('visual');
                            }
                          }}
                          className="sd-seg-btn whitespace-nowrap"
                        >
                          Auto-Format Notes
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ink)]">
                      <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                      <span>Autoformatter Style &amp; Structure Controls</span>
                    </div>
                    <div className="sd-seg flex-wrap" role="group" aria-label="Formatting preset">
                      {FORMAT_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          title={p.hint}
                          aria-pressed={formatOptions.preset === p.id}
                          onClick={() =>
                            setFormatOptions((prev) => ({ ...prev, preset: p.id }))
                          }
                          className="sd-seg-btn whitespace-nowrap"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2.5">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--ink)]">
                      <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium">
                        <input
                          type="checkbox"
                          checked={formatOptions.detectFlowDiagrams !== false}
                          onChange={() => toggleFormatFlag('detectFlowDiagrams')}
                          className="accent-[var(--e3)]"
                        />
                        <span>Flow Diagrams (→)</span>
                      </label>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium">
                        <input
                          type="checkbox"
                          checked={formatOptions.autoTables !== false}
                          onChange={() => toggleFormatFlag('autoTables')}
                          className="accent-[var(--e3)]"
                        />
                        <span>Auto-Tables</span>
                      </label>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium">
                        <input
                          type="checkbox"
                          checked={formatOptions.extractKeyTerms !== false}
                          onChange={() => toggleFormatFlag('extractKeyTerms')}
                          className="accent-[var(--e3)]"
                        />
                        <span>Extract Key Terms</span>
                      </label>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium">
                        <input
                          type="checkbox"
                          checked={formatOptions.splitDenseParagraphs !== false}
                          onChange={() => toggleFormatFlag('splitDenseParagraphs')}
                          className="accent-[var(--e3)]"
                        />
                        <span>Split Dense Prose</span>
                      </label>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium">
                        <input
                          type="checkbox"
                          checked={Boolean(formatOptions.strictHeadings)}
                          onChange={() => toggleFormatFlag('strictHeadings')}
                          className="accent-[var(--e3)]"
                        />
                        <span>Strict # Headings</span>
                      </label>
                      <label
                        title="AI identifies Core Theory, Processes, Comparisons, Examples & Risks and verifies distinct colours per section"
                        className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-[var(--ink)]"
                      >
                        <input
                          type="checkbox"
                          checked={colorCodeParts}
                          onChange={handleToggleColorCodeParts}
                          className="accent-[var(--e3)]"
                        />
                        <span>AI Colour-Code Parts</span>
                        <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                          <span className="h-2 w-2 rounded-full bg-[#2563EB]" />
                          <span className="h-2 w-2 rounded-full bg-[#16A34A]" />
                          <span className="h-2 w-2 rounded-full bg-[#7C3AED]" />
                          <span className="h-2 w-2 rounded-full bg-[#D97706]" />
                          <span className="h-2 w-2 rounded-full bg-[#E11D48]" />
                        </span>
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {aiFormattedApplied && (
                        <button
                          type="button"
                          onClick={handleRevertInstantFormat}
                          className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden="true" />
                          <span>Instant Format</span>
                        </button>
                      )}
                      {byokConfig ? (
                        <>
                          <button
                            type="button"
                            disabled={aiFormatting}
                            onClick={() => void handleAiAutoformat(true)}
                            className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap"
                          >
                            {aiFormatting ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            <span className="font-mono-num">
                              {aiFormatting
                                ? `Formatting… ${(aiElapsedMs / 1000).toFixed(1)}s`
                                : aiFormattedApplied
                                ? 'Re-run AI Autoformat'
                                : existingFormatQuality.isGood
                                ? 'Enhance Formatting (Your Key)'
                                : 'AI Autoformat (Your Key)'}
                            </span>
                          </button>
                          {aiFormatting && (
                            <button
                              type="button"
                              onClick={handleCancelAiAutoformat}
                              className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                            >
                              Cancel
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (onOpenApiKeySettings) {
                              onOpenApiKeySettings();
                            } else {
                              setErrorMsg(
                                'Open Account & Data to paste your own Gemini, Grok, or OpenAI-compatible API key.'
                              );
                            }
                          }}
                          className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                        >
                          <KeyRound className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                          <span>Add Your API Key for AI Autoformat</span>
                        </button>
                      )}
                    </div>
                  </div>
                  {aiFormatting && aiProgressText && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--e3)]/40 bg-[var(--bg)] px-3 py-1.5 text-xs text-[var(--ink)]">
                      <span className="truncate font-medium">{aiProgressText}</span>
                      <span className="font-mono-num shrink-0 font-semibold text-[var(--e3)]">
                        {(aiElapsedMs / 1000).toFixed(1)}s
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Pre-Save Split & Entity Preview Box */}
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--e3)]">
                      Pre-Save Preview &amp; Cleanup
                    </div>
                    <div className="font-mono-num mt-0.5 text-xs text-[var(--mute)]">
                      {draftSections.length} sections · {totalDraftPoints} points ·{' '}
                      {parsedPreview.entityStats.tables} tables · {draftKeyTerms.length} terms ·{' '}
                      {draftTimeline.length} timeline events · {draftCards.length} flashcards
                    </div>
                  </div>

                  <div className="sd-seg" role="tablist" aria-label="Preview category">
                    <button
                      type="button"
                      aria-pressed={previewTab === 'notes'}
                      onClick={() => setPreviewTab('notes')}
                      className="sd-seg-btn whitespace-nowrap"
                    >
                      Notes ({draftSections.length})
                    </button>
                    <button
                      type="button"
                      aria-pressed={previewTab === 'timeline'}
                      onClick={() => setPreviewTab('timeline')}
                      className="sd-seg-btn whitespace-nowrap"
                    >
                      Timeline ({draftTimeline.length})
                    </button>
                    <button
                      type="button"
                      aria-pressed={previewTab === 'cards'}
                      onClick={() => setPreviewTab('cards')}
                      className="sd-seg-btn whitespace-nowrap"
                    >
                      Flashcards ({draftCards.length})
                    </button>
                  </div>
                </div>

                {/* Output Toggles */}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--ink)]">
                    <input
                      type="checkbox"
                      checked={includeNotes}
                      onChange={(e) => setIncludeNotes(e.target.checked)}
                      className="accent-[var(--e3)]"
                    />
                    <BookOpen className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                    <span>Save structured notes</span>
                  </label>

                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--ink)]">
                    <input
                      type="checkbox"
                      checked={includeTimeline}
                      onChange={(e) => setIncludeTimeline(e.target.checked)}
                      className="accent-[var(--e2)]"
                    />
                    <Calendar className="h-3.5 w-3.5 text-[var(--e2)]" aria-hidden="true" />
                    <span>Save timeline events ({draftTimeline.length})</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => setIncludeCards((v) => !v)}
                    className={`cursor-pointer inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                      includeCards
                        ? 'border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_12%,var(--card))] text-[var(--ok)]'
                        : 'border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:border-[var(--e3)]'
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {includeCards
                        ? `Import Flashcards Enabled (${draftCards.length})`
                        : `Make Flashcards (${draftCards.length})`}
                    </span>
                  </button>

                  {includeCards && (includeNotes || includeTimeline) && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-[var(--mute)]">
                      <input
                        type="checkbox"
                        checked={linkCardsWithNoteTopic}
                        onChange={(e) => setLinkCardsWithNoteTopic(e.target.checked)}
                        className="accent-[var(--e3)]"
                      />
                      <span>Link flashcards to this Note Topic</span>
                    </label>
                  )}
                </div>

                {/* Preview Tab 1: Original Document OR Visual Pretty Preview OR Editable Structured Sections */}
                {previewTab === 'notes' && (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-[var(--mute)]">
                        {previewNotesMode === 'original'
                          ? 'Exact Original Document Appearance'
                          : previewNotesMode === 'visual'
                          ? 'Structured Note Layout Preview'
                          : 'Line-by-Line Draft Editor'}
                      </span>
                      <div className="sd-seg" role="group" aria-label="Notes preview mode">
                        {originalHtml && (
                          <button
                            type="button"
                            aria-pressed={previewNotesMode === 'original'}
                            onClick={() => setPreviewNotesMode('original')}
                            className="sd-seg-btn whitespace-nowrap"
                          >
                            Original Document
                          </button>
                        )}
                        <button
                          type="button"
                          aria-pressed={previewNotesMode === 'visual'}
                          onClick={() => setPreviewNotesMode('visual')}
                          className="sd-seg-btn whitespace-nowrap"
                        >
                          Visual Preview
                        </button>
                        <button
                          type="button"
                          aria-pressed={previewNotesMode === 'edit'}
                          onClick={() => setPreviewNotesMode('edit')}
                          className="sd-seg-btn whitespace-nowrap"
                        >
                          Edit Lines
                        </button>
                      </div>
                    </div>

                    {previewNotesMode === 'original' && originalHtml ? (
                      <div className="max-h-96 overflow-y-auto rounded-xl border border-[var(--line)]">
                        <div className="sd-doc-canvas">
                          <div
                            className="sd-doc-sheet"
                            dangerouslySetInnerHTML={{ __html: renderDocumentHtmlWithLatex(originalHtml) }}
                          />
                        </div>
                      </div>
                    ) : previewNotesMode === 'visual' ? (
                      <div className="sd-note-scope max-h-96 space-y-6 overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 sm:p-6">
                        {draftSummary.trim() && (
                          <div className="rounded-xl border border-[color-mix(in_srgb,var(--note-accent)_22%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent)_5%,var(--bg))] px-4 py-3.5">
                            <div className="text-xs font-bold text-[var(--note-accent)]">
                              Topic Overview
                            </div>
                            <p className="mt-1 text-[15px] leading-relaxed text-[var(--ink)]">
                              {renderRichInline(draftSummary)}
                            </p>
                          </div>
                        )}

                        {draftSections.map((sec) => {
                          const blocks = groupSectionPoints(sec.points);
                          const secAccent = normalizeNoteColor(sec.accentColor);
                          const roleInfo = sec.partRole ? NOTE_PART_ROLE_MAP[sec.partRole] : undefined;
                          return (
                            <section
                              key={sec.id}
                              data-note-color={secAccent !== 'default' ? secAccent : undefined}
                              className="space-y-3"
                            >
                              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-[color-mix(in_srgb,var(--note-accent)_34%,var(--line))] pb-2">
                                <h4 className="min-w-0 flex-1 font-display text-lg font-extrabold tracking-tight text-[var(--ink)]">
                                  {sec.heading || 'Key Points'}
                                </h4>
                                {roleInfo && (
                                  <span className="shrink-0 whitespace-nowrap text-[11px] font-bold text-[var(--note-accent)]">
                                    {roleInfo.label}
                                  </span>
                                )}
                              </div>
                              {blocks.length > 0 && (
                                <div className="space-y-2.5 text-[15px] leading-relaxed text-[var(--ink)]">
                                  {blocks.map((blk, bi) => {
                                    if (blk.kind === 'subheading') {
                                      return (
                                        <div
                                          key={bi}
                                          className={`font-display text-base font-bold text-[var(--note-accent)] ${
                                            bi > 0 ? 'mt-4 pt-2' : ''
                                          }`}
                                        >
                                          {renderRichInline(blk.text)}
                                        </div>
                                      );
                                    }
                                    if (blk.kind === 'factbox') {
                                      const boxSurface = getTableSurfaceStyles(blk.color);
                                      return (
                                        <div
                                          key={bi}
                                          className="my-2 rounded-xl border border-[color-mix(in_srgb,var(--note-accent)_26%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent)_5%,var(--bg))] px-4 py-3"
                                          style={boxSurface.boxStyle}
                                        >
                                          <div
                                            className="text-xs font-bold text-[var(--note-accent)]"
                                            style={boxSurface.boxTitleStyle}
                                          >
                                            {blk.title || 'Key Fact'}
                                          </div>
                                          <div className="mt-1 text-[14.5px] leading-relaxed">
                                            {renderRichInline(blk.text)}
                                          </div>
                                        </div>
                                      );
                                    }
                                    if (blk.kind === 'table') {
                                      const tblSurface = getTableSurfaceStyles(blk.color);
                                      return (
                                        <div
                                          key={bi}
                                          className="my-3 overflow-x-auto rounded-xl border border-[color-mix(in_srgb,var(--note-accent)_24%,var(--line))] bg-[var(--card)]"
                                          style={tblSurface.wrapperStyle}
                                        >
                                          <table className="w-full border-collapse text-left text-sm">
                                            <thead
                                              className="border-b-2 border-[color-mix(in_srgb,var(--note-accent)_34%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent)_10%,var(--card))]"
                                              style={tblSurface.theadStyle}
                                            >
                                              <tr>
                                                {blk.headers.map((h, hi) => (
                                                  <th key={hi} className="px-3.5 py-2.5 font-bold text-[var(--ink)]">
                                                    {renderRichInline(h)}
                                                  </th>
                                                ))}
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--line)]">
                                              {blk.rows.map((row, ri) => (
                                                <tr
                                                  key={ri}
                                                  className={
                                                    !tblSurface.isCustom && ri % 2 === 1
                                                      ? 'bg-[color-mix(in_srgb,var(--note-accent)_4%,var(--card))]'
                                                      : ''
                                                  }
                                                  style={ri % 2 === 1 ? tblSurface.zebraStyle : undefined}
                                                >
                                                  {row.map((cell, ci) => (
                                                    <td
                                                      key={ci}
                                                      className={`px-3.5 py-2.5 align-top ${
                                                        ci === 0 ? 'font-semibold' : ''
                                                      }`}
                                                      style={ci === 0 ? tblSurface.firstColStyle : undefined}
                                                    >
                                                      {renderRichInline(cell)}
                                                    </td>
                                                  ))}
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      );
                                    }
                                    if (blk.kind === 'flow') {
                                      return (
                                        <FlowchartBlock
                                          key={bi}
                                          compact
                                          label={blk.label}
                                          steps={blk.steps}
                                        />
                                      );
                                    }
                                    if (blk.kind === 'image') {
                                      const widthClass =
                                        blk.width === 'compact'
                                          ? 'max-w-[260px]'
                                          : blk.width === 'medium'
                                          ? 'max-w-[400px]'
                                          : blk.width === 'full'
                                          ? 'w-full'
                                          : 'max-w-[540px]';
                                      return (
                                        <figure key={bi} className={`my-3 ${widthClass}`}>
                                          <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg)] shadow-xs">
                                            <img
                                              src={blk.src}
                                              alt={blk.caption || 'Imported visual'}
                                              loading="lazy"
                                              className="block h-auto max-h-80 w-full object-contain"
                                            />
                                          </div>
                                          {blk.caption && (
                                            <figcaption className="mt-1.5 px-0.5 text-xs italic text-[var(--mute)]">
                                              {blk.caption}
                                            </figcaption>
                                          )}
                                        </figure>
                                      );
                                    }
                                    if (blk.kind === 'paragraph') {
                                      return (
                                        <p key={bi} className="leading-[1.7] text-[var(--ink)]">
                                          {renderRichInline(blk.text)}
                                        </p>
                                      );
                                    }
                                    if (blk.kind === 'math') {
                                      return (
                                        <div key={bi} className="sd-math-card">
                                          {blk.label && (
                                            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                                              {blk.label}
                                            </div>
                                          )}
                                          <div
                                            className="overflow-x-auto text-center"
                                            dangerouslySetInnerHTML={{
                                              __html: renderKatexToHtml(blk.latex, true),
                                            }}
                                          />
                                        </div>
                                      );
                                    }
                                    if (blk.kind === 'code') {
                                      return (
                                        <div key={bi} className="sd-code-card">
                                          {blk.lang && blk.lang !== 'text' && (
                                            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--mute)]">
                                              {blk.lang}
                                            </div>
                                          )}
                                          <pre className="overflow-x-auto font-mono text-[13px] leading-relaxed text-[var(--ink)]">
                                            <code>{blk.code}</code>
                                          </pre>
                                        </div>
                                      );
                                    }
                                    if (blk.kind === 'callout') {
                                      return (
                                        <div
                                          key={bi}
                                          className={`sd-callout-card sd-callout-${blk.type}`}
                                        >
                                          <div className="text-xs font-bold uppercase tracking-wider text-[var(--note-accent)]">
                                            {blk.title || blk.type}
                                          </div>
                                          <div className="mt-1 text-[14.5px] leading-relaxed text-[var(--ink)]">
                                            {renderRichInline(blk.text)}
                                          </div>
                                        </div>
                                      );
                                    }
                                    if (blk.kind === 'divider') {
                                      return (
                                        <hr
                                          key={bi}
                                          className="my-4 border-t border-[var(--line)]"
                                        />
                                      );
                                    }
                                    if (blk.kind === 'ordered') {
                                      return (
                                        <ol key={bi} className="space-y-1.5 pl-1">
                                          {blk.items.map((it, oi) => (
                                            <li
                                              key={oi}
                                              className="flex items-start gap-2.5 leading-[1.68]"
                                            >
                                              <span className="font-mono-num min-w-[20px] shrink-0 font-bold text-[var(--note-accent)]">
                                                {it.num}.
                                              </span>
                                              <span className="min-w-0 flex-1 text-[var(--ink)]">
                                                {renderRichInline(it.text)}
                                              </span>
                                            </li>
                                          ))}
                                        </ol>
                                      );
                                    }
                                    if (blk.kind === 'checklist') {
                                      return (
                                        <ul key={bi} className="space-y-1.5 pl-1">
                                          {blk.items.map((it, ci) => (
                                            <li
                                              key={ci}
                                              className="flex items-start gap-2.5 leading-[1.68]"
                                            >
                                              <span
                                                className={`mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
                                                  it.checked
                                                    ? 'border-[var(--ok)] bg-[var(--ok)] text-white'
                                                    : 'border-[var(--line)] bg-[var(--card)]'
                                                }`}
                                                aria-hidden="true"
                                              >
                                                {it.checked ? '✓' : ''}
                                              </span>
                                              <span
                                                className={
                                                  it.checked
                                                    ? 'text-[var(--mute)] line-through'
                                                    : 'text-[var(--ink)]'
                                                }
                                              >
                                                {renderRichInline(it.text)}
                                              </span>
                                            </li>
                                          ))}
                                        </ul>
                                      );
                                    }
                                    if (blk.kind !== 'bullet') return null;
                                    const isSub = Boolean(blk.indent && blk.indent > 0);
                                    return (
                                      <div
                                        key={bi}
                                        className={`flex items-start gap-2.5 leading-[1.68] ${
                                          isSub ? 'pl-6 text-[var(--mute)]' : 'pl-0.5'
                                        }`}
                                      >
                                        <span
                                          className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                                            isSub
                                              ? 'border-[1.5px] border-[var(--note-accent)] bg-transparent'
                                              : 'bg-[var(--note-accent)]'
                                          }`}
                                          aria-hidden="true"
                                        />
                                        <span className="text-[var(--ink)]">
                                          {renderRichInline(blk.text)}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </section>
                          );
                        })}
                      </div>
                    ) : (
                      <>
                        <label className="block text-[11px] font-semibold text-[var(--mute)]">
                          Topic Overview / Summary
                          <textarea
                            rows={2}
                            value={draftSummary}
                            onChange={(e) => setDraftSummary(e.target.value)}
                            placeholder="Optional 1–2 sentence overview..."
                            className="sd-input mt-1 text-xs"
                          />
                        </label>

                        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                          {draftSections.map((sec, sIdx) => (
                            <div
                              key={sec.id}
                              className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-3"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-mono-num text-xs font-bold text-[var(--e3)]">
                                  {String(sIdx + 1).padStart(2, '0')}.
                                </span>
                                <input
                                  type="text"
                                  value={sec.heading}
                                  onChange={(e) =>
                                    setDraftSections((prev) =>
                                      prev.map((item, idx) =>
                                        idx === sIdx ? { ...item, heading: e.target.value } : item
                                      )
                                    )
                                  }
                                  className="sd-input flex-1 py-1 text-xs font-bold"
                                />
                                <button
                                  type="button"
                                  title="Remove section"
                                  aria-label={`Remove section ${sec.heading}`}
                                  onClick={() =>
                                    setDraftSections((prev) => prev.filter((_, idx) => idx !== sIdx))
                                  }
                                  className="sd-btn h-7 w-7 shrink-0 p-0 text-[var(--mute)] hover:text-[var(--bad)]"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              </div>

                              <div className="mt-2 space-y-1.5">
                                {sec.points.map((pt, pIdx) => {
                                  const imgData = parseNoteImagePoint(pt);
                                  if (imgData) {
                                    return (
                                      <div
                                        key={pIdx}
                                        className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2"
                                      >
                                        <img
                                          src={imgData.src}
                                          alt={imgData.caption || 'Attached image'}
                                          className="h-12 w-16 shrink-0 rounded border border-[var(--line)] bg-[var(--card)] object-contain"
                                        />
                                        <input
                                          type="text"
                                          value={imgData.caption || ''}
                                          onChange={(e) => {
                                            const nextPt = encodeNoteImagePoint({
                                              src: imgData.src,
                                              caption: e.target.value,
                                              width: imgData.width,
                                            });
                                            setDraftSections((prev) =>
                                              prev.map((item, idx) =>
                                                idx === sIdx
                                                  ? {
                                                      ...item,
                                                      points: item.points.map((x, j) =>
                                                        j === pIdx ? nextPt : x
                                                      ),
                                                    }
                                                  : item
                                              )
                                            );
                                          }}
                                          placeholder="Image caption (optional)…"
                                          className="sd-input flex-1 py-1 text-xs"
                                        />
                                        <button
                                          type="button"
                                          title="Remove image"
                                          onClick={() =>
                                            setDraftSections((prev) =>
                                              prev.map((item, idx) =>
                                                idx === sIdx
                                                  ? {
                                                      ...item,
                                                      points: item.points.filter((_, j) => j !== pIdx),
                                                    }
                                                  : item
                                              )
                                            )
                                          }
                                          className="sd-btn h-7 w-7 shrink-0 p-0 text-[var(--mute)] hover:text-[var(--bad)]"
                                        >
                                          <X className="h-3 w-3" aria-hidden="true" />
                                        </button>
                                      </div>
                                    );
                                  }
                                  const isSub = pt.startsWith('↳ ');
                                  return (
                                    <div key={pIdx} className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        title={isSub ? 'Outdent to main point' : 'Indent as sub-point'}
                                        onClick={() =>
                                          setDraftSections((prev) =>
                                            prev.map((item, idx) =>
                                              idx === sIdx
                                                ? {
                                                    ...item,
                                                    points: item.points.map((x, j) =>
                                                      j === pIdx
                                                        ? x.startsWith('↳ ')
                                                          ? x.slice(2)
                                                          : `↳ ${x}`
                                                        : x
                                                    ),
                                                  }
                                                : item
                                            )
                                          )
                                        }
                                        className={`sd-btn h-7 w-7 shrink-0 p-0 ${
                                          isSub ? 'border-[var(--e3)] text-[var(--e3)]' : 'text-[var(--mute)]'
                                        }`}
                                      >
                                        <Indent className="h-3 w-3" aria-hidden="true" />
                                      </button>
                                      <input
                                        type="text"
                                        value={pt}
                                        onChange={(e) =>
                                          setDraftSections((prev) =>
                                            prev.map((item, idx) =>
                                              idx === sIdx
                                                ? {
                                                    ...item,
                                                    points: item.points.map((x, j) =>
                                                      j === pIdx ? e.target.value : x
                                                    ),
                                                  }
                                                : item
                                            )
                                          )
                                        }
                                        className="sd-input flex-1 py-1 text-xs"
                                      />
                                      <button
                                        type="button"
                                        title="Delete point"
                                        onClick={() =>
                                          setDraftSections((prev) =>
                                            prev.map((item, idx) =>
                                              idx === sIdx
                                                ? {
                                                    ...item,
                                                    points: item.points.filter((_, j) => j !== pIdx),
                                                  }
                                                : item
                                            )
                                          )
                                        }
                                        className="sd-btn h-7 w-7 shrink-0 p-0 text-[var(--mute)] hover:text-[var(--bad)]"
                                      >
                                        <X className="h-3 w-3" aria-hidden="true" />
                                      </button>
                                    </div>
                                  );
                                })}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraftSections((prev) =>
                                      prev.map((item, idx) =>
                                        idx === sIdx ? { ...item, points: [...item.points, ''] } : item
                                      )
                                    )
                                  }
                                  className="cursor-pointer inline-flex items-center gap-1 pt-1 text-[11px] font-semibold text-[var(--e3)] hover:underline"
                                >
                                  <Plus className="h-3 w-3" aria-hidden="true" />
                                  <span>Add point</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDraftSections((prev) => [
                            ...prev,
                            { id: makeNoteId('sec'), heading: 'New Section', points: [''] },
                          ])
                        }
                        className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Add Section</span>
                      </button>
                    </div>

                    {(draftExamTip || draftWorkedExample) && (
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        <label className="block text-[11px] font-semibold text-[var(--mute)]">
                          Examiner Tip
                          <input
                            type="text"
                            value={draftExamTip}
                            onChange={(e) => setDraftExamTip(e.target.value)}
                            className="sd-input mt-1 text-xs"
                          />
                        </label>
                        <label className="block text-[11px] font-semibold text-[var(--mute)]">
                          Worked Example
                          <input
                            type="text"
                            value={draftWorkedExample}
                            onChange={(e) => setDraftWorkedExample(e.target.value)}
                            className="sd-input mt-1 text-xs"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {/* Preview Tab 2: Editable Extracted Timeline Events */}
                {previewTab === 'timeline' && (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-[var(--mute)]">
                        Auto-detected dates and turning points from your notes. Edit or remove
                        false positives before saving.
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {draftTimeline.length > 0 && (
                          <button
                            type="button"
                            onClick={convertTimelineToCards}
                            className="sd-btn px-2.5 py-1 text-xs whitespace-nowrap"
                          >
                            <Layers className="h-3 w-3 text-[var(--ok)]" aria-hidden="true" />
                            <span>+ Make Cards from Dates</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setIncludeTimeline(true);
                            setDraftTimeline((prev) => [
                              ...prev,
                              { id: makeNoteId('ev'), date: '', title: '', detail: '' },
                            ]);
                          }}
                          className="sd-btn px-2.5 py-1 text-xs whitespace-nowrap"
                        >
                          <Plus className="h-3 w-3" aria-hidden="true" />
                          <span>Add Event</span>
                        </button>
                      </div>
                    </div>

                    {draftTimeline.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--card)] p-4 text-center text-xs text-[var(--mute)]">
                        No historical dates detected in this text. Click &ldquo;Add Event&rdquo; to
                        add timeline nodes manually.
                      </div>
                    ) : (
                      <div className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
                        {draftTimeline.map((ev, idx) => (
                          <div
                            key={ev.id}
                            className="space-y-2 rounded-lg border border-[var(--line)] bg-[var(--card)] p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                value={ev.date}
                                onChange={(e) =>
                                  setDraftTimeline((prev) =>
                                    prev.map((item, j) =>
                                      j === idx ? { ...item, date: e.target.value } : item
                                    )
                                  )
                                }
                                placeholder="Date (e.g. Oct 1929)"
                                className="sd-input font-mono-num w-32 py-1 text-xs font-bold"
                              />
                              <input
                                type="text"
                                value={ev.title}
                                onChange={(e) =>
                                  setDraftTimeline((prev) =>
                                    prev.map((item, j) =>
                                      j === idx ? { ...item, title: e.target.value } : item
                                    )
                                  )
                                }
                                placeholder="Event Title"
                                className="sd-input min-w-[160px] flex-1 py-1 text-xs font-semibold"
                              />
                              <input
                                type="text"
                                value={ev.era || ''}
                                onChange={(e) =>
                                  setDraftTimeline((prev) =>
                                    prev.map((item, j) =>
                                      j === idx ? { ...item, era: e.target.value } : item
                                    )
                                  )
                                }
                                placeholder="Era / Theme"
                                className="sd-input w-36 py-1 text-xs"
                              />
                              <button
                                type="button"
                                title="Toggle Key Turning Point"
                                onClick={() =>
                                  setDraftTimeline((prev) =>
                                    prev.map((item, j) =>
                                      j === idx ? { ...item, keyEvent: !item.keyEvent } : item
                                    )
                                  )
                                }
                                className={`sd-btn h-7 w-7 shrink-0 p-0 ${
                                  ev.keyEvent ? 'border-[var(--e2)] text-[var(--e2)]' : 'text-[var(--mute)]'
                                }`}
                              >
                                <Star className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                title="Remove timeline node"
                                onClick={() =>
                                  setDraftTimeline((prev) => prev.filter((_, j) => j !== idx))
                                }
                                className="sd-btn h-7 w-7 shrink-0 p-0 text-[var(--mute)] hover:text-[var(--bad)]"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <input
                                type="text"
                                value={ev.detail}
                                onChange={(e) =>
                                  setDraftTimeline((prev) =>
                                    prev.map((item, j) =>
                                      j === idx ? { ...item, detail: e.target.value } : item
                                    )
                                  )
                                }
                                placeholder="What happened..."
                                className="sd-input py-1 text-xs"
                              />
                              <input
                                type="text"
                                value={ev.significance || ''}
                                onChange={(e) =>
                                  setDraftTimeline((prev) =>
                                    prev.map((item, j) =>
                                      j === idx ? { ...item, significance: e.target.value } : item
                                    )
                                  )
                                }
                                placeholder="Significance / impact (optional)"
                                className="sd-input py-1 text-xs"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Preview Tab 3: Editable Extracted Flashcards */}
                {previewTab === 'cards' && (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-[var(--mute)]">
                        {!includeCards
                          ? 'Click "Make Flashcards" above if you want to save these cards too.'
                          : !includeNotes && !includeTimeline
                          ? `Saving into Flashcards under "${effectiveTopicName}" (no Study Notes page created${linkToTopicId ? ', linked to chosen topic' : ', kept separate from Study Notes'}).`
                          : linkCardsWithNoteTopic
                          ? `Saving into Flashcards and linked to "${effectiveTopicName}" in Study Notes.`
                          : `Saving into Flashcards under "${effectiveTopicName}" (kept separate from Study Notes).`}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setIncludeCards(true);
                          setDraftCards((prev) => [
                            ...prev,
                            { id: makeNoteId('fc'), q: '', a: '', sectionName: effectiveTopicName },
                          ]);
                        }}
                        className="sd-btn px-2.5 py-1 text-xs whitespace-nowrap"
                      >
                        <Plus className="h-3 w-3" aria-hidden="true" />
                        <span>Add Card</span>
                      </button>
                    </div>

                    {draftCards.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--card)] p-4 text-center text-xs text-[var(--mute)]">
                        No definition or Q/A pairs extracted automatically. Click &ldquo;Add
                        Card&rdquo; to create cards manually.
                      </div>
                    ) : (
                      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                        {draftCards.map((c, idx) => (
                          <div
                            key={c.id}
                            className="grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--card)] p-2.5 sm:grid-cols-[1fr_1fr_140px_auto]"
                          >
                            <input
                              type="text"
                              value={c.q}
                              onChange={(e) =>
                                setDraftCards((prev) =>
                                  prev.map((item, j) =>
                                    j === idx ? { ...item, q: e.target.value } : item
                                  )
                                )
                              }
                              placeholder="Question / Term"
                              className="sd-input py-1 text-xs font-semibold"
                            />
                            <input
                              type="text"
                              value={c.a}
                              onChange={(e) =>
                                setDraftCards((prev) =>
                                  prev.map((item, j) =>
                                    j === idx ? { ...item, a: e.target.value } : item
                                  )
                                )
                              }
                              placeholder="Answer / Definition"
                              className="sd-input py-1 text-xs"
                            />
                            <input
                              type="text"
                              value={c.sectionName}
                              onChange={(e) =>
                                setDraftCards((prev) =>
                                  prev.map((item, j) =>
                                    j === idx ? { ...item, sectionName: e.target.value } : item
                                  )
                                )
                              }
                              placeholder="Section"
                              className="sd-input py-1 text-xs"
                            />
                            <button
                              type="button"
                              title="Remove card"
                              onClick={() =>
                                setDraftCards((prev) => prev.filter((_, j) => j !== idx))
                              }
                              className="sd-btn h-7 w-7 shrink-0 p-0 text-[var(--mute)] hover:text-[var(--bad)]"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-3.5">
          <button type="button" onClick={onClose} className="sd-btn px-4 py-2 text-xs">
            Cancel
          </button>
          {backupBundle ? (
            <button
              type="button"
              onClick={handleConfirmBackupAll}
              className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Import Full Backup</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={!parsedPreview || (!includeNotes && !includeCards && !includeTimeline)}
              onClick={handleConfirmImport}
              className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {!includeNotes && !includeTimeline && includeCards
                  ? `Import ${draftCards.filter((c) => c.q.trim() && c.a.trim()).length} Flashcards`
                  : 'Import into Workspace'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

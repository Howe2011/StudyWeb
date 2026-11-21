import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Bold,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  CornerDownRight,
  Edit3,
  Eraser,
  Eye,
  EyeOff,
  FileCheck2,
  FolderPlus,
  GitBranch,
  Globe,
  GripVertical,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Layers,
  List,
  ListOrdered,
  ListPlus,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Quote,
  Redo2,
  Search,
  Share2,
  Star,
  Table2,
  Trash2,
  Underline,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { sanitizeDocumentHtml } from '../lib/documentRenderer';
import {
  getTableSurfaceStyles,
  NOTE_HIGHLIGHT_COLORS,
  NOTE_SURFACE_COLORS,
  NOTE_TEXT_COLORS,
  renderRichInline,
  resolveSurfaceAccentHex,
} from '../lib/inlineRichText';
import {
  applyVerifiedPartColors,
  NOTE_COLOR_OPTIONS,
  NOTE_PART_ROLE_MAP,
  normalizeNoteColor,
  stripSectionPartColors,
} from '../lib/noteColors';
import {
  createEmptyStructuredNote,
  estimateNoteReadingMinutes,
  groupSectionPoints,
  legacyHtmlToStructuredNote,
} from '../lib/noteFormat';
import { parseBulkTimelineNodes } from '../lib/smartImporter';
import { FlowchartBlock } from './FlowchartBlock';
import {
  buildTopicTreeList,
  deleteTopicPromotingChildren,
  getTopicDescendantIds,
  makeId,
  moveTopicInList,
  TopicDropPosition,
} from '../lib/workspaceStore';
import {
  NoteAccentColor,
  StructuredNoteData,
  StudyFlashcard,
  StudyTopic,
  TimelineEventItem,
  WorkspaceData,
  WorkspaceTab,
} from '../types';
import { NotionTopicEditor } from './NotionTopicEditor';

interface NotesStudioViewProps {
  workspace: WorkspaceData;
  selectedSubjectId: string;
  initialTopicId?: string | null;
  onSelectSubjectId: (id: string) => void;
  onUpdateWorkspace: (updater: (prev: WorkspaceData) => WorkspaceData) => void;
  onOpenImport: () => void;
  onShareTopic: (subjectId: string, topicId: string) => void;
  onBrowseCommunityNotes?: () => void;
  onNavigate: (tab: WorkspaceTab) => void;
}

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function parseChronologicalWeight(rawDate: string): number {
  const s = String(rawDate || '').trim().toLowerCase();
  const bceMatch = s.match(/(\d{1,5})\s*(?:bce|bc)\b/i);
  if (bceMatch) {
    return -Number(bceMatch[1]) * 100;
  }
  const yearMatch = s.match(/\b(\d{3,4})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : 99999;
  let month = 0;
  for (const [mKey, mVal] of Object.entries(MONTH_MAP)) {
    if (s.includes(mKey)) {
      month = mVal;
      break;
    }
  }
  return year * 100 + month;
}

function cleanSectionTitle(heading: string): {
  title: string;
  isCaseStudy: boolean;
  contextTag?: string;
} {
  let raw = String(heading || '').trim();
  let contextTag: string | undefined;
  const tagMatch = raw.match(/\s*\[([A-Za-z0-9 /&-]{2,14})\]\s*$/);
  if (tagMatch) {
    contextTag = tagMatch[1].trim();
    raw = raw.slice(0, raw.length - tagMatch[0].length).trim();
  }
  const isCaseStudy = /^case\s+study\b/i.test(raw);
  if (isCaseStudy) {
    raw = raw.replace(/^case\s+study\s*[–—:-]?\s*/i, '').trim() || raw;
  }
  return { title: raw || 'Key Points', isCaseStudy, contextTag };
}

function splitTermBullet(text: string): { term: string; body: string } | null {
  const boldMatch = text.match(/^\*\*(.+?)\*\*:\s*(.+)$/);
  if (boldMatch && boldMatch[1].length <= 80) {
    return { term: boldMatch[1].trim(), body: boldMatch[2].trim() };
  }
  const plainMatch = text.match(/^([A-Za-z0-9 ()/%'’&-]{2,52}):\s+(.{6,})$/);
  if (plainMatch && !/^http/i.test(plainMatch[1])) {
    return { term: plainMatch[1].trim(), body: plainMatch[2].trim() };
  }
  return null;
}

function splitEventDetailAndSignificance(ev: TimelineEventItem): {
  what: string;
  why: string;
} {
  if (ev.significance && ev.significance.trim()) {
    return { what: ev.detail.trim(), why: ev.significance.trim() };
  }
  const idx = ev.detail.indexOf(' — ');
  if (idx > 0) {
    return {
      what: ev.detail.slice(0, idx).trim(),
      why: ev.detail.slice(idx + 3).trim(),
    };
  }
  return { what: ev.detail.trim(), why: '' };
}

const TIMELINE_ERA_PALETTE = [
  '#2F5F8A',
  '#7C3AED',
  '#0F766E',
  '#B45309',
  '#BE185D',
  '#1D4ED8',
  '#15803D',
  '#C2410C',
] as const;

function getTimelineEraColor(era: string | undefined, allEras: string[]): string | null {
  const clean = (era || '').trim();
  if (!clean) return null;
  const idx = allEras.indexOf(clean);
  if (idx >= 0) return TIMELINE_ERA_PALETTE[idx % TIMELINE_ERA_PALETTE.length];
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  }
  return TIMELINE_ERA_PALETTE[hash % TIMELINE_ERA_PALETTE.length];
}

export function NotesStudioView({
  workspace,
  selectedSubjectId,
  initialTopicId,
  onSelectSubjectId,
  onUpdateWorkspace,
  onOpenImport,
  onShareTopic,
  onBrowseCommunityNotes,
  onNavigate,
}: NotesStudioViewProps) {
  const activeSubject = useMemo(
    () =>
      workspace.subjects.find((s) => s.id === selectedSubjectId) ||
      workspace.subjects[0] ||
      null,
    [workspace.subjects, selectedSubjectId]
  );

  const subjectTopics = useMemo(
    () =>
      activeSubject
        ? workspace.topics.filter((t) => t.subjectId === activeSubject.id)
        : [],
    [workspace.topics, activeSubject]
  );

  const topicTreeNodes = useMemo(
    () => buildTopicTreeList(subjectTopics),
    [subjectTopics]
  );

  const isHistorySubject = Boolean(
    activeSubject && /\bhistory\b/i.test(activeSubject.name.trim())
  );

  const [sidebarCompressed, setSidebarCompressed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('studydeck_notes_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });

  const [selectedTopicId, setSelectedTopicId] = useState<string>(initialTopicId || '');
  const [viewMode, setViewMode] = useState<'read' | 'edit' | 'timeline'>('read');
  const [docZoom, setDocZoom] = useState<number>(100);
  const [editingDocHtml, setEditingDocHtml] = useState(false);
  const docEditorRef = useRef<HTMLDivElement | null>(null);
  const prevTopicIdRef = useRef<string | null>(null);
  const [newTopicName, setNewTopicName] = useState('');
  const [addingTopic, setAddingTopic] = useState(false);
  const [addingParentTopicId, setAddingParentTopicId] = useState<string | null>(null);
  const [collapsedTopicIds, setCollapsedTopicIds] = useState<Set<string>>(() => new Set());
  const [draggedTopicId, setDraggedTopicId] = useState<string | null>(null);
  const [topicDropTarget, setTopicDropTarget] = useState<{
    targetId: string | 'root-end';
    position: TopicDropPosition;
  } | null>(null);
  const [confirmDeleteTopicId, setConfirmDeleteTopicId] = useState<string | null>(null);
  const [cardsFeedback, setCardsFeedback] = useState<string | null>(null);
  const [glossaryExpanded, setGlossaryExpanded] = useState(false);
  const [glossaryFilter, setGlossaryFilter] = useState('');
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [docTextColorOpen, setDocTextColorOpen] = useState(false);
  const [docHighlightOpen, setDocHighlightOpen] = useState(false);
  const activeDocTableRef = useRef<HTMLTableElement | null>(null);
  const colorMenuRef = useRef<HTMLDivElement | null>(null);
  const docTextColorRef = useRef<HTMLDivElement | null>(null);
  const docHighlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!colorMenuOpen && !docTextColorOpen && !docHighlightOpen) return;
    const onDown = (e: MouseEvent) => {
      if (colorMenuRef.current && !colorMenuRef.current.contains(e.target as Node)) {
        setColorMenuOpen(false);
      }
      if (docTextColorRef.current && !docTextColorRef.current.contains(e.target as Node)) {
        setDocTextColorOpen(false);
      }
      if (docHighlightRef.current && !docHighlightRef.current.contains(e.target as Node)) {
        setDocHighlightOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setColorMenuOpen(false);
        setDocTextColorOpen(false);
        setDocHighlightOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [colorMenuOpen, docTextColorOpen, docHighlightOpen]);

  // History Timeline state
  const [hideTimelineDates, setHideTimelineDates] = useState(false);
  const [hideTimelineEvents, setHideTimelineEvents] = useState(false);
  const [revealedDateIds, setRevealedDateIds] = useState<Set<string>>(new Set());
  const [revealedEventBodyIds, setRevealedEventBodyIds] = useState<Set<string>>(new Set());
  const [colorTimelineEras, setColorTimelineEras] = useState(false);
  const [timelineEditAll, setTimelineEditAll] = useState(false);
  const [expandedActionEventId, setExpandedActionEventId] = useState<string | null>(null);
  const [timelineEraFilter, setTimelineEraFilter] = useState<string>('ALL');
  const [timelineSearch, setTimelineSearch] = useState('');
  const [timelineKeyOnly, setTimelineKeyOnly] = useState(false);
  const [addEventOpen, setAddEventOpen] = useState(false);
  const [tlDate, setTlDate] = useState('');
  const [tlTitle, setTlTitle] = useState('');
  const [tlDetail, setTlDetail] = useState('');
  const [tlSignificance, setTlSignificance] = useState('');
  const [tlEra, setTlEra] = useState('');
  const [tlKeyEvent, setTlKeyEvent] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editEvDate, setEditEvDate] = useState('');
  const [editEvTitle, setEditEvTitle] = useState('');
  const [editEvDetail, setEditEvDetail] = useState('');
  const [editEvSignificance, setEditEvSignificance] = useState('');
  const [editEvEra, setEditEvEra] = useState('');
  const [editEvKeyEvent, setEditEvKeyEvent] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkAutoSort, setBulkAutoSort] = useState(true);
  const [bulkFeedback, setBulkFeedback] = useState<string | null>(null);

  const parsedBulkNodes = useMemo(() => parseBulkTimelineNodes(bulkText), [bulkText]);

  const toggleSidebarCompressed = () => {
    setSidebarCompressed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('studydeck_notes_sidebar_collapsed', next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  useEffect(() => {
    if (initialTopicId) {
      const target = subjectTopics.find((t) => t.id === initialTopicId);
      if (target) {
        setSelectedTopicId(initialTopicId);
        setViewMode('read');
      }
    }
  }, [initialTopicId, subjectTopics]);

  useEffect(() => {
    if (activeSubject && activeSubject.id !== selectedSubjectId) {
      onSelectSubjectId(activeSubject.id);
    }
  }, [activeSubject, selectedSubjectId, onSelectSubjectId]);

  const activeTopic = useMemo(() => {
    if (!topicTreeNodes.length) return null;
    return (
      topicTreeNodes.find((n) => n.topic.id === selectedTopicId)?.topic ||
      topicTreeNodes[0].topic
    );
  }, [topicTreeNodes, selectedTopicId]);

  const activeTreeNode = useMemo(() => {
    if (!activeTopic) return null;
    return topicTreeNodes.find((n) => n.topic.id === activeTopic.id) || null;
  }, [topicTreeNodes, activeTopic]);

  const directChildTopics = useMemo(() => {
    if (!activeTopic) return [];
    return subjectTopics.filter((t) => t.parentTopicId === activeTopic.id);
  }, [subjectTopics, activeTopic]);

  const siblingTopics = useMemo(() => {
    if (!activeTopic) return [];
    const pid = activeTopic.parentTopicId || '';
    return subjectTopics.filter((t) => (t.parentTopicId || '') === pid);
  }, [subjectTopics, activeTopic]);

  const parentTopicOptionsForEditor = useMemo(() => {
    if (!activeTopic) return [];
    const excluded = getTopicDescendantIds(subjectTopics, activeTopic.id);
    excluded.add(activeTopic.id);
    return topicTreeNodes
      .filter((n) => !excluded.has(n.topic.id))
      .map((n) => ({
        id: n.topic.id,
        label: `${'\u00A0\u00A0'.repeat(n.depth)}${n.depth > 0 ? '↳ ' : ''}${n.topic.name}`,
      }));
  }, [activeTopic, subjectTopics, topicTreeNodes]);

  const activeDocHtml = useMemo(() => {
    if (!activeTopic) return '';
    return (activeTopic.notes.originalHtml || activeTopic.notes.legacyHtml || '').trim();
  }, [activeTopic]);

  const hasDocHtml = activeDocHtml.length > 0;
  const isPdfPageDoc = hasDocHtml && activeDocHtml.includes('sd-pdf-page');

  useEffect(() => {
    if (activeTopic && activeTopic.id !== selectedTopicId) {
      setSelectedTopicId(activeTopic.id);
    }
    if (activeTreeNode && activeTreeNode.ancestors.length > 0) {
      setCollapsedTopicIds((prev) => {
        const needsExpand = activeTreeNode.ancestors.some((a) => prev.has(a.id));
        if (!needsExpand) return prev;
        const next = new Set(prev);
        for (const a of activeTreeNode.ancestors) next.delete(a.id);
        return next;
      });
    }

    const activeId = activeTopic?.id || null;
    if (activeId !== prevTopicIdRef.current) {
      prevTopicIdRef.current = activeId;
      setCardsFeedback(null);
      setConfirmDeleteTopicId(null);
      setEditingDocHtml(false);
      setEditingEventId(null);
      setExpandedActionEventId(null);
      setRevealedDateIds(new Set());
      setRevealedEventBodyIds(new Set());
      setTimelineEraFilter('ALL');
      setTimelineSearch('');
      setTimelineKeyOnly(false);
      setGlossaryFilter('');
      setColorMenuOpen(false);
      setGlossaryExpanded((activeTopic?.notes.keyTerms.length || 0) <= 8);
    }

    if (viewMode === 'timeline' && !isHistorySubject) {
      setViewMode('read');
    }
  }, [activeTopic, activeTreeNode, isHistorySubject, selectedTopicId, viewMode]);

  useEffect(() => {
    if (editingDocHtml && docEditorRef.current) {
      docEditorRef.current.innerHTML = activeDocHtml;
    }
    // Intentionally initialize contentEditable DOM only when entering edit mode or switching topic
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingDocHtml, activeTopic?.id]);

  const commitDocumentHtmlEdit = (finishEditing = false) => {
    if (!activeTopic || !docEditorRef.current) return;
    const cleaned = sanitizeDocumentHtml(docEditorRef.current.innerHTML);
    if (cleaned) {
      replaceActiveNote({
        ...activeTopic.notes,
        originalHtml: cleaned,
        preferOriginalFormat: true,
      });
    }
    if (finishEditing) {
      setEditingDocHtml(false);
    }
  };

  const switchTopicDefaultView = (mode: 'notes' | 'document') => {
    if (!activeTopic) return;
    if (mode === 'notes') {
      let nextNote = activeTopic.notes;
      if (editingDocHtml && docEditorRef.current) {
        const cleaned = sanitizeDocumentHtml(docEditorRef.current.innerHTML);
        if (cleaned) {
          nextNote = { ...nextNote, originalHtml: cleaned };
        }
      }
      setEditingDocHtml(false);
      replaceActiveNote({
        ...nextNote,
        preferOriginalFormat: false,
      });
    } else {
      if (viewMode === 'edit') {
        setViewMode('read');
      }
      replaceActiveNote({
        ...activeTopic.notes,
        preferOriginalFormat: true,
      });
    }
  };

  const handleExtractStructuredFromDoc = () => {
    if (!activeTopic || !activeDocHtml) return;
    const extracted = legacyHtmlToStructuredNote(activeDocHtml);
    replaceActiveNote({
      ...activeTopic.notes,
      summary: activeTopic.notes.summary.trim() || extracted.summary,
      sections: extracted.sections.some((s) => s.points.length > 0)
        ? extracted.sections
        : activeTopic.notes.sections,
      keyTerms:
        activeTopic.notes.keyTerms.length > 0
          ? activeTopic.notes.keyTerms
          : extracted.keyTerms,
      examTip: activeTopic.notes.examTip.trim() || extracted.examTip,
      workedExample: activeTopic.notes.workedExample.trim() || extracted.workedExample,
      preferOriginalFormat: false,
    });
  };

  const execDocCommand = (cmd: string, value?: string) => {
    if (!docEditorRef.current) return;
    docEditorRef.current.focus();
    try {
      if (cmd === 'foreColor' || cmd === 'hiliteColor') {
        document.execCommand('styleWithCSS', false, 'true');
      }
      document.execCommand(cmd, false, value);
    } catch {
      if (cmd === 'hiliteColor') {
        try {
          document.execCommand('backColor', false, value);
        } catch {
          // ignore
        }
      }
    }
  };

  const trackActiveDocTable = () => {
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    const el = anchor instanceof Element ? anchor : anchor?.parentElement;
    const tbl = el?.closest('table') || null;
    if (tbl && docEditorRef.current?.contains(tbl)) {
      activeDocTableRef.current = tbl as HTMLTableElement;
    }
  };

  const insertDocSnippet = (html: string, focusTable = false) => {
    if (!docEditorRef.current) return;
    docEditorRef.current.focus();
    try {
      document.execCommand('insertHTML', false, html);
    } catch {
      docEditorRef.current.insertAdjacentHTML('beforeend', html);
    }
    if (focusTable) {
      const tables = docEditorRef.current.querySelectorAll('table');
      if (tables.length > 0) {
        activeDocTableRef.current = tables[tables.length - 1] as HTMLTableElement;
      }
    }
    commitDocumentHtmlEdit(false);
  };

  const applyDocTableColor = (colorId: string) => {
    if (!docEditorRef.current) return;
    trackActiveDocTable();
    const targetTable =
      activeDocTableRef.current && docEditorRef.current.contains(activeDocTableRef.current)
        ? activeDocTableRef.current
        : (docEditorRef.current.querySelector('table') as HTMLTableElement | null);
    if (!targetTable) return;
    activeDocTableRef.current = targetTable;

    const hex = resolveSurfaceAccentHex(colorId);
    if (!hex) {
      targetTable.style.borderColor = '';
      targetTable.querySelectorAll('th').forEach((th) => {
        (th as HTMLElement).style.backgroundColor = '';
        (th as HTMLElement).style.borderColor = '';
      });
      targetTable.querySelectorAll('td').forEach((td) => {
        (td as HTMLElement).style.borderColor = '';
      });
    } else {
      targetTable.style.borderColor = `color-mix(in srgb, ${hex} 40%, var(--line))`;
      targetTable.querySelectorAll('th').forEach((th) => {
        (th as HTMLElement).style.backgroundColor = `color-mix(in srgb, ${hex} 18%, var(--card))`;
        (th as HTMLElement).style.borderColor = `color-mix(in srgb, ${hex} 34%, var(--line))`;
      });
      targetTable.querySelectorAll('td').forEach((td) => {
        (td as HTMLElement).style.borderColor = `color-mix(in srgb, ${hex} 26%, var(--line))`;
      });
    }
    commitDocumentHtmlEdit(false);
  };

  const addDocTableRow = () => {
    if (!docEditorRef.current) return;
    trackActiveDocTable();
    const tbl =
      activeDocTableRef.current && docEditorRef.current.contains(activeDocTableRef.current)
        ? activeDocTableRef.current
        : (docEditorRef.current.querySelector('table') as HTMLTableElement | null);
    if (!tbl) return;
    const cols = Math.max(1, tbl.rows[0]?.cells.length || 2);
    const tbody = tbl.tBodies[0] || tbl;
    const tr = document.createElement('tr');
    for (let c = 0; c < cols; c++) {
      const td = document.createElement('td');
      td.innerHTML = '&nbsp;';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
    commitDocumentHtmlEdit(false);
  };

  const addDocTableCol = () => {
    if (!docEditorRef.current) return;
    trackActiveDocTable();
    const tbl =
      activeDocTableRef.current && docEditorRef.current.contains(activeDocTableRef.current)
        ? activeDocTableRef.current
        : (docEditorRef.current.querySelector('table') as HTMLTableElement | null);
    if (!tbl) return;
    Array.from(tbl.rows).forEach((row, idx) => {
      const cell = document.createElement(idx === 0 && row.querySelector('th') ? 'th' : 'td');
      cell.innerHTML = idx === 0 ? 'Column' : '&nbsp;';
      row.appendChild(cell);
    });
    commitDocumentHtmlEdit(false);
  };

  const updateTopic = (topicId: string, updater: (t: StudyTopic) => StudyTopic) => {
    onUpdateWorkspace((prev) => ({
      ...prev,
      topics: prev.topics.map((t) => (t.id === topicId ? updater(t) : t)),
      updatedAt: new Date().toISOString(),
    }));
  };

  const replaceActiveNote = (nextNotes: StructuredNoteData) => {
    if (!activeTopic) return;
    updateTopic(activeTopic.id, (t) => ({
      ...t,
      notes: {
        ...nextNotes,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  const toggleTopicCollapsed = (topicId: string) => {
    setCollapsedTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  };

  const canDropTopicOn = (dragId: string, targetId: string): boolean => {
    if (dragId === targetId) return false;
    return !getTopicDescendantIds(subjectTopics, dragId).has(targetId);
  };

  const handleDropTopic = (targetId: string | null, position: TopicDropPosition) => {
    if (!activeSubject || !draggedTopicId) {
      setDraggedTopicId(null);
      setTopicDropTarget(null);
      return;
    }
    const dragId = draggedTopicId;
    setDraggedTopicId(null);
    setTopicDropTarget(null);
    if (targetId && !canDropTopicOn(dragId, targetId)) return;

    onUpdateWorkspace((prev) => ({
      ...prev,
      topics: moveTopicInList(prev.topics, activeSubject.id, dragId, targetId, position),
      updatedAt: new Date().toISOString(),
    }));

    if (position === 'inside' && targetId) {
      setCollapsedTopicIds((prev) => {
        if (!prev.has(targetId)) return prev;
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
    }
  };

  const startAddingTopic = (parentId: string | null) => {
    if (sidebarCompressed) {
      setSidebarCompressed(false);
      try {
        localStorage.setItem('studydeck_notes_sidebar_collapsed', '0');
      } catch {
        // ignore
      }
    }
    if (parentId) {
      setCollapsedTopicIds((prev) => {
        if (!prev.has(parentId)) return prev;
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
    }
    setAddingParentTopicId(parentId);
    setNewTopicName('');
    setAddingTopic(true);
  };

  const handleAddTopic = (e: FormEvent) => {
    e.preventDefault();
    if (!activeSubject || !newTopicName.trim()) return;
    const validParentId =
      addingParentTopicId &&
      subjectTopics.some((t) => t.id === addingParentTopicId)
        ? addingParentTopicId
        : undefined;
    const created: StudyTopic = {
      id: makeId('top'),
      subjectId: activeSubject.id,
      ...(validParentId ? { parentTopicId: validParentId } : {}),
      name: newTopicName.trim(),
      completed: false,
      notes: createEmptyStructuredNote(),
      createdAt: new Date().toISOString(),
    };
    onUpdateWorkspace((prev) => ({
      ...prev,
      topics: [...prev.topics, created],
      updatedAt: new Date().toISOString(),
    }));
    if (validParentId) {
      setCollapsedTopicIds((prev) => {
        if (!prev.has(validParentId)) return prev;
        const next = new Set(prev);
        next.delete(validParentId);
        return next;
      });
    }
    setSelectedTopicId(created.id);
    setNewTopicName('');
    setAddingParentTopicId(null);
    setAddingTopic(false);
    setViewMode('edit');
  };

  const handleDeleteTopic = (topicId: string) => {
    const idx = topicTreeNodes.findIndex((n) => n.topic.id === topicId);
    const nextFallback =
      topicTreeNodes[idx + 1]?.topic.id ||
      topicTreeNodes[idx - 1]?.topic.id ||
      '';
    onUpdateWorkspace((prev) => ({
      ...prev,
      topics: deleteTopicPromotingChildren(prev.topics, topicId),
      flashcards: prev.flashcards.filter((c) => c.topicId !== topicId),
      updatedAt: new Date().toISOString(),
    }));
    setConfirmDeleteTopicId(null);
    if (selectedTopicId === topicId) {
      setSelectedTopicId(nextFallback);
    }
  };

  const handleMakeFlashcardsFromTerms = () => {
    if (!activeSubject || !activeTopic) return;
    const validTerms = activeTopic.notes.keyTerms.filter(
      (k) => k.term.trim() && k.definition.trim()
    );
    if (!validTerms.length) {
      setCardsFeedback('Add key terms (Term & Definition blocks) first before making flashcards.');
      return;
    }

    let createdCount = 0;
    onUpdateWorkspace((prev) => {
      const existingQ = new Set(
        prev.flashcards
          .filter((c) => c.subjectId === activeSubject.id)
          .map((c) => c.q.trim().toLowerCase())
      );
      const added: StudyFlashcard[] = [];
      for (const kt of validTerms) {
        if (existingQ.has(kt.term.trim().toLowerCase())) continue;
        existingQ.add(kt.term.trim().toLowerCase());
        added.push({
          id: makeId('fc'),
          subjectId: activeSubject.id,
          topicId: activeTopic.id,
          sectionName: activeTopic.name,
          q: kt.term.trim(),
          a: kt.definition.trim(),
          box: 1,
          dueAt: Date.now(),
          flagged: false,
          createdAt: new Date().toISOString(),
        });
      }
      createdCount = added.length;
      if (!added.length) return prev;
      return {
        ...prev,
        flashcards: [...prev.flashcards, ...added],
        updatedAt: new Date().toISOString(),
      };
    });

    setCardsFeedback(
      createdCount > 0
        ? `Added ${createdCount} new flashcard${createdCount === 1 ? '' : 's'} to ${activeTopic.name}.`
        : 'All key terms are already saved in your flashcards.'
    );
  };

  const handleAddTimelineEvent = (e: FormEvent) => {
    e.preventDefault();
    if (!activeTopic || !tlDate.trim() || !tlTitle.trim()) return;
    const item: TimelineEventItem = {
      id: makeId('tl'),
      date: tlDate.trim(),
      title: tlTitle.trim(),
      detail: tlDetail.trim(),
      significance: tlSignificance.trim() || undefined,
      era: tlEra.trim() || undefined,
      keyEvent: tlKeyEvent || undefined,
    };
    updateTopic(activeTopic.id, (t) => ({
      ...t,
      timelineEvents: [...(t.timelineEvents || []), item],
    }));
    setTlDate('');
    setTlTitle('');
    setTlDetail('');
    setTlSignificance('');
    setTlEra('');
    setTlKeyEvent(false);
    setAddEventOpen(false);
  };

  const handleSortTimelineEvents = () => {
    if (!activeTopic) return;
    updateTopic(activeTopic.id, (t) => ({
      ...t,
      timelineEvents: [...(t.timelineEvents || [])].sort(
        (a, b) => parseChronologicalWeight(a.date) - parseChronologicalWeight(b.date)
      ),
    }));
  };

  const handleMoveTimelineEvent = (evId: string, dir: -1 | 1) => {
    if (!activeTopic) return;
    const list = [...(activeTopic.timelineEvents || [])];
    const idx = list.findIndex((x) => x.id === evId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= list.length) return;
    const [item] = list.splice(idx, 1);
    list.splice(target, 0, item);
    updateTopic(activeTopic.id, (t) => ({
      ...t,
      timelineEvents: list,
    }));
  };

  const handleSaveTimelineEdit = (evId: string) => {
    if (!activeTopic || !editEvDate.trim() || !editEvTitle.trim()) return;
    updateTopic(activeTopic.id, (t) => ({
      ...t,
      timelineEvents: (t.timelineEvents || []).map((ev) =>
        ev.id === evId
          ? {
              ...ev,
              date: editEvDate.trim(),
              title: editEvTitle.trim(),
              detail: editEvDetail.trim(),
              significance: editEvSignificance.trim() || undefined,
              era: editEvEra.trim() || undefined,
              keyEvent: editEvKeyEvent || undefined,
            }
          : ev
      ),
    }));
    setEditingEventId(null);
  };

  const handleBulkImportTimeline = () => {
    if (!activeTopic || parsedBulkNodes.length === 0) return;
    let addedCount = 0;
    updateTopic(activeTopic.id, (t) => {
      const existing = [...(t.timelineEvents || [])];
      const seen = new Set(
        existing.map((ev) => `${ev.date.trim().toLowerCase()}::${ev.title.trim().toLowerCase()}`)
      );
      for (const node of parsedBulkNodes) {
        const key = `${node.date.trim().toLowerCase()}::${node.title.trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        existing.push({
          id: makeId('tl'),
          date: node.date.trim(),
          title: node.title.trim(),
          detail: node.detail.trim(),
          significance: node.significance?.trim() || undefined,
          era: node.era?.trim() || undefined,
          keyEvent: node.keyEvent || undefined,
        });
        addedCount++;
      }
      if (bulkAutoSort) {
        existing.sort(
          (a, b) => parseChronologicalWeight(a.date) - parseChronologicalWeight(b.date)
        );
      }
      return {
        ...t,
        timelineEvents: existing,
      };
    });
    setBulkFeedback(
      addedCount > 0
        ? `Imported ${addedCount} timeline node${addedCount === 1 ? '' : 's'} into ${activeTopic.name}.`
        : 'All pasted events were already in this timeline.'
    );
    setBulkText('');
    setBulkOpen(false);
  };

  const handleMakeFlashcardsFromTimeline = () => {
    if (!activeSubject || !activeTopic) return;
    const events = activeTopic.timelineEvents || [];
    if (!events.length) {
      setBulkFeedback('Add timeline events first before generating flashcards.');
      return;
    }
    let addedCount = 0;
    onUpdateWorkspace((prev) => {
      const existingQ = new Set(
        prev.flashcards
          .filter((c) => c.subjectId === activeSubject.id)
          .map((c) => c.q.trim().toLowerCase())
      );
      const added: StudyFlashcard[] = [];
      for (const ev of events) {
        const q = `When did "${ev.title}" take place, and why did it matter?`;
        if (existingQ.has(q.toLowerCase())) continue;
        existingQ.add(q.toLowerCase());
        const parts = splitEventDetailAndSignificance(ev);
        const answerBits = [ev.date, parts.what, parts.why ? `Significance: ${parts.why}` : ''].filter(Boolean);
        added.push({
          id: makeId('fc'),
          subjectId: activeSubject.id,
          topicId: activeTopic.id,
          sectionName: `${activeTopic.name} · Timeline`,
          q,
          a: answerBits.join(' — '),
          box: 1,
          dueAt: Date.now(),
          flagged: Boolean(ev.keyEvent),
          createdAt: new Date().toISOString(),
        });
      }
      addedCount = added.length;
      if (!added.length) return prev;
      return {
        ...prev,
        flashcards: [...prev.flashcards, ...added],
        updatedAt: new Date().toISOString(),
      };
    });
    setBulkFeedback(
      addedCount > 0
        ? `Created ${addedCount} timeline flashcard${addedCount === 1 ? '' : 's'} in ${activeTopic.name}.`
        : 'All timeline events are already saved as flashcards.'
    );
  };

  const timelineEventsAll = activeTopic?.timelineEvents || [];
  const timelineEras = useMemo(() => {
    const set = new Set<string>();
    for (const ev of timelineEventsAll) {
      if (ev.era && ev.era.trim()) set.add(ev.era.trim());
    }
    return Array.from(set);
  }, [timelineEventsAll]);

  const filteredTimelineEvents = useMemo(() => {
    const q = timelineSearch.trim().toLowerCase();
    return timelineEventsAll.filter((ev) => {
      if (timelineEraFilter !== 'ALL' && (ev.era || '').trim() !== timelineEraFilter) return false;
      if (timelineKeyOnly && !ev.keyEvent) return false;
      if (q) {
        const hay = `${ev.date} ${ev.title} ${ev.detail} ${ev.significance || ''} ${ev.era || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [timelineEventsAll, timelineEraFilter, timelineKeyOnly, timelineSearch]);

  if (!workspace.subjects.length) {
    return (
      <div className="h-full overflow-y-auto bg-[var(--bg)]">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <div className="sd-card p-8 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-[var(--e3)]" aria-hidden="true" />
            <h1 className="font-display mt-3 text-2xl font-extrabold text-[var(--ink)]">
              Clean Structured Study Notes
            </h1>
            <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--mute)]">
              Add a subject first or import your existing class notes, Quizlet lists, or Word docs to
              start revising in clear Save My Exams-style sections.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate('subjects')}
                className="sd-btn-pri px-4 py-2 text-sm whitespace-nowrap"
              >
                Quick-Add Subjects
              </button>
              <button
                type="button"
                onClick={onOpenImport}
                className="sd-btn px-4 py-2 text-sm whitespace-nowrap"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>Import Notes / .docx</span>
              </button>
              {onBrowseCommunityNotes && (
                <button
                  type="button"
                  onClick={onBrowseCommunityNotes}
                  className="sd-btn px-4 py-2 text-sm whitespace-nowrap"
                >
                  <Globe className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                  <span>Browse Others&apos; Notes</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--bg)] lg:flex-row">
      {/* Compressible Left Subject & Topic Navigator */}
      <aside
        className={`shrink-0 border-b border-[var(--line)] bg-[var(--card)] transition-[width] duration-200 lg:overflow-y-auto lg:border-b-0 lg:border-r ${
          sidebarCompressed ? 'p-2.5 lg:w-[54px] lg:px-1.5 lg:py-3' : 'p-4 lg:w-[272px]'
        }`}
      >
        {sidebarCompressed ? (
          /* Compressed Sidebar Rail (Desktop rail + compact strip on mobile) */
          <div className="flex items-center justify-between gap-2 lg:flex-col lg:items-center lg:gap-2.5">
            <button
              type="button"
              onClick={toggleSidebarCompressed}
              title="Expand Topics Sidebar"
              aria-label="Expand topics sidebar"
              className="sd-btn h-9 w-9 shrink-0 p-0 text-[var(--e3)]"
            >
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            </button>

            <div className="hidden h-px w-6 bg-[var(--line)] lg:block" />

            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto lg:w-full lg:flex-col lg:overflow-x-visible">
              {(() => {
                let rootCounter = 0;
                return topicTreeNodes.map((node) => {
                  const tp = node.topic;
                  const selected = tp.id === activeTopic?.id;
                  if (node.depth === 0) rootCounter += 1;
                  const fullLabel = [...node.ancestors.map((a) => a.name), tp.name].join(' › ');
                  return (
                    <button
                      key={tp.id}
                      type="button"
                      onClick={() => setSelectedTopicId(tp.id)}
                      title={fullLabel}
                      aria-label={fullLabel}
                      className={`font-mono-num flex shrink-0 cursor-pointer items-center justify-center rounded-lg border font-bold transition-colors ${
                        node.depth > 0 ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs'
                      } ${
                        selected
                          ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_15%,var(--bg))] text-[var(--e3)]'
                          : tp.completed
                          ? 'border-[var(--ok)]/50 bg-[var(--bg)] text-[var(--ok)]'
                          : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)] hover:text-[var(--ink)]'
                      }`}
                    >
                      {node.depth === 0 ? rootCounter : '↳'}
                    </button>
                  );
                });
              })()}
            </div>

            <button
              type="button"
              onClick={() => startAddingTopic(null)}
              title="Add new topic"
              aria-label="Expand and add topic"
              className="sd-btn-pri h-8 w-8 shrink-0 p-0"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : (
          /* Expanded Sidebar */
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <label className="min-w-0 flex-1 text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                Subject
                <select
                  value={activeSubject?.id || ''}
                  onChange={(e) => onSelectSubjectId(e.target.value)}
                  className="sd-input mt-1 py-1.5 text-sm font-semibold"
                >
                  {workspace.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={toggleSidebarCompressed}
                title="Compress topics sidebar"
                aria-label="Compress topics sidebar"
                className="sd-btn h-[34px] w-[34px] shrink-0 p-0 text-[var(--mute)] hover:text-[var(--ink)]"
              >
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                Topics ({subjectTopics.length})
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onOpenImport}
                  title="Import notes or Word doc"
                  className="sd-btn px-2 py-1 text-[11px] whitespace-nowrap"
                >
                  <Upload className="h-3 w-3" aria-hidden="true" />
                  <span>Import</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (addingTopic && !addingParentTopicId) {
                      setAddingTopic(false);
                    } else {
                      startAddingTopic(null);
                    }
                  }}
                  className="sd-btn-pri px-2 py-1 text-[11px] whitespace-nowrap"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  <span>Topic</span>
                </button>
              </div>
            </div>

            {addingTopic && (
              <form
                onSubmit={handleAddTopic}
                className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-2.5"
              >
                {topicTreeNodes.length > 0 && (
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--mute)]">
                    Parent topic
                    <select
                      value={addingParentTopicId || ''}
                      onChange={(e) => setAddingParentTopicId(e.target.value || null)}
                      className="sd-input mt-1 py-1 text-xs font-medium normal-case tracking-normal"
                    >
                      <option value="">Top-level topic</option>
                      {topicTreeNodes.map((n) => (
                        <option key={n.topic.id} value={n.topic.id}>
                          {'\u00A0\u00A0'.repeat(n.depth)}
                          {n.depth > 0 ? '↳ ' : ''}
                          {n.topic.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <input
                  type="text"
                  autoFocus
                  value={newTopicName}
                  onChange={(e) => setNewTopicName(e.target.value)}
                  placeholder={addingParentTopicId ? 'Sub-topic title…' : 'Topic title…'}
                  className="sd-input py-1.5 text-xs"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setAddingTopic(false);
                      setAddingParentTopicId(null);
                    }}
                    className="sd-btn px-2 py-1 text-[11px]"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="sd-btn-pri px-2.5 py-1 text-[11px]">
                    {addingParentTopicId ? 'Add Sub-topic' : 'Create'}
                  </button>
                </div>
              </form>
            )}

            {/* Hierarchical Topic Tree List (Drag & Drop to reorder or nest sub-topics) */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-visible lg:pb-0">
              {topicTreeNodes
                .filter(
                  (node) => !node.ancestors.some((anc) => collapsedTopicIds.has(anc.id))
                )
                .map((node) => {
                  const tp = node.topic;
                  const selected = tp.id === activeTopic?.id;
                  const isCollapsed = collapsedTopicIds.has(tp.id);
                  const isDraggingThis = draggedTopicId === tp.id;
                  const isDropTarget = topicDropTarget?.targetId === tp.id;
                  const dropPos = isDropTarget ? topicDropTarget?.position : null;
                  const hasVisibleChildren = node.childCount > 0 && !isCollapsed;
                  const indentClass =
                    node.depth === 0
                      ? ''
                      : node.depth === 1
                      ? 'lg:pl-4'
                      : node.depth === 2
                      ? 'lg:pl-7'
                      : 'lg:pl-9';

                  return (
                    <div
                      key={tp.id}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        setDraggedTopicId(tp.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', tp.id);
                      }}
                      onDragEnd={() => {
                        setDraggedTopicId(null);
                        setTopicDropTarget(null);
                      }}
                      onDragOver={(e) => {
                        if (!draggedTopicId || !canDropTopicOn(draggedTopicId, tp.id)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'move';
                        const rect = e.currentTarget.getBoundingClientRect();
                        const relY = (e.clientY - rect.top) / Math.max(1, rect.height);
                        const nextPos: TopicDropPosition =
                          relY < 0.28
                            ? 'before'
                            : hasVisibleChildren
                            ? 'inside'
                            : relY > 0.72
                            ? 'after'
                            : 'inside';
                        setTopicDropTarget((cur) =>
                          cur?.targetId === tp.id && cur.position === nextPos
                            ? cur
                            : { targetId: tp.id, position: nextPos }
                        );
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                          setTopicDropTarget((cur) =>
                            cur?.targetId === tp.id ? null : cur
                          );
                        }
                      }}
                      onDrop={(e) => {
                        if (!draggedTopicId || !canDropTopicOn(draggedTopicId, tp.id)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const pos =
                          topicDropTarget?.targetId === tp.id
                            ? topicDropTarget.position
                            : 'inside';
                        handleDropTopic(tp.id, pos);
                      }}
                      className={`group flex shrink-0 items-center gap-1 rounded-xl border pr-1 transition-colors lg:w-full ${indentClass} ${
                        isDraggingThis ? 'opacity-45' : ''
                      } ${
                        dropPos === 'inside'
                          ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_14%,var(--bg))] ring-1 ring-[var(--e3)]'
                          : selected
                          ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--bg))]'
                          : 'border-transparent hover:bg-[var(--bg)]'
                      } ${
                        dropPos === 'before'
                          ? 'border-t-2 border-t-[var(--e3)]'
                          : dropPos === 'after'
                          ? 'border-b-2 border-b-[var(--e3)]'
                          : ''
                      }`}
                    >
                      <span
                        title="Drag to reorder or drop onto a topic to make sub-topic"
                        className="ml-0.5 hidden h-5 w-3.5 shrink-0 cursor-grab items-center justify-center text-[var(--mute)]/45 group-hover:text-[var(--mute)] active:cursor-grabbing lg:inline-flex"
                        aria-hidden="true"
                      >
                        <GripVertical className="h-3 w-3" />
                      </span>

                      {node.childCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggleTopicCollapsed(tp.id)}
                          aria-label={
                            isCollapsed
                              ? `Expand sub-topics of ${tp.name}`
                              : `Collapse sub-topics of ${tp.name}`
                          }
                          className="flex h-6 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-[var(--mute)] hover:text-[var(--ink)]"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                        </button>
                      ) : node.depth > 0 ? (
                        <CornerDownRight
                          className="ml-0.5 h-3 w-3 shrink-0 text-[var(--mute)]/60"
                          aria-hidden="true"
                        />
                      ) : (
                        <span className="hidden w-1 shrink-0 lg:block" aria-hidden="true" />
                      )}

                      <button
                        type="button"
                        onClick={() => setSelectedTopicId(tp.id)}
                        className={`flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-1.5 py-2 pr-1 text-left text-xs ${
                          selected
                            ? 'font-bold text-[var(--ink)]'
                            : 'font-semibold text-[var(--mute)] hover:text-[var(--ink)]'
                        }`}
                      >
                        <span className="truncate">{tp.name}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          {dropPos === 'inside' && (
                            <span className="text-[10px] font-bold text-[var(--e3)] whitespace-nowrap">
                              Nest
                            </span>
                          )}
                          {node.childCount > 0 && dropPos !== 'inside' && (
                            <span
                              title={`${node.childCount} sub-topic${node.childCount === 1 ? '' : 's'}`}
                              className="font-mono-num rounded bg-[var(--bg)] px-1 py-0.5 text-[10px] font-semibold text-[var(--mute)]"
                            >
                              {node.childCount}
                            </span>
                          )}
                          {tp.completed && (
                            <CheckCircle2
                              className="h-3.5 w-3.5 shrink-0 text-[var(--ok)]"
                              aria-label="Topic studied"
                            />
                          )}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => startAddingTopic(tp.id)}
                        title={`Add sub-topic under ${tp.name}`}
                        aria-label={`Add sub-topic under ${tp.name}`}
                        className={`hidden h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--mute)] transition-opacity hover:bg-[var(--card)] hover:text-[var(--e3)] lg:flex ${
                          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        <Plus className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              {draggedTopicId && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setTopicDropTarget({ targetId: 'root-end', position: 'root-end' });
                  }}
                  onDragLeave={() => {
                    setTopicDropTarget((cur) =>
                      cur?.targetId === 'root-end' ? null : cur
                    );
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropTopic(null, 'root-end');
                  }}
                  className={`mt-1 rounded-xl border border-dashed px-3 py-2 text-center text-[11px] font-semibold transition-colors ${
                    topicDropTarget?.targetId === 'root-end'
                      ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--bg))] text-[var(--e3)]'
                      : 'border-[var(--line)] text-[var(--mute)]'
                  }`}
                >
                  Drop here to move to top level
                </div>
              )}
              {subjectTopics.length === 0 && (
                <div className="rounded-xl border border-dashed border-[var(--line)] p-3 text-xs text-[var(--mute)]">
                  No topics in {activeSubject?.name}. Click &ldquo;+ Topic&rdquo; above.
                </div>
              )}
            </div>

            {onBrowseCommunityNotes && (
              <button
                type="button"
                onClick={onBrowseCommunityNotes}
                className="sd-btn mt-2 w-full py-2 text-xs whitespace-nowrap"
              >
                <Globe className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                <span>Browse Others&apos; Notes</span>
              </button>
            )}
          </div>
        )}
      </aside>

      {/* Main Reader / Notion Editor / History Timeline Canvas */}
      <div className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7">
        {!activeTopic ? (
          <div className="mx-auto max-w-2xl sd-card p-6 text-center text-sm text-[var(--mute)]">
            Select or create a topic on the left to start writing structured notes.
          </div>
        ) : (() => {
          const activeNoteColor: NoteAccentColor = normalizeNoteColor(
            activeTopic.notes.accentColor
          );
          const hasMultiPartColors = activeTopic.notes.sections.some(
            (s) => Boolean(s.accentColor && s.accentColor !== 'default')
          );
          const activeColorOpt =
            NOTE_COLOR_OPTIONS.find((c) => c.id === activeNoteColor) ||
            NOTE_COLOR_OPTIONS[0];
          const isPreferringDocView =
            hasDocHtml && activeTopic.notes.preferOriginalFormat !== false;
          const isDocViewActive = isPreferringDocView && !isPdfPageDoc;
          const isEditingAnything =
            viewMode === 'edit' || (viewMode === 'read' && isDocViewActive && editingDocHtml);

          return (
          <div
            className="sd-note-scope mx-auto space-y-6"
            data-note-color={activeNoteColor}
            style={{ maxWidth: 'var(--mw, 1200px)' }}
          >
            {/* Top Breadcrumb & Action Toolbar */}
            <div
              className={`flex flex-wrap items-center justify-between gap-3 ${
                viewMode === 'edit' ? 'border-b border-[var(--line)] pb-4' : ''
              }`}
            >
              <div className="min-w-[min(100%,220px)] flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--mute)]">
                  {sidebarCompressed && (
                    <>
                      <button
                        type="button"
                        onClick={toggleSidebarCompressed}
                        className="cursor-pointer font-semibold text-[var(--note-accent)] hover:underline whitespace-nowrap"
                      >
                        Show Topics ({subjectTopics.length})
                      </button>
                      <span aria-hidden="true">·</span>
                    </>
                  )}
                  <span className="font-semibold text-[var(--note-accent)]">
                    {activeSubject?.name}
                  </span>
                  {activeTreeNode?.ancestors.map((anc) => (
                    <span key={anc.id} className="inline-flex items-center gap-1.5">
                      <ChevronRight className="h-3 w-3 opacity-70" aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => setSelectedTopicId(anc.id)}
                        className="cursor-pointer font-semibold text-[var(--note-accent)] hover:underline"
                      >
                        {anc.name}
                      </button>
                    </span>
                  ))}
                  {activeTopic.specCode && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-num">Spec {activeTopic.specCode}</span>
                    </>
                  )}
                  {activeTopic.tags && activeTopic.tags.length > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{activeTopic.tags.join(' · ')}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 font-mono-num whitespace-nowrap">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {estimateNoteReadingMinutes(activeTopic.notes)} min read
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isHistorySubject && (
                  <div className="sd-seg" role="tablist" aria-label="Note mode">
                    <button
                      type="button"
                      aria-pressed={viewMode !== 'timeline'}
                      onClick={() => {
                        if (editingDocHtml) commitDocumentHtmlEdit(true);
                        setViewMode('read');
                      }}
                      className="sd-seg-btn"
                    >
                      Read
                    </button>
                    <button
                      type="button"
                      aria-pressed={viewMode === 'timeline'}
                      onClick={() => {
                        if (editingDocHtml) commitDocumentHtmlEdit(true);
                        setViewMode('timeline');
                      }}
                      className="sd-seg-btn"
                    >
                      Timeline ({activeTopic.timelineEvents?.length || 0})
                    </button>
                  </div>
                )}

                {/* Compact Standalone Edit Toggle Button */}
                <button
                  type="button"
                  aria-pressed={isEditingAnything}
                  onClick={() => {
                    if (viewMode === 'timeline') {
                      setViewMode('edit');
                      return;
                    }
                    if (isDocViewActive) {
                      if (editingDocHtml) {
                        commitDocumentHtmlEdit(true);
                      } else {
                        setEditingDocHtml(true);
                      }
                      return;
                    }
                    setViewMode((cur) => (cur === 'edit' ? 'read' : 'edit'));
                  }}
                  className={
                    isEditingAnything
                      ? 'sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap shrink-0'
                      : 'sd-btn px-3 py-1.5 text-xs whitespace-nowrap shrink-0'
                  }
                >
                  {isEditingAnything ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Done Editing</span>
                    </>
                  ) : (
                    <>
                      <Edit3 className="h-3.5 w-3.5 text-[var(--note-accent)]" aria-hidden="true" />
                      <span>Edit</span>
                    </>
                  )}
                </button>

                {/* Note Colour Option */}
                <div className="relative" ref={colorMenuRef}>
                  <button
                    type="button"
                    onClick={() => setColorMenuOpen((v) => !v)}
                    aria-expanded={colorMenuOpen}
                    aria-label="Note colour"
                    className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                  >
                    {hasMultiPartColors ? (
                      <span
                        className="h-3 w-3 shrink-0 rounded-full border border-black/15"
                        style={{
                          background:
                            'conic-gradient(#2563EB 0 25%, #16A34A 25% 50%, #7C3AED 50% 75%, #E11D48 75% 100%)',
                        }}
                        aria-hidden="true"
                      />
                    ) : (
                      <span
                        className="h-3 w-3 shrink-0 rounded-full border border-black/15"
                        style={{ backgroundColor: activeColorOpt.swatch }}
                        aria-hidden="true"
                      />
                    )}
                    <Palette className="h-3.5 w-3.5 text-[var(--mute)]" aria-hidden="true" />
                    <span>{hasMultiPartColors ? 'By Part' : 'Colour'}</span>
                  </button>

                  {colorMenuOpen && (
                    <div
                      role="menu"
                      aria-label="Choose note colour"
                      className="sd-card absolute right-0 z-30 mt-2 w-56 p-2"
                    >
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={hasMultiPartColors}
                        onClick={() => {
                          replaceActiveNote({
                            ...activeTopic.notes,
                            accentColor: 'default',
                            sections: applyVerifiedPartColors(activeTopic.notes.sections, true),
                          });
                          setColorMenuOpen(false);
                        }}
                        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors ${
                          hasMultiPartColors
                            ? 'bg-[color-mix(in_srgb,var(--e3)_12%,var(--bg))] text-[var(--ink)]'
                            : 'text-[var(--ink)] hover:bg-[var(--bg)]'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/15"
                            style={{
                              background:
                                'conic-gradient(#2563EB 0 25%, #16A34A 25% 50%, #7C3AED 50% 75%, #E11D48 75% 100%)',
                            }}
                            aria-hidden="true"
                          />
                          <span>Colour-Code by Part</span>
                        </span>
                        {hasMultiPartColors && (
                          <Check className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                        )}
                      </button>

                      <div className="my-1.5 border-t border-[var(--line)]" />

                      <div className="px-2 py-0.5 text-[11px] font-bold text-[var(--mute)]">
                        Single Note Colour
                      </div>
                      <div className="mt-1 space-y-0.5">
                        {NOTE_COLOR_OPTIONS.map((opt) => {
                          const selected = !hasMultiPartColors && activeNoteColor === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              role="menuitemradio"
                              aria-checked={selected}
                              onClick={() => {
                                replaceActiveNote({
                                  ...activeTopic.notes,
                                  accentColor: opt.id,
                                  sections: stripSectionPartColors(activeTopic.notes.sections),
                                });
                                setColorMenuOpen(false);
                              }}
                              className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold transition-colors ${
                                selected
                                  ? 'bg-[color-mix(in_srgb,var(--note-accent)_12%,var(--bg))] text-[var(--ink)]'
                                  : 'text-[var(--ink)] hover:bg-[var(--bg)]'
                              }`}
                            >
                              <span className="flex items-center gap-2.5">
                                <span
                                  className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/15"
                                  style={{ backgroundColor: opt.swatch }}
                                  aria-hidden="true"
                                />
                                <span>{opt.label}</span>
                              </span>
                              {selected && (
                                <Check
                                  className="h-3.5 w-3.5 text-[var(--note-accent)]"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => startAddingTopic(activeTopic.id)}
                  title={`Create a sub-topic under ${activeTopic.name}`}
                  className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                >
                  <FolderPlus className="h-3.5 w-3.5 text-[var(--note-accent)]" aria-hidden="true" />
                  <span>+ Sub-topic</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    updateTopic(activeTopic.id, (t) => ({ ...t, completed: !t.completed }))
                  }
                  className={`sd-btn px-3 py-1.5 text-xs whitespace-nowrap shrink-0 ${
                    activeTopic.completed ? 'border-[var(--ok)] text-[var(--ok)]' : ''
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{activeTopic.completed ? 'Studied' : 'Mark Studied'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => activeSubject && onShareTopic(activeSubject.id, activeTopic.id)}
                  className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                >
                  <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Share</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setConfirmDeleteTopicId((cur) =>
                      cur === activeTopic.id ? null : activeTopic.id
                    )
                  }
                  title="Delete topic"
                  aria-label={`Delete ${activeTopic.name}`}
                  className="sd-btn h-8 w-8 p-0 text-[var(--bad)] shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            {viewMode !== 'edit' && (
              <div className="w-full border-b border-[var(--line)] pb-4">
                <div
                  className="mb-2.5 h-1 w-14 rounded-full bg-[var(--note-accent)]"
                  aria-hidden="true"
                />
                <h1 className="w-full font-display text-3xl font-extrabold tracking-tight text-[var(--ink)] sm:text-[2.4rem] sm:leading-[1.14]">
                  {activeTopic.name}
                </h1>
              </div>
            )}

            {/* Persistent Notes View / Document Default View Switcher after importing */}
            {hasDocHtml && viewMode !== 'timeline' && (
              <div className="sd-card flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="sd-seg" role="group" aria-label="Topic format view">
                    <button
                      type="button"
                      aria-pressed={!isPreferringDocView}
                      onClick={() => switchTopicDefaultView('notes')}
                      className="sd-seg-btn inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Notes View</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={isPreferringDocView}
                      onClick={() => switchTopicDefaultView('document')}
                      className="sd-seg-btn inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Document Default</span>
                    </button>
                  </div>
                  <span className="hidden text-[11px] text-[var(--mute)] sm:inline">
                    {isPreferringDocView
                      ? 'Showing original imported document'
                      : 'Showing structured revision notes'}
                  </span>
                </div>

                {isPreferringDocView && viewMode === 'read' && (
                  <div className="sd-seg" role="group" aria-label="Document zoom">
                    {[85, 100, 115].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        aria-pressed={docZoom === pct}
                        onClick={() => setDocZoom(pct)}
                        className="sd-seg-btn font-mono-num"
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {confirmDeleteTopicId === activeTopic.id && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--bad)]/40 bg-[color-mix(in_srgb,var(--bad)_7%,var(--card))] px-4 py-2.5 text-xs">
                <span className="font-semibold text-[var(--ink)]">
                  Delete &ldquo;{activeTopic.name}&rdquo;?
                  {directChildTopics.length > 0
                    ? ` Its ${directChildTopics.length} sub-topic${
                        directChildTopics.length === 1 ? '' : 's'
                      } will move up one level and stay safe.`
                    : ' Any notes and flashcards linked to this topic will be removed.'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteTopicId(null)}
                    className="sd-btn px-2.5 py-1 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteTopic(activeTopic.id)}
                    className="cursor-pointer rounded-lg bg-[var(--bad)] px-3 py-1 text-xs font-bold text-white hover:opacity-90"
                  >
                    Delete Topic
                  </button>
                </div>
              </div>
            )}

            {cardsFeedback && (
              <div
                role="status"
                className="rounded-xl border border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_9%,var(--card))] px-4 py-2.5 text-xs font-semibold text-[var(--ink)]"
              >
                {cardsFeedback}
              </div>
            )}

            {/* MODE 1: UNIFIED READ / DOCUMENT VIEWER */}
            {viewMode === 'read' && (() => {
              const populatedSections = activeTopic.notes.sections.filter(
                (s) => s.points.length > 0 || s.heading.trim()
              );
              const showDocumentInRead =
                hasDocHtml && activeTopic.notes.preferOriginalFormat !== false;

              if (showDocumentInRead) {
                return (
                  <div className="space-y-4">

                    {/* Enhanced Word/Docs Formatting & One-Click Study Ribbon */}
                    {editingDocHtml && !isPdfPageDoc && (
                      <div className="sd-card sticky top-2 z-20 space-y-2 px-3 py-2 text-xs backdrop-blur">
                        {/* Row 1: Undo/Redo, Formatting, Text/Highlight Colour, Headings, Lists, Alignment */}
                        <div className="flex flex-wrap items-center gap-1">
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              execDocCommand('undo');
                            }}
                            title="Undo"
                            className="sd-btn h-7 w-7 p-0"
                          >
                            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              execDocCommand('redo');
                            }}
                            title="Redo"
                            className="sd-btn h-7 w-7 p-0"
                          >
                            <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden="true" />
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              execDocCommand('bold');
                            }}
                            title="Bold"
                            className="sd-btn h-7 w-7 p-0"
                          >
                            <Bold className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              execDocCommand('italic');
                            }}
                            title="Italic"
                            className="sd-btn h-7 w-7 p-0"
                          >
                            <Italic className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              execDocCommand('underline');
                            }}
                            title="Underline"
                            className="sd-btn h-7 w-7 p-0"
                          >
                            <Underline className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>

                          {/* Text Colour Picker */}
                          <div className="relative" ref={docTextColorRef}>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setDocTextColorOpen((v) => !v);
                                setDocHighlightOpen(false);
                              }}
                              title="Text Colour"
                              className="sd-btn h-7 px-2 text-xs font-bold"
                            >
                              <span className="border-b-2 border-[var(--note-accent,var(--e3))] leading-none">
                                A
                              </span>
                              <Palette className="h-3 w-3 text-[var(--mute)]" aria-hidden="true" />
                            </button>
                            {docTextColorOpen && (
                              <div className="sd-card absolute left-0 top-8 z-40 w-52 p-2.5">
                                <div className="mb-1.5 text-[11px] font-bold text-[var(--mute)]">
                                  Text Colour
                                </div>
                                <div className="grid grid-cols-5 gap-1.5">
                                  {NOTE_TEXT_COLORS.map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      title={c.label}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        if (!c.value) {
                                          execDocCommand('removeFormat');
                                        } else {
                                          execDocCommand('foreColor', c.value);
                                        }
                                        setDocTextColorOpen(false);
                                      }}
                                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-[var(--line)] text-xs font-bold transition-transform hover:scale-110"
                                      style={{
                                        backgroundColor: c.value ? c.preview : 'var(--card)',
                                        color: c.value ? '#FFFFFF' : 'var(--ink)',
                                      }}
                                    >
                                      {!c.value ? 'A' : ''}
                                    </button>
                                  ))}
                                </div>
                                <label className="mt-2 flex cursor-pointer items-center justify-between border-t border-[var(--line)] pt-2 text-[11px] font-semibold text-[var(--mute)]">
                                  <span>Custom Hex</span>
                                  <input
                                    type="color"
                                    defaultValue="#2563EB"
                                    onChange={(e) => {
                                      execDocCommand('foreColor', e.target.value);
                                    }}
                                    className="h-6 w-8 cursor-pointer rounded border border-[var(--line)] bg-transparent p-0"
                                  />
                                </label>
                              </div>
                            )}
                          </div>

                          {/* Highlight Picker */}
                          <div className="relative" ref={docHighlightRef}>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setDocHighlightOpen((v) => !v);
                                setDocTextColorOpen(false);
                              }}
                              title="Highlight Colour"
                              className="sd-btn h-7 w-7 p-0"
                            >
                              <Highlighter className="h-3.5 w-3.5 text-[var(--e2)]" aria-hidden="true" />
                            </button>
                            {docHighlightOpen && (
                              <div className="sd-card absolute left-0 top-8 z-40 w-48 p-2.5">
                                <div className="mb-1.5 text-[11px] font-bold text-[var(--mute)]">
                                  Highlight Colour
                                </div>
                                <div className="grid grid-cols-4 gap-1.5">
                                  {NOTE_HIGHLIGHT_COLORS.map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      title={c.label}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        execDocCommand('hiliteColor', c.value || 'transparent');
                                        setDocHighlightOpen(false);
                                      }}
                                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-[var(--line)] text-[11px] font-bold transition-transform hover:scale-110"
                                      style={{
                                        backgroundColor: c.value ? c.preview : 'var(--card)',
                                        color: '#17202E',
                                      }}
                                    >
                                      {!c.value ? (
                                        <Eraser className="h-3.5 w-3.5 text-[var(--mute)]" />
                                      ) : (
                                        ''
                                      )}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden="true" />
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              execDocCommand('formatBlock', '<h2>');
                            }}
                            title="Section Heading (H2)"
                            className="sd-btn h-7 px-2 font-bold"
                          >
                            <Heading2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              execDocCommand('formatBlock', '<h3>');
                            }}
                            title="Subheading (H3)"
                            className="sd-btn h-7 px-2 font-bold"
                          >
                            <Heading3 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              execDocCommand('formatBlock', '<p>');
                            }}
                            title="Body Paragraph"
                            className="sd-btn h-7 px-2 text-[11px] font-semibold"
                          >
                            Text
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              execDocCommand('insertUnorderedList');
                            }}
                            title="Bullet List"
                            className="sd-btn h-7 w-7 p-0"
                          >
                            <List className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              execDocCommand('insertOrderedList');
                            }}
                            title="Numbered List"
                            className="sd-btn h-7 w-7 p-0"
                          >
                            <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden="true" />
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              execDocCommand('justifyLeft');
                            }}
                            title="Align Left"
                            className="sd-btn h-7 w-7 p-0"
                          >
                            <AlignLeft className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              execDocCommand('justifyCenter');
                            }}
                            title="Align Center"
                            className="sd-btn h-7 w-7 p-0"
                          >
                            <AlignCenter className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              execDocCommand('justifyRight');
                            }}
                            title="Align Right"
                            className="sd-btn h-7 w-7 p-0"
                          >
                            <AlignRight className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>

                        {/* Row 2: One-Click Study Inserts + Table Colour Controls */}
                        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--line)] pt-2">
                          <span className="mr-0.5 text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                            Insert:
                          </span>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              insertDocSnippet(
                                '<table><thead><tr><th>Term / Date</th><th>Key Detail</th></tr></thead><tbody><tr><td>Point 1</td><td>Explanation…</td></tr><tr><td>Point 2</td><td>Explanation…</td></tr></tbody></table><p><br></p>',
                                true
                              );
                            }}
                            className="sd-btn px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
                          >
                            <Table2 className="h-3.5 w-3.5 text-[var(--note-accent,var(--e3))]" aria-hidden="true" />
                            <span>+ Table</span>
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              insertDocSnippet(
                                '<blockquote style="border-color: color-mix(in srgb, var(--e2) 45%, var(--line)); background-color: color-mix(in srgb, var(--e2) 8%, var(--card))"><strong style="color: var(--e2)">Examiner Tip:</strong> Write advice examiners look for…</blockquote><p><br></p>'
                              );
                            }}
                            className="sd-btn px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
                          >
                            <AlertCircle className="h-3.5 w-3.5 text-[var(--e2)]" aria-hidden="true" />
                            <span>+ Examiner Tip</span>
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              insertDocSnippet(
                                '<blockquote style="border-color: color-mix(in srgb, var(--ok) 40%, var(--line)); background-color: color-mix(in srgb, var(--ok) 8%, var(--card))"><strong style="color: var(--ok)">Worked Example:</strong> Step-by-step model answer…</blockquote><p><br></p>'
                              );
                            }}
                            className="sd-btn px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--ok)]" aria-hidden="true" />
                            <span>+ Worked Example</span>
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              insertDocSnippet(
                                '<blockquote><strong>Key Fact:</strong> High-yield fact, rule, or formula…</blockquote><p><br></p>'
                              );
                            }}
                            className="sd-btn px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
                          >
                            <Quote className="h-3.5 w-3.5 text-[var(--note-accent,var(--e3))]" aria-hidden="true" />
                            <span>+ Fact Box</span>
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              insertDocSnippet(
                                '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0"><div style="border: 1px solid var(--line); background: var(--bg); padding: 8px 12px; border-radius: 8px"><strong>1.</strong> Step one</div><span>→</span><div style="border: 1px solid var(--line); background: var(--bg); padding: 8px 12px; border-radius: 8px"><strong>2.</strong> Step two</div><span>→</span><div style="border: 1px solid var(--line); background: var(--bg); padding: 8px 12px; border-radius: 8px"><strong>3.</strong> Outcome</div></div><p><br></p>'
                              );
                            }}
                            className="sd-btn px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
                          >
                            <GitBranch className="h-3.5 w-3.5 text-[var(--note-accent,var(--e3))]" aria-hidden="true" />
                            <span>+ Flow Steps</span>
                          </button>

                          <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden="true" />
                          <span className="text-[11px] font-bold text-[var(--mute)]">
                            Table Colour:
                          </span>
                          <div className="flex items-center gap-1">
                            {NOTE_SURFACE_COLORS.slice(0, 7).map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                title={`Set active table colour to ${c.label}`}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  applyDocTableColor(c.id);
                                }}
                                className="h-4 w-4 cursor-pointer rounded-full border border-black/20 transition-transform hover:scale-110"
                                style={{ background: c.swatch }}
                              />
                            ))}
                            <input
                              type="color"
                              title="Custom table colour"
                              defaultValue="#2563EB"
                              onChange={(e) => applyDocTableColor(e.target.value)}
                              className="h-5 w-5 cursor-pointer rounded border border-[var(--line)] bg-transparent p-0"
                            />
                          </div>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              addDocTableRow();
                            }}
                            className="sd-btn px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
                          >
                            + Row
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              addDocTableCol();
                            }}
                            className="sd-btn px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
                          >
                            + Col
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Theme-Matched Document Canvas */}
                    <div className="sd-doc-canvas">
                      <div
                        className="mx-auto transition-[max-width] duration-150"
                        style={{
                          maxWidth:
                            docZoom === 85 ? '860px' : docZoom === 115 ? '100%' : '1160px',
                          fontSize:
                            docZoom === 85 ? '0.9em' : docZoom === 115 ? '1.12em' : undefined,
                        }}
                      >
                        {editingDocHtml && !isPdfPageDoc ? (
                          <div
                            ref={docEditorRef}
                            contentEditable
                            suppressContentEditableWarning
                            onClick={trackActiveDocTable}
                            onKeyUp={trackActiveDocTable}
                            onBlur={() => commitDocumentHtmlEdit(false)}
                            className="sd-doc-sheet ring-2 ring-[var(--e3)] outline-none"
                          />
                        ) : (
                          <div
                            className="sd-doc-sheet"
                            dangerouslySetInnerHTML={{ __html: activeDocHtml }}
                          />
                        )}
                      </div>
                    </div>

                    {/* Sub-topics Index below Document if present */}
                    {directChildTopics.length > 0 && (
                      <section className="sd-card overflow-hidden">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-5 py-3">
                          <div className="flex items-center gap-2">
                            <CornerDownRight className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                            <h2 className="font-display text-sm font-bold text-[var(--ink)] sm:text-base">
                              Sub-topics ({directChildTopics.length})
                            </h2>
                          </div>
                          <button
                            type="button"
                            onClick={() => startAddingTopic(activeTopic.id)}
                            className="sd-btn-pri px-2.5 py-1 text-xs whitespace-nowrap"
                          >
                            <Plus className="h-3 w-3" aria-hidden="true" />
                            <span>Add Sub-topic</span>
                          </button>
                        </div>
                        <div className="grid gap-px bg-[var(--line)] sm:grid-cols-2">
                          {directChildTopics.map((child) => (
                            <button
                              key={child.id}
                              type="button"
                              onClick={() => setSelectedTopicId(child.id)}
                              className="flex cursor-pointer items-center justify-between gap-3 bg-[var(--card)] px-4 py-3 text-left transition-colors hover:bg-[var(--bg)]"
                            >
                              <span className="truncate text-sm font-bold text-[var(--ink)]">
                                {child.name}
                              </span>
                              <ArrowRight className="h-4 w-4 shrink-0 text-[var(--mute)]" aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                );
              }

              const filteredTerms = activeTopic.notes.keyTerms.filter((kt) => {
                if (!glossaryFilter.trim()) return true;
                const q = glossaryFilter.trim().toLowerCase();
                return (kt.term + ' ' + kt.definition).toLowerCase().includes(q);
              });

              return (
                <div className="space-y-9 text-[16.5px] leading-[1.75] text-[var(--ink)]">

                  {/* Quick Section Jump Index (TOC) */}
                  {populatedSections.length >= 2 && (
                    <nav
                      aria-label="Topic section contents"
                      className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--line)] pb-3.5 text-sm"
                    >
                      <span className="font-bold text-[var(--mute)]">Contents</span>
                      {populatedSections.map((sec) => {
                        const meta = cleanSectionTitle(sec.heading);
                        const secAccent = normalizeNoteColor(sec.accentColor);
                        return (
                          <a
                            key={sec.id}
                            href={`#note-sec-${sec.id}`}
                            data-note-color={secAccent !== 'default' ? secAccent : undefined}
                            className="inline-flex items-baseline gap-1.5 font-semibold text-[var(--note-accent)] hover:underline whitespace-nowrap"
                          >
                            <span className="max-w-[260px] truncate">{meta.title}</span>
                          </a>
                        );
                      })}
                      {activeTopic.notes.keyTerms.length > 0 && (
                        <a
                          href="#note-key-terms"
                          className="font-semibold text-[var(--mute)] hover:text-[var(--note-accent)] hover:underline whitespace-nowrap"
                        >
                          Key Terms ({activeTopic.notes.keyTerms.length})
                        </a>
                      )}
                    </nav>
                  )}

                  {/* Summary Lead-In (Open Tinted Callout) */}
                  {activeTopic.notes.summary.trim() ? (
                    <section className="rounded-2xl border border-[color-mix(in_srgb,var(--note-accent)_28%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent)_7%,var(--card))] px-6 py-5 sm:px-7 sm:py-6">
                      <div className="text-sm font-bold text-[var(--note-accent)]">
                        Topic Overview
                      </div>
                      <p className="mt-2 whitespace-pre-line text-[17px] leading-[1.76] text-[var(--ink)]">
                        {renderRichInline(activeTopic.notes.summary)}
                      </p>
                    </section>
                  ) : null}

                  {/* Nested Sub-topics Index (Clean Hairline Directory) */}
                  {directChildTopics.length > 0 && (
                    <section className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                        <div className="flex items-center gap-2">
                          <CornerDownRight
                            className="h-4 w-4 text-[var(--note-accent)]"
                            aria-hidden="true"
                          />
                          <h2 className="font-display text-lg font-bold text-[var(--ink)] sm:text-xl">
                            Sub-topics ({directChildTopics.length})
                          </h2>
                        </div>
                        <div className="flex items-center gap-2">
                          {populatedSections.length === 0 && !activeTopic.notes.summary.trim() && (
                            <button
                              type="button"
                              onClick={() => setViewMode('edit')}
                              className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                            >
                              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Write Overview</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => startAddingTopic(activeTopic.id)}
                            className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Add Sub-topic</span>
                          </button>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {directChildTopics.map((child) => {
                          const childSubCount = subjectTopics.filter(
                            (t) => t.parentTopicId === child.id
                          ).length;
                          const secCount = child.notes.sections.filter(
                            (s) => s.points.length > 0
                          ).length;
                          const isCardDragging = draggedTopicId === child.id;
                          const isCardDrop = topicDropTarget?.targetId === child.id;
                          return (
                            <button
                              key={child.id}
                              type="button"
                              draggable
                              onDragStart={(e) => {
                                e.stopPropagation();
                                setDraggedTopicId(child.id);
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', child.id);
                              }}
                              onDragEnd={() => {
                                setDraggedTopicId(null);
                                setTopicDropTarget(null);
                              }}
                              onDragOver={(e) => {
                                if (!draggedTopicId || !canDropTopicOn(draggedTopicId, child.id)) return;
                                e.preventDefault();
                                const rect = e.currentTarget.getBoundingClientRect();
                                const pos: TopicDropPosition =
                                  e.clientX - rect.left < rect.width * 0.5 ? 'before' : 'after';
                                setTopicDropTarget((cur) =>
                                  cur?.targetId === child.id && cur.position === pos
                                    ? cur
                                    : { targetId: child.id, position: pos }
                                );
                              }}
                              onDrop={(e) => {
                                if (!draggedTopicId || !canDropTopicOn(draggedTopicId, child.id)) return;
                                e.preventDefault();
                                const pos =
                                  topicDropTarget?.targetId === child.id
                                    ? topicDropTarget.position
                                    : 'after';
                                handleDropTopic(child.id, pos);
                              }}
                              onClick={() => setSelectedTopicId(child.id)}
                              className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border bg-[var(--card)] px-4 py-3.5 text-left transition-colors hover:border-[var(--note-accent)] ${
                                isCardDragging ? 'opacity-45' : ''
                              } ${
                                isCardDrop
                                  ? 'border-[var(--e3)] ring-1 ring-[var(--e3)]'
                                  : 'border-[var(--line)]'
                              }`}
                            >
                              <div className="min-w-0 flex items-center gap-2">
                                <GripVertical
                                  className="h-3.5 w-3.5 shrink-0 cursor-grab text-[var(--mute)]/50"
                                  aria-hidden="true"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    {child.specCode && (
                                      <span className="font-mono-num shrink-0 text-xs font-bold text-[var(--note-accent)]">
                                        {child.specCode}
                                      </span>
                                    )}
                                    <span className="truncate text-[15.5px] font-bold text-[var(--ink)]">
                                      {child.name}
                                    </span>
                                    {child.completed && (
                                      <CheckCircle2
                                        className="h-4 w-4 shrink-0 text-[var(--ok)]"
                                        aria-label="Studied"
                                      />
                                    )}
                                  </div>
                                  <div className="mt-0.5 truncate text-[13px] text-[var(--mute)]">
                                    {child.notes.summary.trim()
                                      ? child.notes.summary.trim()
                                      : `${secCount} section${secCount === 1 ? '' : 's'} · ${estimateNoteReadingMinutes(child.notes)} min read${
                                          childSubCount > 0 ? ` · ${childSubCount} sub-topic${childSubCount === 1 ? '' : 's'}` : ''
                                        }`}
                                  </div>
                                </div>
                              </div>
                              <ArrowRight
                                className="h-4 w-4 shrink-0 text-[var(--note-accent)]"
                                aria-hidden="true"
                              />
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* Specification Sections (Open Editorial Flowing Layout — Big Bold Titles, Clear Typography, Clear Tables) */}
                  {populatedSections.length > 0 ? (
                    <div className="space-y-11 pt-1">
                      {populatedSections.map((sec) => {
                        const meta = cleanSectionTitle(sec.heading);
                        const blocks = groupSectionPoints(sec.points);
                        const secAccent = normalizeNoteColor(sec.accentColor);
                        const roleInfo = sec.partRole ? NOTE_PART_ROLE_MAP[sec.partRole] : undefined;
                        const hasCustomAccent = secAccent !== 'default';

                        return (
                          <section
                            id={`note-sec-${sec.id}`}
                            key={sec.id}
                            data-note-color={hasCustomAccent ? secAccent : undefined}
                            className={`scroll-mt-6 ${
                              meta.isCaseStudy
                                ? hasCustomAccent
                                  ? 'rounded-2xl border border-[color-mix(in_srgb,var(--note-accent)_32%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent)_6%,var(--card))] px-6 py-6 sm:px-8 sm:py-7'
                                  : 'rounded-2xl border border-[color-mix(in_srgb,var(--e2)_35%,var(--line))] bg-[color-mix(in_srgb,var(--e2)_5%,var(--card))] px-6 py-6 sm:px-8 sm:py-7'
                                : ''
                            }`}
                          >
                            <div
                              className={`flex flex-wrap items-baseline justify-between gap-3 border-b-2 pb-3 ${
                                meta.isCaseStudy && !hasCustomAccent
                                  ? 'border-[color-mix(in_srgb,var(--e2)_40%,var(--line))]'
                                  : 'border-[color-mix(in_srgb,var(--note-accent)_34%,var(--line))]'
                              }`}
                            >
                              <div className="flex min-w-[min(100%,240px)] flex-1 items-baseline gap-3">
                                {meta.isCaseStudy && (
                                  <span
                                    className={`shrink-0 text-sm font-bold whitespace-nowrap ${
                                      hasCustomAccent ? 'text-[var(--note-accent)]' : 'text-[var(--e2)]'
                                    }`}
                                  >
                                    Case Study
                                  </span>
                                )}
                                <h2 className="min-w-0 flex-1 font-display text-2xl font-extrabold tracking-tight text-[var(--ink)] sm:text-[1.75rem] sm:leading-[1.22]">
                                  {renderRichInline(meta.title)}
                                </h2>
                              </div>
                              {(roleInfo || meta.contextTag) && (
                                <span className="flex shrink-0 items-baseline gap-2.5 whitespace-nowrap text-sm font-semibold text-[var(--note-accent)]">
                                  {roleInfo && <span>{roleInfo.label}</span>}
                                  {meta.contextTag && (
                                    <span className="font-mono-num opacity-90">{meta.contextTag}</span>
                                  )}
                                </span>
                              )}
                            </div>

                            {blocks.length > 0 && (
                              <div className="mt-5 space-y-4 text-[var(--ink)]">
                                {blocks.map((blk, i) => {
                                  if (blk.kind === 'subheading') {
                                    return (
                                      <h3
                                        key={i}
                                        className={`font-display text-lg font-bold leading-snug text-[var(--note-accent)] sm:text-[1.3rem] ${
                                          i > 0 ? 'mt-7 border-t border-[var(--line)]/70 pt-5' : ''
                                        }`}
                                      >
                                        {renderRichInline(blk.text)}
                                      </h3>
                                    );
                                  }

                                  if (blk.kind === 'factbox') {
                                    const boxStyles = getTableSurfaceStyles(blk.color);
                                    return (
                                      <div
                                        key={i}
                                        style={boxStyles.boxStyle}
                                        className="my-5 rounded-xl border border-[color-mix(in_srgb,var(--note-accent)_30%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent)_7%,var(--card))] px-5 py-4 sm:px-6 sm:py-4.5"
                                      >
                                        <div
                                          style={boxStyles.boxTitleStyle}
                                          className="text-sm font-bold text-[var(--note-accent)]"
                                        >
                                          {blk.title || 'Key Fact'}
                                        </div>
                                        <div className="mt-1.5 text-[16px] leading-[1.72] text-[var(--ink)]">
                                          {renderRichInline(blk.text)}
                                        </div>
                                      </div>
                                    );
                                  }

                                  if (blk.kind === 'flow') {
                                    return (
                                      <FlowchartBlock
                                        key={i}
                                        label={blk.label}
                                        steps={blk.steps}
                                      />
                                    );
                                  }

                                  if (blk.kind === 'table') {
                                    const tblStyles = getTableSurfaceStyles(blk.color);
                                    return (
                                      <div
                                        key={i}
                                        style={tblStyles.wrapperStyle}
                                        className="my-5 overflow-x-auto rounded-xl border border-[color-mix(in_srgb,var(--note-accent)_26%,var(--line))] bg-[var(--card)]"
                                      >
                                        <table className="w-full border-collapse text-left text-[15px] sm:text-[16px]">
                                          <thead
                                            style={tblStyles.theadStyle}
                                            className="border-b-2 border-[color-mix(in_srgb,var(--note-accent)_38%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent)_12%,var(--card))]"
                                          >
                                            <tr>
                                              {blk.headers.map((h, hi) => (
                                                <th
                                                  key={hi}
                                                  className="px-5 py-3.5 text-[15px] font-bold text-[var(--ink)] sm:text-[16px]"
                                                >
                                                  {renderRichInline(h)}
                                                </th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-[var(--line)]">
                                            {blk.rows.map((row, ri) => (
                                              <tr
                                                key={ri}
                                                style={ri % 2 === 1 ? tblStyles.zebraStyle : undefined}
                                                className={
                                                  ri % 2 === 1 && !tblStyles.zebraStyle
                                                    ? 'bg-[color-mix(in_srgb,var(--note-accent)_4%,var(--card))]'
                                                    : ''
                                                }
                                              >
                                                {row.map((cell, ci) => (
                                                  <td
                                                    key={ci}
                                                    style={ci === 0 ? tblStyles.firstColStyle : undefined}
                                                    className={`px-5 py-3.5 align-top leading-[1.65] text-[var(--ink)] ${
                                                      ci === 0 && !tblStyles.firstColStyle
                                                        ? 'font-semibold text-[color-mix(in_srgb,var(--note-accent)_45%,var(--ink))]'
                                                        : ci === 0
                                                        ? 'font-semibold'
                                                        : ''
                                                    }`}
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

                                  if (blk.kind === 'paragraph') {
                                    return (
                                      <p
                                        key={i}
                                        className="whitespace-pre-line text-[16.5px] leading-[1.78] text-[var(--ink)] sm:text-[17px]"
                                      >
                                        {renderRichInline(blk.text)}
                                      </p>
                                    );
                                  }

                                  const isSubBullet = Boolean(blk.indent && blk.indent > 0);
                                  const kv = splitTermBullet(blk.text);
                                  if (kv) {
                                    return (
                                      <div
                                        key={i}
                                        className={`flex items-start gap-3 text-[16px] leading-[1.72] sm:text-[16.5px] ${
                                          isSubBullet ? 'pl-7' : 'pl-1'
                                        }`}
                                      >
                                        <span
                                          className={`mt-[11px] h-2 w-2 shrink-0 rounded-full ${
                                            isSubBullet
                                              ? 'border-[1.5px] border-[var(--note-accent)] bg-transparent'
                                              : 'bg-[var(--note-accent)]'
                                          }`}
                                          aria-hidden="true"
                                        />
                                        <div className="min-w-0 flex-1">
                                          <span className="font-bold text-[color-mix(in_srgb,var(--note-accent)_55%,var(--ink))]">
                                            {renderRichInline(kv.term)}:{' '}
                                          </span>
                                          <span className="text-[var(--ink)]/92">
                                            {renderRichInline(kv.body)}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div
                                      key={i}
                                      className={`flex items-start gap-3 text-[16px] leading-[1.72] sm:text-[16.5px] ${
                                        isSubBullet ? 'pl-7' : 'pl-1'
                                      }`}
                                    >
                                      <span
                                        className={`mt-[11px] h-2 w-2 shrink-0 rounded-full ${
                                          isSubBullet
                                            ? 'border-[1.5px] border-[var(--note-accent)] bg-transparent'
                                            : 'bg-[var(--note-accent)]'
                                        }`}
                                        aria-hidden="true"
                                      />
                                      <span className="min-w-0 flex-1">
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
                  ) : !activeTopic.notes.summary.trim() &&
                    !activeTopic.notes.keyTerms.length &&
                    directChildTopics.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-10 text-center">
                      <p className="text-base text-[var(--mute)]">
                        This topic doesn&apos;t have structured notes yet.
                      </p>
                      <div className="mt-5 flex flex-wrap justify-center gap-2.5">
                        {hasDocHtml && (
                          <button
                            type="button"
                            onClick={handleExtractStructuredFromDoc}
                            className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                          >
                            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Extract Notes from Document</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setViewMode('edit')}
                          className={
                            hasDocHtml
                              ? 'sd-btn px-4 py-2 text-xs whitespace-nowrap'
                              : 'sd-btn-pri px-4 py-2 text-xs whitespace-nowrap'
                          }
                        >
                          <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Write Notes</span>
                        </button>
                        <button
                          type="button"
                          onClick={onOpenImport}
                          className="sd-btn px-4 py-2 text-xs whitespace-nowrap"
                        >
                          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Paste / Import Notes</span>
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {/* Worked Example & Examiner Tip */}
                  {(activeTopic.notes.workedExample.trim() ||
                    activeTopic.notes.examTip.trim()) && (
                    <div
                      className={`grid gap-5 pt-2 ${
                        activeTopic.notes.workedExample.trim() &&
                        activeTopic.notes.examTip.trim()
                          ? 'lg:grid-cols-2'
                          : ''
                      }`}
                    >
                      {activeTopic.notes.workedExample.trim() && (
                        <section className="rounded-2xl border border-[color-mix(in_srgb,var(--ok)_34%,var(--line))] bg-[color-mix(in_srgb,var(--ok)_7%,var(--card))] p-6">
                          <div className="text-base font-bold text-[var(--ok)]">
                            Worked Example
                          </div>
                          <p className="mt-2.5 whitespace-pre-line text-[16px] leading-[1.72] text-[var(--ink)]">
                            {renderRichInline(activeTopic.notes.workedExample)}
                          </p>
                        </section>
                      )}

                      {activeTopic.notes.examTip.trim() && (
                        <section className="rounded-2xl border border-[color-mix(in_srgb,var(--e2)_40%,var(--line))] bg-[color-mix(in_srgb,var(--e2)_7%,var(--card))] p-6">
                          <div className="text-base font-bold text-[var(--e2)]">
                            Examiner Tip
                          </div>
                          <p className="mt-2.5 whitespace-pre-line text-[16px] leading-[1.72] text-[var(--ink)]">
                            {renderRichInline(activeTopic.notes.examTip)}
                          </p>
                        </section>
                      )}
                    </div>
                  )}

                  {/* Key Terms & Definitions Table + Explicit Make Flashcards */}
                  {activeTopic.notes.keyTerms.length > 0 && (
                    <section id="note-key-terms" className="scroll-mt-6 space-y-4 pt-2">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[color-mix(in_srgb,var(--note-accent)_32%,var(--line))] pb-3">
                        <button
                          type="button"
                          onClick={() => setGlossaryExpanded((v) => !v)}
                          className="flex cursor-pointer items-center gap-2.5 text-left"
                        >
                          {glossaryExpanded ? (
                            <ChevronDown className="h-5 w-5 text-[var(--note-accent)]" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-5 w-5 text-[var(--note-accent)]" aria-hidden="true" />
                          )}
                          <div>
                            <h2 className="font-display text-xl font-extrabold text-[var(--ink)] sm:text-2xl">
                              Key Terms &amp; Definitions ({activeTopic.notes.keyTerms.length})
                            </h2>
                            <p className="text-sm text-[var(--mute)]">
                              Click Make Flashcards whenever you want spaced-repetition cards from these terms.
                            </p>
                          </div>
                        </button>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setGlossaryExpanded((v) => !v)}
                            className="sd-btn px-3.5 py-1.5 text-xs whitespace-nowrap"
                          >
                            {glossaryExpanded ? 'Collapse' : 'Show Glossary'}
                          </button>
                          <button
                            type="button"
                            onClick={handleMakeFlashcardsFromTerms}
                            className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap shrink-0"
                          >
                            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Make Flashcards ({activeTopic.notes.keyTerms.length})</span>
                          </button>
                        </div>
                      </div>

                      {glossaryExpanded && (
                        <div className="overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--note-accent)_26%,var(--line))] bg-[var(--card)]">
                          {activeTopic.notes.keyTerms.length > 6 && (
                            <div className="border-b border-[var(--line)] bg-[var(--bg)] px-5 py-3">
                              <div className="relative max-w-sm">
                                <Search
                                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--mute)]"
                                  aria-hidden="true"
                                />
                                <input
                                  type="text"
                                  value={glossaryFilter}
                                  onChange={(e) => setGlossaryFilter(e.target.value)}
                                  placeholder="Filter glossary terms…"
                                  className="sd-input py-1.5 pl-9 text-sm"
                                />
                              </div>
                            </div>
                          )}
                          <table className="w-full border-collapse text-left text-[15.5px] sm:text-[16px]">
                            <thead className="border-b-2 border-[color-mix(in_srgb,var(--note-accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent)_11%,var(--card))]">
                              <tr>
                                <th className="w-1/3 px-5 py-3 font-bold text-[var(--ink)]">Term</th>
                                <th className="px-5 py-3 font-bold text-[var(--ink)]">Definition</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--line)]">
                              {filteredTerms.map((kt, idx) => (
                                <tr
                                  key={kt.id}
                                  className={
                                    idx % 2 === 1
                                      ? 'bg-[color-mix(in_srgb,var(--note-accent)_4%,var(--card))]'
                                      : ''
                                  }
                                >
                                  <td className="px-5 py-3.5 align-top font-bold text-[color-mix(in_srgb,var(--note-accent)_55%,var(--ink))]">
                                    {kt.term}
                                  </td>
                                  <td className="px-5 py-3.5 align-top leading-[1.65] text-[var(--ink)]/92">
                                    {kt.definition}
                                  </td>
                                </tr>
                              ))}
                              {filteredTerms.length === 0 && (
                                <tr>
                                  <td colSpan={2} className="px-5 py-5 text-sm text-[var(--mute)]">
                                    No key terms match &ldquo;{glossaryFilter}&rdquo;.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  )}

                  {/* Parent / Sibling Navigation Strip for Sub-topics */}
                  {(activeTreeNode?.parentTopic || siblingTopics.length > 1) && (() => {
                    const sibIdx = siblingTopics.findIndex((t) => t.id === activeTopic.id);
                    const prevSib = sibIdx > 0 ? siblingTopics[sibIdx - 1] : null;
                    const nextSib =
                      sibIdx >= 0 && sibIdx < siblingTopics.length - 1
                        ? siblingTopics[sibIdx + 1]
                        : null;
                    return (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-5 text-xs">
                        <div>
                          {activeTreeNode?.parentTopic && (
                            <button
                              type="button"
                              onClick={() => setSelectedTopicId(activeTreeNode.parentTopic!.id)}
                              className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                            >
                              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Back to {activeTreeNode.parentTopic.name}</span>
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {prevSib && (
                            <button
                              type="button"
                              onClick={() => setSelectedTopicId(prevSib.id)}
                              className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                            >
                              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                              <span className="max-w-[160px] truncate">{prevSib.name}</span>
                            </button>
                          )}
                          {nextSib && (
                            <button
                              type="button"
                              onClick={() => setSelectedTopicId(nextSib.id)}
                              className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                            >
                              <span className="max-w-[160px] truncate">{nextSib.name}</span>
                              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            {/* MODE 2: NOTION-STYLE BLOCK EDITOR */}
            {viewMode === 'edit' && (
              <NotionTopicEditor
                topicId={activeTopic.id}
                topicName={activeTopic.name}
                specCode={activeTopic.specCode}
                parentTopicId={activeTopic.parentTopicId}
                parentTopicOptions={parentTopicOptionsForEditor}
                notes={activeTopic.notes}
                onChangeTopicMeta={(fields) =>
                  updateTopic(activeTopic.id, (t) => {
                    const next: StudyTopic = {
                      ...t,
                      ...(fields.name !== undefined ? { name: fields.name } : {}),
                      ...(fields.specCode !== undefined ? { specCode: fields.specCode } : {}),
                    };
                    if (fields.parentTopicId !== undefined) {
                      if (fields.parentTopicId) {
                        next.parentTopicId = fields.parentTopicId;
                      } else {
                        delete next.parentTopicId;
                      }
                    }
                    return next;
                  })
                }
                onChangeNotes={replaceActiveNote}
                onMakeFlashcards={handleMakeFlashcardsFromTerms}
              />
            )}

            {/* MODE 3: HISTORY-ONLY STRUCTURED TIMELINE */}
            {viewMode === 'timeline' && isHistorySubject && (
              <div className="space-y-5">
                {/* Timeline Command & Study Toolbar */}
                <div className="sd-card space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--mute)]">
                      <Calendar className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                      <span className="font-mono-num font-bold text-[var(--ink)]">
                        {timelineEventsAll.length} event{timelineEventsAll.length === 1 ? '' : 's'}
                      </span>
                      {timelineEventsAll.some((e) => e.keyEvent) && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-num">
                            {timelineEventsAll.filter((e) => e.keyEvent).length} key turning points
                          </span>
                        </>
                      )}
                      {hideTimelineDates && timelineEventsAll.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-num text-xs font-semibold text-[var(--e3)]">
                            Dates {revealedDateIds.size}/{timelineEventsAll.length}
                          </span>
                        </>
                      )}
                      {hideTimelineEvents && timelineEventsAll.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-num text-xs font-semibold text-[var(--e2)]">
                            Events {revealedEventBodyIds.size}/{timelineEventsAll.length}
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {timelineEventsAll.length > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setHideTimelineDates((v) => !v);
                              setRevealedDateIds(new Set());
                            }}
                            className={`sd-btn px-3 py-1.5 text-xs whitespace-nowrap ${
                              hideTimelineDates ? 'border-[var(--e3)] text-[var(--e3)]' : ''
                            }`}
                          >
                            {hideTimelineDates ? (
                              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            <span>{hideTimelineDates ? 'Show Dates' : 'Hide Date'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setHideTimelineEvents((v) => !v);
                              setRevealedEventBodyIds(new Set());
                            }}
                            className={`sd-btn px-3 py-1.5 text-xs whitespace-nowrap ${
                              hideTimelineEvents ? 'border-[var(--e2)] text-[var(--e2)]' : ''
                            }`}
                          >
                            {hideTimelineEvents ? (
                              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            <span>{hideTimelineEvents ? 'Show Events' : 'Hide Event'}</span>
                          </button>

                          {timelineEras.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setColorTimelineEras((v) => !v)}
                              className={`sd-btn px-3 py-1.5 text-xs whitespace-nowrap ${
                                colorTimelineEras ? 'border-[var(--e3)] text-[var(--e3)]' : ''
                              }`}
                            >
                              <Palette className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>{colorTimelineEras ? 'Era Colours: On' : 'Colour Eras'}</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={handleMakeFlashcardsFromTimeline}
                            className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                          >
                            <Layers className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                            <span>Make Flashcards</span>
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setTimelineEditAll((v) => {
                            const next = !v;
                            if (!next) {
                              setAddEventOpen(false);
                              setBulkOpen(false);
                              setEditingEventId(null);
                              setExpandedActionEventId(null);
                            }
                            return next;
                          });
                        }}
                        className={`px-3.5 py-1.5 text-xs whitespace-nowrap ${
                          timelineEditAll
                            ? 'sd-btn-pri'
                            : 'sd-btn'
                        }`}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{timelineEditAll ? 'Done Editing' : 'Edit All'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Rolled-out Bulk & Add Management Tools (only shown when Edit All is enabled or timeline empty) */}
                  {(timelineEditAll || timelineEventsAll.length === 0) && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
                      <button
                        type="button"
                        onClick={() => setAddEventOpen((v) => !v)}
                        className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{addEventOpen ? 'Close Add Form' : 'Add Event'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBulkOpen((v) => !v);
                          setBulkFeedback(null);
                        }}
                        className={`sd-btn px-3 py-1.5 text-xs whitespace-nowrap ${
                          bulkOpen ? 'border-[var(--e3)] text-[var(--e3)]' : ''
                        }`}
                      >
                        <ListPlus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Bulk Import</span>
                      </button>
                      {timelineEventsAll.length > 1 && (
                        <button
                          type="button"
                          onClick={handleSortTimelineEvents}
                          className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                        >
                          <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Sort Chronologically</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Era Filter & Search Strip */}
                  {timelineEventsAll.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {timelineEras.length > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => setTimelineEraFilter('ALL')}
                              className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                                timelineEraFilter === 'ALL'
                                  ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--card))] text-[var(--e3)]'
                                  : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)] hover:text-[var(--ink)]'
                              }`}
                            >
                              All Eras
                            </button>
                            {timelineEras.map((era) => {
                              const eraHex = colorTimelineEras
                                ? getTimelineEraColor(era, timelineEras)
                                : null;
                              const isSelected = timelineEraFilter === era;
                              return (
                                <button
                                  key={era}
                                  type="button"
                                  onClick={() => setTimelineEraFilter(era)}
                                  style={
                                    eraHex
                                      ? {
                                          borderColor: isSelected
                                            ? eraHex
                                            : `color-mix(in srgb, ${eraHex} 45%, var(--line))`,
                                          backgroundColor: isSelected
                                            ? `color-mix(in srgb, ${eraHex} 18%, var(--card))`
                                            : `color-mix(in srgb, ${eraHex} 8%, var(--bg))`,
                                          color: eraHex,
                                        }
                                      : undefined
                                  }
                                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                                    eraHex
                                      ? ''
                                      : isSelected
                                      ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--card))] text-[var(--e3)]'
                                      : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)] hover:text-[var(--ink)]'
                                  }`}
                                >
                                  {eraHex && (
                                    <span
                                      className="h-2 w-2 rounded-full"
                                      style={{ backgroundColor: eraHex }}
                                    />
                                  )}
                                  <span>{era}</span>
                                </button>
                              );
                            })}
                          </>
                        )}
                        {timelineEventsAll.some((e) => e.keyEvent) && (
                          <button
                            type="button"
                            onClick={() => setTimelineKeyOnly((v) => !v)}
                            className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                              timelineKeyOnly
                                ? 'border-[var(--e2)] bg-[color-mix(in_srgb,var(--e2)_12%,var(--card))] text-[var(--e2)]'
                                : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)] hover:text-[var(--ink)]'
                            }`}
                          >
                            <Star className="h-3 w-3" aria-hidden="true" />
                            <span>Key Events Only</span>
                          </button>
                        )}
                      </div>

                      <div className="relative w-full sm:w-56">
                        <Search
                          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--mute)]"
                          aria-hidden="true"
                        />
                        <input
                          type="text"
                          value={timelineSearch}
                          onChange={(e) => setTimelineSearch(e.target.value)}
                          placeholder="Search dates or events…"
                          className="sd-input py-1 pl-8 text-xs"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {bulkFeedback && (
                  <div
                    role="status"
                    className="rounded-xl border border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_9%,var(--card))] px-4 py-2.5 text-xs font-semibold text-[var(--ink)]"
                  >
                    {bulkFeedback}
                  </div>
                )}

                {bulkOpen && (
                  <div className="sd-card space-y-3 border-[var(--e3)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-display text-sm font-bold text-[var(--ink)]">
                          Import Multiple Timeline Nodes at Once
                        </h3>
                        <p className="text-xs text-[var(--mute)]">
                          One event per line (<code className="font-mono-num">Date | Title | What happened | Significance | Era</code>), or paste a legacy{' '}
                          <code className="font-mono-num">edits-*</code> JSON block.
                        </p>
                      </div>
                      <span className="font-mono-num text-xs font-bold text-[var(--e3)]">
                        {parsedBulkNodes.length} node{parsedBulkNodes.length === 1 ? '' : 's'} detected
                      </span>
                    </div>

                    <textarea
                      rows={5}
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                      placeholder={
                        'Nov 1918 | Armistice Signed | Ended WWI fighting | Forced Kaiser abdication & led to "stab-in-the-back" myth | Weimar\nJun 1919 | Treaty of Versailles | Cut army to 100k & £6.6bn reparations | Caused lasting nationalist resentment | Weimar'
                      }
                      className="sd-input font-mono-num text-xs leading-relaxed"
                    />

                    {parsedBulkNodes.length > 0 && (
                      <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--bg)] p-2.5 text-xs">
                        {parsedBulkNodes.slice(0, 8).map((n, idx) => (
                          <div key={idx} className="flex items-start gap-2.5">
                            <span className="font-mono-num shrink-0 font-bold text-[var(--e3)]">
                              {n.date}
                            </span>
                            <span className="font-semibold text-[var(--ink)]">{n.title}</span>
                            {n.detail && (
                              <span className="truncate text-[var(--mute)]">— {n.detail}</span>
                            )}
                          </div>
                        ))}
                        {parsedBulkNodes.length > 8 && (
                          <div className="text-[11px] text-[var(--mute)]">
                            + {parsedBulkNodes.length - 8} more event(s)…
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--ink)]">
                        <input
                          type="checkbox"
                          checked={bulkAutoSort}
                          onChange={(e) => setBulkAutoSort(e.target.checked)}
                          className="accent-[var(--e3)]"
                        />
                        <span>Sort chronologically after importing</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setBulkOpen(false)}
                          className="sd-btn px-3 py-1.5 text-xs"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={parsedBulkNodes.length === 0}
                          onClick={handleBulkImportTimeline}
                          className="sd-btn-pri px-4 py-1.5 text-xs whitespace-nowrap"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>
                            Import {parsedBulkNodes.length || ''} Timeline Node
                            {parsedBulkNodes.length === 1 ? '' : 's'}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Collapsible Add Historical Event Form (auto-open if timeline empty) */}
                {(addEventOpen || timelineEventsAll.length === 0) && (
                  <form
                    onSubmit={handleAddTimelineEvent}
                    className="sd-card space-y-3 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-sm font-bold text-[var(--ink)]">
                        Add Timeline Event
                      </h3>
                      {timelineEventsAll.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setAddEventOpen(false)}
                          className="sd-btn h-7 w-7 p-0"
                          aria-label="Close form"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <div className="grid gap-2.5 sm:grid-cols-12">
                      <input
                        type="text"
                        required
                        value={tlDate}
                        onChange={(e) => setTlDate(e.target.value)}
                        placeholder="Date / Year (e.g. 27 Feb 1933)"
                        className="sd-input text-xs font-mono-num sm:col-span-3"
                      />
                      <input
                        type="text"
                        required
                        value={tlTitle}
                        onChange={(e) => setTlTitle(e.target.value)}
                        placeholder="Event title (e.g. Reichstag Fire)"
                        className="sd-input text-xs sm:col-span-6"
                      />
                      <input
                        type="text"
                        value={tlEra}
                        onChange={(e) => setTlEra(e.target.value)}
                        placeholder="Era (optional)"
                        className="sd-input text-xs sm:col-span-3"
                      />
                      <input
                        type="text"
                        value={tlDetail}
                        onChange={(e) => setTlDetail(e.target.value)}
                        placeholder="What happened (key facts / actors)"
                        className="sd-input text-xs sm:col-span-6"
                      />
                      <input
                        type="text"
                        value={tlSignificance}
                        onChange={(e) => setTlSignificance(e.target.value)}
                        placeholder="Why it mattered (significance / exam link)"
                        className="sd-input text-xs sm:col-span-6"
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--mute)]">
                        <input
                          type="checkbox"
                          checked={tlKeyEvent}
                          onChange={(e) => setTlKeyEvent(e.target.checked)}
                          className="accent-[var(--e2)]"
                        />
                        <span>Mark as Key Turning Point</span>
                      </label>
                      <button type="submit" className="sd-btn-pri px-4 py-1.5 text-xs whitespace-nowrap">
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Add to Timeline</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* Editorial Two-Column Chronological Track */}
                {filteredTimelineEvents.length === 0 ? (
                  <div className="sd-card p-6 text-center text-sm text-[var(--mute)]">
                    {timelineEventsAll.length === 0
                      ? `No History events for ${activeTopic.name} yet. Enter a date and event above or use Bulk Import.`
                      : 'No timeline events match your current era or search filter.'}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredTimelineEvents.map((ev) => {
                      const isDateHidden = hideTimelineDates && !revealedDateIds.has(ev.id);
                      const isEventHidden = hideTimelineEvents && !revealedEventBodyIds.has(ev.id);
                      const isEditingEv = editingEventId === ev.id;
                      const showNodeActions =
                        timelineEditAll || expandedActionEventId === ev.id;
                      const fullIdx = timelineEventsAll.findIndex((x) => x.id === ev.id);
                      const { what, why } = splitEventDetailAndSignificance(ev);
                      const eraHex = colorTimelineEras
                        ? getTimelineEraColor(ev.era, timelineEras)
                        : null;

                      return (
                        <div key={ev.id} className="flex items-stretch gap-3 sm:gap-5">
                          {/* Left Chronological Date Anchor */}
                          <div className="flex w-28 shrink-0 flex-col items-end pt-4 text-right sm:w-44">
                            <button
                              type="button"
                              onClick={() =>
                                setRevealedDateIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(ev.id)) next.delete(ev.id);
                                  else next.add(ev.id);
                                  return next;
                                })
                              }
                              style={
                                !isDateHidden && eraHex
                                  ? {
                                      borderColor: `color-mix(in srgb, ${eraHex} 55%, var(--line))`,
                                      backgroundColor: `color-mix(in srgb, ${eraHex} 12%, var(--card))`,
                                      color: eraHex,
                                    }
                                  : undefined
                              }
                              className={`font-mono-num cursor-pointer rounded-xl border px-3 py-1.5 text-sm font-extrabold tracking-tight transition-colors sm:text-base ${
                                isDateHidden
                                  ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_10%,var(--card))] text-[var(--e3)]'
                                  : eraHex
                                  ? ''
                                  : ev.keyEvent
                                  ? 'border-[color-mix(in_srgb,var(--e2)_50%,var(--line))] bg-[var(--card)] text-[var(--e2)]'
                                  : 'border-[var(--line)] bg-[var(--card)] text-[var(--ink)]'
                              }`}
                              title={isDateHidden ? 'Click to reveal date' : ev.date}
                            >
                              {isDateHidden ? 'Reveal Date' : ev.date}
                            </button>
                            {ev.era && (
                              <span
                                style={eraHex ? { color: eraHex } : undefined}
                                className={`mt-1.5 text-xs font-semibold sm:text-[13px] ${
                                  eraHex ? '' : 'text-[var(--mute)]'
                                }`}
                              >
                                {ev.era}
                              </span>
                            )}
                          </div>

                          {/* Center Spine & Node */}
                          <div className="relative flex w-5 shrink-0 justify-center">
                            <div
                              className="w-[2px]"
                              style={{
                                backgroundColor: eraHex
                                  ? `color-mix(in srgb, ${eraHex} 45%, var(--line))`
                                  : 'var(--line)',
                              }}
                              aria-hidden="true"
                            />
                            <span
                              style={
                                eraHex
                                  ? { backgroundColor: eraHex }
                                  : undefined
                              }
                              className={`absolute top-5 h-3.5 w-3.5 rounded-full border-2 border-[var(--bg)] ${
                                eraHex
                                  ? ''
                                  : ev.keyEvent
                                  ? 'bg-[var(--e2)]'
                                  : 'bg-[var(--e3)]'
                              }`}
                              aria-hidden="true"
                            />
                          </div>

                          {/* Right Event Card */}
                          <div className="min-w-0 flex-1 pb-2">
                            {isEditingEv ? (
                              <div className="sd-card space-y-2.5 p-4">
                                <div className="grid gap-2 sm:grid-cols-12">
                                  <input
                                    type="text"
                                    value={editEvDate}
                                    onChange={(e) => setEditEvDate(e.target.value)}
                                    placeholder="Date / Year"
                                    className="sd-input font-mono-num text-sm font-bold sm:col-span-3"
                                  />
                                  <input
                                    type="text"
                                    value={editEvTitle}
                                    onChange={(e) => setEditEvTitle(e.target.value)}
                                    placeholder="Event title"
                                    className="sd-input text-sm sm:col-span-6"
                                  />
                                  <input
                                    type="text"
                                    value={editEvEra}
                                    onChange={(e) => setEditEvEra(e.target.value)}
                                    placeholder="Era (optional)"
                                    className="sd-input text-sm sm:col-span-3"
                                  />
                                </div>
                                <textarea
                                  rows={2}
                                  value={editEvDetail}
                                  onChange={(e) => setEditEvDetail(e.target.value)}
                                  placeholder="What happened…"
                                  className="sd-input text-sm"
                                />
                                <textarea
                                  rows={2}
                                  value={editEvSignificance}
                                  onChange={(e) => setEditEvSignificance(e.target.value)}
                                  placeholder="Why it mattered / exam significance…"
                                  className="sd-input text-sm"
                                />
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--mute)]">
                                    <input
                                      type="checkbox"
                                      checked={editEvKeyEvent}
                                      onChange={(e) => setEditEvKeyEvent(e.target.checked)}
                                      className="accent-[var(--e2)]"
                                    />
                                    <span>Key Turning Point</span>
                                  </label>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setEditingEventId(null)}
                                      className="sd-btn px-3 py-1 text-xs"
                                    >
                                      <X className="h-3 w-3" aria-hidden="true" />
                                      <span>Cancel</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveTimelineEdit(ev.id)}
                                      className="sd-btn-pri px-3 py-1 text-xs"
                                    >
                                      <Check className="h-3 w-3" aria-hidden="true" />
                                      <span>Save</span>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div
                                style={
                                  eraHex
                                    ? {
                                        borderColor: `color-mix(in srgb, ${eraHex} 45%, var(--line))`,
                                        backgroundColor: `color-mix(in srgb, ${eraHex} 6%, var(--card))`,
                                      }
                                    : undefined
                                }
                                className={`sd-card p-5 transition-colors ${
                                  !eraHex && ev.keyEvent
                                    ? 'border-[color-mix(in_srgb,var(--e2)_50%,var(--line))]'
                                    : ''
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    {isEventHidden ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setRevealedEventBodyIds((prev) => {
                                            const next = new Set(prev);
                                            next.add(ev.id);
                                            return next;
                                          })
                                        }
                                        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--e2)] bg-[color-mix(in_srgb,var(--e2)_8%,var(--bg))] px-4 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--e2)_14%,var(--bg))]"
                                      >
                                        <div>
                                          <div className="text-sm font-bold text-[var(--e2)]">
                                            Event Hidden — Active Recall
                                          </div>
                                          <div className="mt-0.5 text-xs text-[var(--mute)]">
                                            Try to recall what happened on this date, then click to reveal
                                          </div>
                                        </div>
                                        <Eye className="h-4 w-4 shrink-0 text-[var(--e2)]" aria-hidden="true" />
                                      </button>
                                    ) : (
                                      <div
                                        onClick={
                                          hideTimelineEvents
                                            ? () =>
                                                setRevealedEventBodyIds((prev) => {
                                                  const next = new Set(prev);
                                                  next.delete(ev.id);
                                                  return next;
                                                })
                                            : undefined
                                        }
                                        className={hideTimelineEvents ? 'cursor-pointer' : undefined}
                                        title={
                                          hideTimelineEvents
                                            ? 'Click to hide this event again'
                                            : undefined
                                        }
                                      >
                                        {ev.keyEvent && (
                                          <div className="mb-1 text-xs font-bold uppercase tracking-wider text-[var(--e2)]">
                                            Key Turning Point
                                          </div>
                                        )}
                                        <h3 className="font-display text-lg font-bold leading-snug text-[var(--ink)] sm:text-xl">
                                          {ev.title}
                                        </h3>
                                      </div>
                                    )}
                                  </div>

                                  {/* Compact Pencil Button & Rolled-out Management Controls */}
                                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                                    {showNodeActions && (
                                      <div className="flex flex-wrap items-center gap-1 pr-1">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            updateTopic(activeTopic.id, (t) => ({
                                              ...t,
                                              timelineEvents: (t.timelineEvents || []).map((x) =>
                                                x.id === ev.id ? { ...x, keyEvent: !x.keyEvent } : x
                                              ),
                                            }))
                                          }
                                          aria-label={
                                            ev.keyEvent
                                              ? 'Unmark key turning point'
                                              : 'Mark as key turning point'
                                          }
                                          title="Toggle Key Turning Point"
                                          className={`sd-btn h-7 w-7 p-0 ${
                                            ev.keyEvent
                                              ? 'border-[var(--e2)] text-[var(--e2)]'
                                              : 'text-[var(--mute)]'
                                          }`}
                                        >
                                          <Star className="h-3.5 w-3.5" aria-hidden="true" />
                                        </button>
                                        <button
                                          type="button"
                                          disabled={fullIdx <= 0}
                                          onClick={() => handleMoveTimelineEvent(ev.id, -1)}
                                          aria-label="Move event earlier"
                                          title="Move earlier"
                                          className="sd-btn h-7 w-7 p-0 disabled:opacity-35"
                                        >
                                          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                                        </button>
                                        <button
                                          type="button"
                                          disabled={fullIdx >= timelineEventsAll.length - 1}
                                          onClick={() => handleMoveTimelineEvent(ev.id, 1)}
                                          aria-label="Move event later"
                                          title="Move later"
                                          className="sd-btn h-7 w-7 p-0 disabled:opacity-35"
                                        >
                                          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const split = splitEventDetailAndSignificance(ev);
                                            setEditingEventId(ev.id);
                                            setEditEvDate(ev.date);
                                            setEditEvTitle(ev.title);
                                            setEditEvDetail(split.what);
                                            setEditEvSignificance(split.why);
                                            setEditEvEra(ev.era || '');
                                            setEditEvKeyEvent(Boolean(ev.keyEvent));
                                          }}
                                          aria-label="Edit timeline fields"
                                          title="Edit date, title & significance"
                                          className="sd-btn h-7 px-2 text-xs text-[var(--ink)]"
                                        >
                                          <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                                          <span className="hidden sm:inline">Edit</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            updateTopic(activeTopic.id, (t) => ({
                                              ...t,
                                              timelineEvents: (t.timelineEvents || []).filter(
                                                (x) => x.id !== ev.id
                                              ),
                                            }))
                                          }
                                          aria-label="Delete timeline event"
                                          title="Delete event"
                                          className="sd-btn h-7 w-7 p-0 text-[var(--bad)]"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                        </button>
                                      </div>
                                    )}

                                    {!timelineEditAll && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setExpandedActionEventId((prev) =>
                                            prev === ev.id ? null : ev.id
                                          )
                                        }
                                        aria-expanded={expandedActionEventId === ev.id}
                                        aria-label={
                                          expandedActionEventId === ev.id
                                            ? 'Hide node management buttons'
                                            : 'Expand node management buttons'
                                        }
                                        title={
                                          expandedActionEventId === ev.id
                                            ? 'Hide edit buttons'
                                            : 'Manage / Edit node'
                                        }
                                        className={`sd-btn h-7 w-7 p-0 ${
                                          expandedActionEventId === ev.id
                                            ? 'border-[var(--e3)] text-[var(--e3)]'
                                            : 'text-[var(--mute)]'
                                        }`}
                                      >
                                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {!isEventHidden && (what || why) && (
                                  <div className="mt-2.5 space-y-2 text-[15px] leading-relaxed sm:text-base">
                                    {what && <p className="text-[var(--ink)]/90">{what}</p>}
                                    {why && (
                                      <p className="rounded-lg bg-[var(--bg)] px-3.5 py-2 text-xs leading-relaxed text-[var(--mute)] sm:text-sm">
                                        <span className="font-bold text-[var(--e3)]">
                                          Significance:{' '}
                                        </span>
                                        {why}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          );
        })()}
      </div>
    </div>
  );
}

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
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
  Eye,
  EyeOff,
  FileCheck2,
  FolderPlus,
  Globe,
  Heading2,
  Highlighter,
  Italic,
  Layers,
  List,
  ListOrdered,
  ListPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Share2,
  Star,
  Trash2,
  Underline,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { sanitizeDocumentHtml } from '../lib/documentRenderer';
import {
  createEmptyStructuredNote,
  estimateNoteReadingMinutes,
  groupSectionPoints,
} from '../lib/noteFormat';
import { parseBulkTimelineNodes } from '../lib/smartImporter';
import {
  buildTopicTreeList,
  deleteTopicPromotingChildren,
  getTopicDescendantIds,
  makeId,
} from '../lib/workspaceStore';
import {
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

function renderInlineBold(text: string) {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-[var(--ink)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={i} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={i}
          className="font-mono-num rounded bg-[var(--bg)] px-1.5 py-0.5 text-[0.9em] text-[var(--e3)]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function cleanSectionTitle(heading: string): {
  title: string;
  isCaseStudy: boolean;
  contextTag?: string;
} {
  let raw = String(heading || '').replace(/^\d+[.)]\s*/, '').trim();
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
  const [preferStructuredInRead, setPreferStructuredInRead] = useState(false);
  const [docZoom, setDocZoom] = useState<number>(100);
  const [editingDocHtml, setEditingDocHtml] = useState(false);
  const docEditorRef = useRef<HTMLDivElement | null>(null);
  const prevTopicIdRef = useRef<string | null>(null);
  const [newTopicName, setNewTopicName] = useState('');
  const [addingTopic, setAddingTopic] = useState(false);
  const [addingParentTopicId, setAddingParentTopicId] = useState<string | null>(null);
  const [collapsedTopicIds, setCollapsedTopicIds] = useState<Set<string>>(() => new Set());
  const [confirmDeleteTopicId, setConfirmDeleteTopicId] = useState<string | null>(null);
  const [cardsFeedback, setCardsFeedback] = useState<string | null>(null);
  const [glossaryExpanded, setGlossaryExpanded] = useState(false);
  const [glossaryFilter, setGlossaryFilter] = useState('');

  // History Timeline state
  const [hideTimelineDates, setHideTimelineDates] = useState(false);
  const [revealedEventIds, setRevealedEventIds] = useState<Set<string>>(new Set());
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
        setPreferStructuredInRead(false);
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
      setPreferStructuredInRead(false);
      setEditingEventId(null);
      setTimelineEraFilter('ALL');
      setTimelineSearch('');
      setTimelineKeyOnly(false);
      setGlossaryFilter('');
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

  const execDocCommand = (cmd: string, value?: string) => {
    if (!docEditorRef.current) return;
    docEditorRef.current.focus();
    try {
      document.execCommand(cmd, false, value);
    } catch {
      // ignore unsupported command
    }
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

            {/* Hierarchical Topic Tree List */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-visible lg:pb-0">
              {topicTreeNodes
                .filter(
                  (node) => !node.ancestors.some((anc) => collapsedTopicIds.has(anc.id))
                )
                .map((node) => {
                  const tp = node.topic;
                  const selected = tp.id === activeTopic?.id;
                  const isCollapsed = collapsedTopicIds.has(tp.id);
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
                      className={`group flex shrink-0 items-center gap-1 rounded-xl border pr-1 transition-colors lg:w-full ${indentClass} ${
                        selected
                          ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--bg))]'
                          : 'border-transparent hover:bg-[var(--bg)]'
                      }`}
                    >
                      {node.childCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggleTopicCollapsed(tp.id)}
                          aria-label={
                            isCollapsed
                              ? `Expand sub-topics of ${tp.name}`
                              : `Collapse sub-topics of ${tp.name}`
                          }
                          className="ml-1 flex h-6 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-[var(--mute)] hover:text-[var(--ink)]"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                        </button>
                      ) : node.depth > 0 ? (
                        <CornerDownRight
                          className="ml-1.5 h-3 w-3 shrink-0 text-[var(--mute)]/60"
                          aria-hidden="true"
                        />
                      ) : (
                        <span className="hidden w-1.5 shrink-0 lg:block" aria-hidden="true" />
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
                          {node.childCount > 0 && (
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
      <div className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        {!activeTopic ? (
          <div className="mx-auto max-w-2xl sd-card p-6 text-center text-sm text-[var(--mute)]">
            Select or create a topic on the left to start writing structured notes.
          </div>
        ) : (
          <div className="mx-auto space-y-6" style={{ maxWidth: 'var(--mw, 860px)' }}>
            {/* Topic Header & Action Toolbar */}
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] pb-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--mute)]">
                  {sidebarCompressed && (
                    <>
                      <button
                        type="button"
                        onClick={toggleSidebarCompressed}
                        className="cursor-pointer font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                      >
                        Show Topics ({subjectTopics.length})
                      </button>
                      <span aria-hidden="true">·</span>
                    </>
                  )}
                  <span>{activeSubject?.name}</span>
                  {activeTreeNode?.ancestors.map((anc) => (
                    <span key={anc.id} className="inline-flex items-center gap-1.5">
                      <ChevronRight className="h-3 w-3 opacity-70" aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => setSelectedTopicId(anc.id)}
                        className="cursor-pointer font-semibold text-[var(--e3)] hover:underline"
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
                  <span className="inline-flex items-center gap-1 font-mono-num">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {estimateNoteReadingMinutes(activeTopic.notes)} min read
                  </span>
                </div>
                {viewMode !== 'edit' && (
                  <h1 className="font-display mt-1 text-2xl font-extrabold tracking-tight text-[var(--ink)] sm:text-3xl">
                    {activeTopic.name}
                  </h1>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="sd-seg" role="tablist" aria-label="Note mode">
                  <button
                    type="button"
                    aria-pressed={viewMode === 'read'}
                    onClick={() => setViewMode('read')}
                    className="sd-seg-btn"
                  >
                    Read
                  </button>
                  <button
                    type="button"
                    aria-pressed={viewMode === 'edit'}
                    onClick={() => setViewMode('edit')}
                    className="sd-seg-btn"
                  >
                    Edit
                  </button>
                  {isHistorySubject && (
                    <button
                      type="button"
                      aria-pressed={viewMode === 'timeline'}
                      onClick={() => setViewMode('timeline')}
                      className="sd-seg-btn"
                    >
                      Timeline ({activeTopic.timelineEvents?.length || 0})
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => startAddingTopic(activeTopic.id)}
                  title={`Create a sub-topic under ${activeTopic.name}`}
                  className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                >
                  <FolderPlus className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
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
              const hasStructuredContent =
                Boolean(activeTopic.notes.summary.trim()) ||
                populatedSections.some((s) => s.points.length > 0) ||
                activeTopic.notes.keyTerms.length > 0 ||
                Boolean(activeTopic.notes.workedExample.trim()) ||
                Boolean(activeTopic.notes.examTip.trim());

              const showDocumentInRead =
                hasDocHtml &&
                activeTopic.notes.preferOriginalFormat !== false &&
                !preferStructuredInRead;

              if (showDocumentInRead) {
                return (
                  <div className="space-y-4">
                    {/* Compact Document Controls inside Read */}
                    <div className="sd-card flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 font-bold text-[var(--e3)]">
                          <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Document View</span>
                        </span>
                        <span aria-hidden="true" className="text-[var(--line)]">|</span>
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
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {hasStructuredContent && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingDocHtml(false);
                              setPreferStructuredInRead(true);
                            }}
                            className="sd-btn px-3 py-1 text-xs whitespace-nowrap"
                          >
                            <BookOpen className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                            <span>Structured Notes</span>
                          </button>
                        )}

                        {!isPdfPageDoc && (
                          <button
                            type="button"
                            onClick={() => {
                              if (editingDocHtml) {
                                commitDocumentHtmlEdit(true);
                              } else {
                                setEditingDocHtml(true);
                              }
                            }}
                            className={
                              editingDocHtml
                                ? 'sd-btn-pri px-3 py-1 text-xs whitespace-nowrap'
                                : 'sd-btn px-3 py-1 text-xs whitespace-nowrap'
                            }
                          >
                            {editingDocHtml ? (
                              <>
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Save Document</span>
                              </>
                            ) : (
                              <>
                                <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Edit Document</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline Word/Docs Formatting Ribbon when Editing Document */}
                    {editingDocHtml && !isPdfPageDoc && (
                      <div className="sd-card sticky top-2 z-20 flex flex-wrap items-center gap-1 px-3 py-2 text-xs">
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
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            execDocCommand('hiliteColor', '#fef08a');
                          }}
                          title="Highlight Yellow"
                          className="sd-btn h-7 w-7 p-0"
                        >
                          <Highlighter className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden="true" />
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            execDocCommand('formatBlock', '<h2>');
                          }}
                          title="Heading 2"
                          className="sd-btn h-7 w-7 p-0"
                        >
                          <Heading2 className="h-3.5 w-3.5" aria-hidden="true" />
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
                    )}

                    {/* Theme-Matched Document Canvas */}
                    <div className="sd-doc-canvas">
                      <div
                        className="mx-auto transition-[max-width] duration-150"
                        style={{
                          maxWidth:
                            docZoom === 85 ? '700px' : docZoom === 115 ? '980px' : '820px',
                          fontSize:
                            docZoom === 85 ? '0.9em' : docZoom === 115 ? '1.12em' : undefined,
                        }}
                      >
                        {editingDocHtml && !isPdfPageDoc ? (
                          <div
                            ref={docEditorRef}
                            contentEditable
                            suppressContentEditableWarning
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

              let theorySectionCounter = 0;
              const filteredTerms = activeTopic.notes.keyTerms.filter((kt) => {
                if (!glossaryFilter.trim()) return true;
                const q = glossaryFilter.trim().toLowerCase();
                return (kt.term + ' ' + kt.definition).toLowerCase().includes(q);
              });

              return (
                <div className="space-y-6 text-[15px] leading-relaxed">
                  {hasDocHtml && (
                    <div className="sd-card flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink)]">
                        <FileCheck2 className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                        <span>Showing structured notes view</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setPreferStructuredInRead(false);
                          if (!activeTopic.notes.preferOriginalFormat) {
                            replaceActiveNote({
                              ...activeTopic.notes,
                              preferOriginalFormat: true,
                            });
                          }
                        }}
                        className="sd-btn px-3 py-1 text-xs font-semibold text-[var(--e3)] whitespace-nowrap"
                      >
                        <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Original Document View</span>
                      </button>
                    </div>
                  )}

                  {/* Quick Section Jump Index (TOC) */}
                  {populatedSections.length >= 2 && (
                    <nav
                      aria-label="Topic section contents"
                      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-[var(--line)] pb-3 text-xs"
                    >
                      <span className="font-bold text-[var(--mute)]">Jump to:</span>
                      {populatedSections.map((sec, idx) => {
                        const meta = cleanSectionTitle(sec.heading);
                        return (
                          <a
                            key={sec.id}
                            href={`#note-sec-${sec.id}`}
                            className="inline-flex items-baseline gap-1 font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                          >
                            <span className="font-mono-num text-[11px] opacity-75">
                              {meta.isCaseStudy ? 'CS' : String(idx + 1).padStart(2, '0')}
                            </span>
                            <span className="max-w-[180px] truncate">{meta.title}</span>
                          </a>
                        );
                      })}
                      {activeTopic.notes.keyTerms.length > 0 && (
                        <a
                          href="#note-key-terms"
                          className="font-semibold text-[var(--mute)] hover:text-[var(--ink)] hover:underline whitespace-nowrap"
                        >
                          Key Terms ({activeTopic.notes.keyTerms.length})
                        </a>
                      )}
                    </nav>
                  )}

                  {/* Summary Callout */}
                  {activeTopic.notes.summary.trim() ? (
                    <section className="sd-card p-6">
                      <div className="text-xs font-bold uppercase tracking-wider text-[var(--e3)]">
                        Topic Overview
                      </div>
                      <p className="mt-2 max-w-[72ch] whitespace-pre-line text-[15px] leading-[1.7] text-[var(--ink)]">
                        {renderInlineBold(activeTopic.notes.summary)}
                      </p>
                    </section>
                  ) : null}

                  {/* Nested Sub-topics Index Card */}
                  {directChildTopics.length > 0 && (
                    <section className="sd-card overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <CornerDownRight
                            className="h-4 w-4 text-[var(--e3)]"
                            aria-hidden="true"
                          />
                          <h2 className="font-display text-sm font-bold text-[var(--ink)] sm:text-base">
                            Sub-topics ({directChildTopics.length})
                          </h2>
                        </div>
                        <div className="flex items-center gap-2">
                          {populatedSections.length === 0 && !activeTopic.notes.summary.trim() && (
                            <button
                              type="button"
                              onClick={() => setViewMode('edit')}
                              className="sd-btn px-2.5 py-1 text-xs whitespace-nowrap"
                            >
                              <Edit3 className="h-3 w-3" aria-hidden="true" />
                              <span>Write Overview</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => startAddingTopic(activeTopic.id)}
                            className="sd-btn-pri px-2.5 py-1 text-xs whitespace-nowrap"
                          >
                            <Plus className="h-3 w-3" aria-hidden="true" />
                            <span>Add Sub-topic</span>
                          </button>
                        </div>
                      </div>
                      <div className="grid gap-px bg-[var(--line)] sm:grid-cols-2">
                        {directChildTopics.map((child) => {
                          const childSubCount = subjectTopics.filter(
                            (t) => t.parentTopicId === child.id
                          ).length;
                          const secCount = child.notes.sections.filter(
                            (s) => s.points.length > 0
                          ).length;
                          return (
                            <button
                              key={child.id}
                              type="button"
                              onClick={() => setSelectedTopicId(child.id)}
                              className="flex cursor-pointer items-center justify-between gap-3 bg-[var(--card)] px-4 py-3 text-left transition-colors hover:bg-[var(--bg)]"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  {child.specCode && (
                                    <span className="font-mono-num shrink-0 text-[11px] font-bold text-[var(--e3)]">
                                      {child.specCode}
                                    </span>
                                  )}
                                  <span className="truncate text-sm font-bold text-[var(--ink)]">
                                    {child.name}
                                  </span>
                                  {child.completed && (
                                    <CheckCircle2
                                      className="h-3.5 w-3.5 shrink-0 text-[var(--ok)]"
                                      aria-label="Studied"
                                    />
                                  )}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-[var(--mute)]">
                                  {child.notes.summary.trim()
                                    ? child.notes.summary.trim()
                                    : `${secCount} section${secCount === 1 ? '' : 's'} · ${estimateNoteReadingMinutes(child.notes)} min read${
                                        childSubCount > 0 ? ` · ${childSubCount} sub-topic${childSubCount === 1 ? '' : 's'}` : ''
                                      }`}
                                </div>
                              </div>
                              <ArrowRight
                                className="h-4 w-4 shrink-0 text-[var(--mute)]"
                                aria-hidden="true"
                              />
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* Specification Sections */}
                  {populatedSections.length > 0 ? (
                    <div className="space-y-5">
                      {populatedSections.map((sec) => {
                        const meta = cleanSectionTitle(sec.heading);
                        if (!meta.isCaseStudy) theorySectionCounter += 1;
                        const sectionNumber = String(theorySectionCounter).padStart(2, '0');
                        const blocks = groupSectionPoints(sec.points);

                        return (
                          <section
                            id={`note-sec-${sec.id}`}
                            key={sec.id}
                            className={`sd-card scroll-mt-4 p-6 ${
                              meta.isCaseStudy
                                ? 'border-[color-mix(in_srgb,var(--e2)_45%,var(--line))] bg-[color-mix(in_srgb,var(--e2)_3%,var(--card))]'
                                : ''
                            }`}
                          >
                            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] pb-3">
                              <div className="flex min-w-0 items-baseline gap-3">
                                {meta.isCaseStudy ? (
                                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--e2)] whitespace-nowrap">
                                    Case Study
                                  </span>
                                ) : (
                                  <span className="font-mono-num text-sm font-bold text-[var(--e3)]">
                                    {sectionNumber}.
                                  </span>
                                )}
                                <h2 className="font-display text-lg font-bold text-[var(--ink)] sm:text-xl">
                                  {meta.title}
                                </h2>
                              </div>
                              {meta.contextTag && (
                                <span className="font-mono-num text-xs font-semibold text-[var(--mute)]">
                                  {meta.contextTag}
                                </span>
                              )}
                            </div>

                            {blocks.length > 0 && (
                              <div className="mt-4 space-y-3.5 text-[var(--ink)]">
                                {blocks.map((blk, i) => {
                                  if (blk.kind === 'subheading') {
                                    return (
                                      <h3
                                        key={i}
                                        className={`font-display text-[15px] font-bold text-[var(--e3)] ${
                                          i > 0 ? 'mt-5 border-t border-[var(--line)] pt-4' : ''
                                        }`}
                                      >
                                        {renderInlineBold(blk.text)}
                                      </h3>
                                    );
                                  }

                                  if (blk.kind === 'factbox') {
                                    return (
                                      <div
                                        key={i}
                                        className="my-2.5 rounded-xl border border-[color-mix(in_srgb,var(--e3)_30%,var(--line))] border-l-4 border-l-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_6%,var(--bg))] px-4 py-3"
                                      >
                                        <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--e3)]">
                                          {blk.title || 'Key Fact'}
                                        </div>
                                        <div className="mt-1 text-sm leading-relaxed text-[var(--ink)]">
                                          {renderInlineBold(blk.text)}
                                        </div>
                                      </div>
                                    );
                                  }

                                  if (blk.kind === 'flow') {
                                    return (
                                      <div
                                        key={i}
                                        className="my-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4"
                                      >
                                        {blk.label && (
                                          <div className="mb-2.5 text-xs font-bold text-[var(--e3)]">
                                            {blk.label}
                                          </div>
                                        )}
                                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch">
                                          {blk.steps.map((step, sIdx) => (
                                            <div
                                              key={sIdx}
                                              className="flex items-center gap-2 sm:max-w-[240px]"
                                            >
                                              <div className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-xs leading-snug text-[var(--ink)]">
                                                <span className="font-mono-num mr-1.5 font-bold text-[var(--e3)]">
                                                  {sIdx + 1}.
                                                </span>
                                                {renderInlineBold(step)}
                                              </div>
                                              {sIdx < blk.steps.length - 1 && (
                                                <ArrowRight
                                                  className="hidden h-3.5 w-3.5 shrink-0 text-[var(--mute)] sm:block"
                                                  aria-hidden="true"
                                                />
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  }

                                  if (blk.kind === 'table') {
                                    return (
                                      <div
                                        key={i}
                                        className="my-2 overflow-x-auto rounded-xl border border-[var(--line)]"
                                      >
                                        <table className="w-full border-collapse text-left text-xs sm:text-sm">
                                          <thead className="border-b border-[var(--line)] bg-[var(--bg)]">
                                            <tr>
                                              {blk.headers.map((h, hi) => (
                                                <th
                                                  key={hi}
                                                  className="px-4 py-2.5 font-bold text-[var(--ink)]"
                                                >
                                                  {renderInlineBold(h)}
                                                </th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-[var(--line)]">
                                            {blk.rows.map((row, ri) => (
                                              <tr
                                                key={ri}
                                                className={
                                                  ri % 2 === 1
                                                    ? 'bg-[color-mix(in_srgb,var(--bg)_55%,var(--card))]'
                                                    : ''
                                                }
                                              >
                                                {row.map((cell, ci) => (
                                                  <td
                                                    key={ci}
                                                    className="px-4 py-2.5 align-top leading-relaxed text-[var(--ink)]"
                                                  >
                                                    {renderInlineBold(cell)}
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
                                        className="max-w-[72ch] whitespace-pre-line leading-[1.7] text-[var(--ink)]"
                                      >
                                        {renderInlineBold(blk.text)}
                                      </p>
                                    );
                                  }

                                  const isSubBullet = Boolean(blk.indent && blk.indent > 0);
                                  const kv = splitTermBullet(blk.text);
                                  if (kv) {
                                    return (
                                      <div
                                        key={i}
                                        className={`flex items-start gap-2.5 leading-relaxed ${
                                          isSubBullet ? 'pl-6' : 'pl-1'
                                        }`}
                                      >
                                        <span
                                          className={`mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                                            isSubBullet
                                              ? 'border border-[var(--e3)] bg-transparent'
                                              : 'bg-[var(--e3)]'
                                          }`}
                                          aria-hidden="true"
                                        />
                                        <div className="max-w-[72ch]">
                                          <span className="font-bold text-[var(--ink)]">
                                            {kv.term}:{' '}
                                          </span>
                                          <span className="text-[var(--ink)]/90">
                                            {renderInlineBold(kv.body)}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div
                                      key={i}
                                      className={`flex items-start gap-2.5 leading-relaxed ${
                                        isSubBullet ? 'pl-6' : 'pl-1'
                                      }`}
                                    >
                                      <span
                                        className={`mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                                          isSubBullet
                                            ? 'border border-[var(--mute)] bg-transparent'
                                            : 'bg-[var(--mute)]'
                                        }`}
                                        aria-hidden="true"
                                      />
                                      <span className="max-w-[72ch]">
                                        {renderInlineBold(blk.text)}
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
                    !activeTopic.notes.legacyHtml &&
                    directChildTopics.length === 0 ? (
                    <div className="sd-card p-8 text-center">
                      <p className="text-sm text-[var(--mute)]">
                        This topic doesn&apos;t have structured notes yet.
                      </p>
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => setViewMode('edit')}
                          className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                        >
                          <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Write in Notion Editor</span>
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
                      className={`grid gap-4 ${
                        activeTopic.notes.workedExample.trim() &&
                        activeTopic.notes.examTip.trim()
                          ? 'lg:grid-cols-2'
                          : ''
                      }`}
                    >
                      {activeTopic.notes.workedExample.trim() && (
                        <section className="sd-card p-5">
                          <div className="text-xs font-bold uppercase tracking-wider text-[var(--ok)]">
                            Worked Example
                          </div>
                          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--ink)]">
                            {renderInlineBold(activeTopic.notes.workedExample)}
                          </p>
                        </section>
                      )}

                      {activeTopic.notes.examTip.trim() && (
                        <section className="sd-card border-[var(--e2)] p-5">
                          <div className="text-xs font-bold uppercase tracking-wider text-[var(--e2)]">
                            Examiner Tip
                          </div>
                          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[var(--ink)]">
                            {renderInlineBold(activeTopic.notes.examTip)}
                          </p>
                        </section>
                      )}
                    </div>
                  )}

                  {/* Key Terms & Definitions Table + Explicit Make Flashcards */}
                  {activeTopic.notes.keyTerms.length > 0 && (
                    <section id="note-key-terms" className="sd-card scroll-mt-4 overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-4">
                        <button
                          type="button"
                          onClick={() => setGlossaryExpanded((v) => !v)}
                          className="flex cursor-pointer items-center gap-2 text-left"
                        >
                          {glossaryExpanded ? (
                            <ChevronDown className="h-4 w-4 text-[var(--mute)]" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-[var(--mute)]" aria-hidden="true" />
                          )}
                          <div>
                            <h2 className="font-display text-base font-bold text-[var(--ink)] sm:text-lg">
                              Key Terms &amp; Definitions ({activeTopic.notes.keyTerms.length})
                            </h2>
                            <p className="text-xs text-[var(--mute)]">
                              Click Make Flashcards whenever you want spaced-repetition cards from these terms.
                            </p>
                          </div>
                        </button>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setGlossaryExpanded((v) => !v)}
                            className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
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
                        <>
                          {activeTopic.notes.keyTerms.length > 6 && (
                            <div className="border-b border-[var(--line)] bg-[var(--bg)] px-6 py-2.5">
                              <div className="relative max-w-xs">
                                <Search
                                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--mute)]"
                                  aria-hidden="true"
                                />
                                <input
                                  type="text"
                                  value={glossaryFilter}
                                  onChange={(e) => setGlossaryFilter(e.target.value)}
                                  placeholder="Filter glossary terms…"
                                  className="sd-input py-1 pl-8 text-xs"
                                />
                              </div>
                            </div>
                          )}
                          <div className="divide-y divide-[var(--line)]">
                            {filteredTerms.map((kt) => (
                              <div
                                key={kt.id}
                                className="grid gap-1.5 px-6 py-3 text-sm sm:grid-cols-3 sm:gap-4"
                              >
                                <div className="font-bold text-[var(--ink)]">{kt.term}</div>
                                <div className="text-[var(--mute)] sm:col-span-2">
                                  {kt.definition}
                                </div>
                              </div>
                            ))}
                            {filteredTerms.length === 0 && (
                              <div className="px-6 py-4 text-xs text-[var(--mute)]">
                                No key terms match &ldquo;{glossaryFilter}&rdquo;.
                              </div>
                            )}
                          </div>
                        </>
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
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-4 text-xs">
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
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mute)]">
                      <Calendar className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                      <span className="font-mono-num font-semibold text-[var(--ink)]">
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
                          <span className="font-mono-num font-semibold text-[var(--e3)]">
                            Revealed {revealedEventIds.size}/{timelineEventsAll.length}
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAddEventOpen((v) => !v)}
                        className={`sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap`}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Add Event</span>
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
                      {timelineEventsAll.length > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setHideTimelineDates((v) => !v);
                              setRevealedEventIds(new Set());
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
                            <span>{hideTimelineDates ? 'Show Dates' : 'Date Recall Test'}</span>
                          </button>
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
                    </div>
                  </div>

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
                            {timelineEras.map((era) => (
                              <button
                                key={era}
                                type="button"
                                onClick={() => setTimelineEraFilter(era)}
                                className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                                  timelineEraFilter === era
                                    ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--card))] text-[var(--e3)]'
                                    : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)] hover:text-[var(--ink)]'
                                }`}
                              >
                                {era}
                              </button>
                            ))}
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
                  <div className="sd-card p-6 text-center text-xs text-[var(--mute)]">
                    {timelineEventsAll.length === 0
                      ? `No History events for ${activeTopic.name} yet. Enter a date and event above or use Bulk Import.`
                      : 'No timeline events match your current era or search filter.'}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredTimelineEvents.map((ev) => {
                      const isHidden = hideTimelineDates && !revealedEventIds.has(ev.id);
                      const isEditingEv = editingEventId === ev.id;
                      const fullIdx = timelineEventsAll.findIndex((x) => x.id === ev.id);
                      const { what, why } = splitEventDetailAndSignificance(ev);

                      return (
                        <div key={ev.id} className="flex items-stretch gap-3 sm:gap-5">
                          {/* Left Chronological Date Anchor */}
                          <div className="flex w-24 shrink-0 flex-col items-end pt-4 text-right sm:w-36">
                            <button
                              type="button"
                              onClick={() =>
                                setRevealedEventIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(ev.id)) next.delete(ev.id);
                                  else next.add(ev.id);
                                  return next;
                                })
                              }
                              className={`font-mono-num cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors ${
                                isHidden
                                  ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_10%,var(--card))] text-[var(--e3)]'
                                  : ev.keyEvent
                                  ? 'border-[color-mix(in_srgb,var(--e2)_50%,var(--line))] bg-[var(--card)] text-[var(--e2)]'
                                  : 'border-[var(--line)] bg-[var(--card)] text-[var(--ink)]'
                              }`}
                              title={isHidden ? 'Click to reveal date' : ev.date}
                            >
                              {isHidden ? 'Reveal Date' : ev.date}
                            </button>
                            {ev.era && (
                              <span className="mt-1 text-[11px] font-medium text-[var(--mute)]">
                                {ev.era}
                              </span>
                            )}
                          </div>

                          {/* Center Spine & Node */}
                          <div className="relative flex w-4 shrink-0 justify-center">
                            <div
                              className="w-px bg-[var(--line)]"
                              aria-hidden="true"
                            />
                            <span
                              className={`absolute top-5 h-3 w-3 rounded-full border-2 border-[var(--bg)] ${
                                ev.keyEvent ? 'bg-[var(--e2)]' : 'bg-[var(--e3)]'
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
                                    className="sd-input font-mono-num text-xs font-bold sm:col-span-3"
                                  />
                                  <input
                                    type="text"
                                    value={editEvTitle}
                                    onChange={(e) => setEditEvTitle(e.target.value)}
                                    placeholder="Event title"
                                    className="sd-input text-xs sm:col-span-6"
                                  />
                                  <input
                                    type="text"
                                    value={editEvEra}
                                    onChange={(e) => setEditEvEra(e.target.value)}
                                    placeholder="Era (optional)"
                                    className="sd-input text-xs sm:col-span-3"
                                  />
                                </div>
                                <textarea
                                  rows={2}
                                  value={editEvDetail}
                                  onChange={(e) => setEditEvDetail(e.target.value)}
                                  placeholder="What happened…"
                                  className="sd-input text-xs"
                                />
                                <textarea
                                  rows={2}
                                  value={editEvSignificance}
                                  onChange={(e) => setEditEvSignificance(e.target.value)}
                                  placeholder="Why it mattered / exam significance…"
                                  className="sd-input text-xs"
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
                                className={`sd-card p-4 transition-colors ${
                                  ev.keyEvent
                                    ? 'border-[color-mix(in_srgb,var(--e2)_50%,var(--line))]'
                                    : ''
                                }`}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    {ev.keyEvent && (
                                      <div className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-[var(--e2)]">
                                        Key Turning Point
                                      </div>
                                    )}
                                    <h3 className="font-display text-base font-bold leading-snug text-[var(--ink)]">
                                      {ev.title}
                                    </h3>
                                  </div>

                                  <div className="flex shrink-0 items-center gap-1">
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
                                        ev.keyEvent ? 'Unmark key turning point' : 'Mark as key turning point'
                                      }
                                      title="Toggle Key Turning Point"
                                      className={`sd-btn h-7 w-7 p-0 ${
                                        ev.keyEvent ? 'border-[var(--e2)] text-[var(--e2)]' : 'text-[var(--mute)]'
                                      }`}
                                    >
                                      <Star className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={fullIdx <= 0}
                                      onClick={() => handleMoveTimelineEvent(ev.id, -1)}
                                      aria-label="Move event earlier"
                                      className="sd-btn h-7 w-7 p-0 disabled:opacity-35"
                                    >
                                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={fullIdx >= timelineEventsAll.length - 1}
                                      onClick={() => handleMoveTimelineEvent(ev.id, 1)}
                                      aria-label="Move event later"
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
                                      aria-label="Edit timeline event"
                                      className="sd-btn h-7 w-7 p-0 text-[var(--mute)]"
                                    >
                                      <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
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
                                      className="sd-btn h-7 w-7 p-0 text-[var(--bad)]"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                  </div>
                                </div>

                                {(what || why) && (
                                  <div className="mt-2 space-y-1.5 text-sm leading-relaxed">
                                    {what && <p className="text-[var(--ink)]/90">{what}</p>}
                                    {why && (
                                      <p className="rounded-lg bg-[var(--bg)] px-3 py-1.5 text-xs leading-relaxed text-[var(--mute)]">
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
        )}
      </div>
    </div>
  );
}

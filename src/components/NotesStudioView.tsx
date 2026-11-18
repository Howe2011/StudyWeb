import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  Eye,
  EyeOff,
  Globe,
  Layers,
  ListPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Share2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  createEmptyStructuredNote,
  estimateNoteReadingMinutes,
  groupSectionPoints,
} from '../lib/noteFormat';
import { parseBulkTimelineNodes } from '../lib/smartImporter';
import { makeId } from '../lib/workspaceStore';
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
  const parts = String(text || '').split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-[var(--ink)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
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
  const [newTopicName, setNewTopicName] = useState('');
  const [addingTopic, setAddingTopic] = useState(false);
  const [cardsFeedback, setCardsFeedback] = useState<string | null>(null);
  const [showLegacyHtml, setShowLegacyHtml] = useState(false);

  // History Timeline state
  const [hideTimelineDates, setHideTimelineDates] = useState(false);
  const [revealedEventIds, setRevealedEventIds] = useState<Set<string>>(new Set());
  const [tlDate, setTlDate] = useState('');
  const [tlTitle, setTlTitle] = useState('');
  const [tlDetail, setTlDetail] = useState('');
  const [tlEra, setTlEra] = useState('');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editEvDate, setEditEvDate] = useState('');
  const [editEvTitle, setEditEvTitle] = useState('');
  const [editEvDetail, setEditEvDetail] = useState('');
  const [editEvEra, setEditEvEra] = useState('');
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
    if (initialTopicId && subjectTopics.some((t) => t.id === initialTopicId)) {
      setSelectedTopicId(initialTopicId);
      setViewMode('read');
    }
  }, [initialTopicId, subjectTopics]);

  useEffect(() => {
    if (activeSubject && activeSubject.id !== selectedSubjectId) {
      onSelectSubjectId(activeSubject.id);
    }
  }, [activeSubject, selectedSubjectId, onSelectSubjectId]);

  const activeTopic = useMemo(() => {
    if (!subjectTopics.length) return null;
    return subjectTopics.find((t) => t.id === selectedTopicId) || subjectTopics[0];
  }, [subjectTopics, selectedTopicId]);

  useEffect(() => {
    if (activeTopic && activeTopic.id !== selectedTopicId) {
      setSelectedTopicId(activeTopic.id);
    }
    setCardsFeedback(null);
    setShowLegacyHtml(false);
    setEditingEventId(null);
    if (viewMode === 'timeline' && !isHistorySubject) {
      setViewMode('read');
    }
  }, [activeTopic, isHistorySubject, selectedTopicId, viewMode]);

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

  const handleAddTopic = (e: FormEvent) => {
    e.preventDefault();
    if (!activeSubject || !newTopicName.trim()) return;
    const created: StudyTopic = {
      id: makeId('top'),
      subjectId: activeSubject.id,
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
    setSelectedTopicId(created.id);
    setNewTopicName('');
    setAddingTopic(false);
    setViewMode('edit');
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
      era: tlEra.trim() || undefined,
    };
    updateTopic(activeTopic.id, (t) => ({
      ...t,
      timelineEvents: [...(t.timelineEvents || []), item],
    }));
    setTlDate('');
    setTlTitle('');
    setTlDetail('');
    setTlEra('');
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

  const handleMoveTimelineEvent = (idx: number, dir: -1 | 1) => {
    if (!activeTopic) return;
    const list = [...(activeTopic.timelineEvents || [])];
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
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
              era: editEvEra.trim() || undefined,
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
          era: node.era?.trim() || undefined,
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
              {subjectTopics.map((tp, idx) => {
                const selected = tp.id === activeTopic?.id;
                return (
                  <button
                    key={tp.id}
                    type="button"
                    onClick={() => setSelectedTopicId(tp.id)}
                    title={tp.name}
                    aria-label={tp.name}
                    className={`font-mono-num flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border text-xs font-bold transition-colors ${
                      selected
                        ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_15%,var(--bg))] text-[var(--e3)]'
                        : tp.completed
                        ? 'border-[var(--ok)]/50 bg-[var(--bg)] text-[var(--ok)]'
                        : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)] hover:text-[var(--ink)]'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                setSidebarCompressed(false);
                try {
                  localStorage.setItem('studydeck_notes_sidebar_collapsed', '0');
                } catch {
                  // ignore
                }
                setAddingTopic(true);
              }}
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
                  onClick={() => setAddingTopic((v) => !v)}
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
                <input
                  type="text"
                  autoFocus
                  value={newTopicName}
                  onChange={(e) => setNewTopicName(e.target.value)}
                  placeholder="Topic title…"
                  className="sd-input py-1.5 text-xs"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAddingTopic(false)}
                    className="sd-btn px-2 py-1 text-[11px]"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="sd-btn-pri px-2.5 py-1 text-[11px]">
                    Create
                  </button>
                </div>
              </form>
            )}

            {/* Topic List */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-visible lg:pb-0">
              {subjectTopics.map((tp) => {
                const selected = tp.id === activeTopic?.id;
                return (
                  <button
                    key={tp.id}
                    type="button"
                    onClick={() => setSelectedTopicId(tp.id)}
                    className={`flex shrink-0 cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors lg:w-full ${
                      selected
                        ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--bg))] font-bold text-[var(--ink)]'
                        : 'border-transparent bg-transparent font-semibold text-[var(--mute)] hover:bg-[var(--bg)] hover:text-[var(--ink)]'
                    }`}
                  >
                    <span className="truncate">{tp.name}</span>
                    {tp.completed && (
                      <CheckCircle2
                        className="h-3.5 w-3.5 shrink-0 text-[var(--ok)]"
                        aria-label="Topic studied"
                      />
                    )}
                  </button>
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
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mute)]">
                  {sidebarCompressed && (
                    <button
                      type="button"
                      onClick={toggleSidebarCompressed}
                      className="cursor-pointer font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                    >
                      Show Topics ({subjectTopics.length})
                    </button>
                  )}
                  {sidebarCompressed && <span aria-hidden="true">·</span>}
                  <span>{activeSubject?.name}</span>
                  {activeTopic.specCode && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-num">Spec {activeTopic.specCode}</span>
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
                    Edit (Notion)
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
              </div>
            </div>

            {cardsFeedback && (
              <div
                role="status"
                className="rounded-xl border border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_9%,var(--card))] px-4 py-2.5 text-xs font-semibold text-[var(--ink)]"
              >
                {cardsFeedback}
              </div>
            )}

            {/* MODE 1: SAVE MY EXAMS READER */}
            {viewMode === 'read' && (
              <div className="space-y-6 text-[15px] leading-relaxed">
                {/* Summary Callout */}
                {activeTopic.notes.summary.trim() ? (
                  <section className="sd-card p-5">
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--e3)]">
                      Topic Overview
                    </div>
                    <p className="mt-1.5 whitespace-pre-line text-[var(--ink)]">
                      {renderInlineBold(activeTopic.notes.summary)}
                    </p>
                  </section>
                ) : null}

                {/* Specification Sections */}
                {activeTopic.notes.sections.some((s) => s.points.length > 0 || s.heading.trim()) ? (
                  <div className="space-y-5">
                    {activeTopic.notes.sections.map((sec) => {
                      if (!sec.heading.trim() && sec.points.length === 0) return null;
                      return (
                        <section key={sec.id} className="sd-card p-6">
                          <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                            {sec.heading || 'Key Points'}
                          </h2>
                          {sec.points.length > 0 && (
                            <div className="mt-3 space-y-2.5 text-[var(--ink)]">
                              {groupSectionPoints(sec.points).map((blk, i) => {
                                if (blk.kind === 'subheading') {
                                  return (
                                    <h3
                                      key={i}
                                      className="font-display pt-2 text-[15px] font-bold text-[var(--e3)]"
                                    >
                                      {renderInlineBold(blk.text)}
                                    </h3>
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
                                                className="px-3.5 py-2.5 font-bold text-[var(--ink)]"
                                              >
                                                {renderInlineBold(h)}
                                              </th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[var(--line)]">
                                          {blk.rows.map((row, ri) => (
                                            <tr key={ri}>
                                              {row.map((cell, ci) => (
                                                <td
                                                  key={ci}
                                                  className="px-3.5 py-2 align-top text-[var(--ink)]"
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
                                    <p key={i} className="whitespace-pre-line leading-relaxed">
                                      {renderInlineBold(blk.text)}
                                    </p>
                                  );
                                }
                                return (
                                  <div key={i} className="flex items-start gap-2.5 pl-1">
                                    <span
                                      className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ink)]"
                                      aria-hidden="true"
                                    />
                                    <span>{renderInlineBold(blk.text)}</span>
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
                  !activeTopic.notes.legacyHtml ? (
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

                {/* Key Terms & Definitions Table + Explicit Make Flashcards */}
                {activeTopic.notes.keyTerms.length > 0 && (
                  <section className="sd-card overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-4">
                      <div>
                        <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                          Key Terms &amp; Definitions
                        </h2>
                        <p className="text-xs text-[var(--mute)]">
                          Click Make Flashcards whenever you want spaced-repetition cards from these terms.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleMakeFlashcardsFromTerms}
                        className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap shrink-0"
                      >
                        <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Make Flashcards ({activeTopic.notes.keyTerms.length})</span>
                      </button>
                    </div>

                    <div className="divide-y divide-[var(--line)]">
                      {activeTopic.notes.keyTerms.map((kt) => (
                        <div
                          key={kt.id}
                          className="grid gap-2 px-6 py-3.5 text-sm sm:grid-cols-3"
                        >
                          <div className="font-bold text-[var(--ink)]">{kt.term}</div>
                          <div className="text-[var(--mute)] sm:col-span-2">{kt.definition}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Worked Example */}
                {activeTopic.notes.workedExample.trim() && (
                  <section className="sd-card p-5">
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--ok)]">
                      Worked Example
                    </div>
                    <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-[var(--ink)]">
                      {renderInlineBold(activeTopic.notes.workedExample)}
                    </p>
                  </section>
                )}

                {/* Examiner Tip */}
                {activeTopic.notes.examTip.trim() && (
                  <section className="sd-card border-[var(--e2)] p-5">
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--e2)]">
                      Examiner Tip
                    </div>
                    <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-[var(--ink)]">
                      {renderInlineBold(activeTopic.notes.examTip)}
                    </p>
                  </section>
                )}

                {/* Optional Migrated Legacy / Word Tables */}
                {activeTopic.notes.legacyHtml && (
                  <div className="sd-card p-5">
                    <button
                      type="button"
                      onClick={() => setShowLegacyHtml((v) => !v)}
                      className="cursor-pointer text-xs font-bold text-[var(--e3)] hover:underline"
                    >
                      {showLegacyHtml
                        ? 'Hide original document tables / formatting'
                        : 'Show imported Word / legacy HTML document tables'}
                    </button>
                    {showLegacyHtml && (
                      <div
                        className="mt-3 overflow-x-auto text-sm text-[var(--ink)] [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[var(--line)] [&_td]:p-2 [&_th]:border [&_th]:border-[var(--line)] [&_th]:p-2"
                        dangerouslySetInnerHTML={{ __html: activeTopic.notes.legacyHtml }}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* MODE 2: NOTION-STYLE BLOCK EDITOR */}
            {viewMode === 'edit' && (
              <NotionTopicEditor
                topicId={activeTopic.id}
                topicName={activeTopic.name}
                specCode={activeTopic.specCode}
                notes={activeTopic.notes}
                onChangeTopicMeta={(fields) =>
                  updateTopic(activeTopic.id, (t) => ({
                    ...t,
                    ...(fields.name !== undefined ? { name: fields.name } : {}),
                    ...(fields.specCode !== undefined ? { specCode: fields.specCode } : {}),
                  }))
                }
                onChangeNotes={replaceActiveNote}
                onMakeFlashcards={handleMakeFlashcardsFromTerms}
              />
            )}

            {/* MODE 3: HISTORY-ONLY EASY TIMELINE */}
            {viewMode === 'timeline' && isHistorySubject && (
              <div className="space-y-5">
                <div className="sd-card flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-2 text-xs text-[var(--mute)]">
                    <Calendar className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                    <span>
                      {(activeTopic.timelineEvents || []).length} events · Add events, click Sort by
                      Year, or drill hidden dates
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                      <span>Bulk Import Nodes</span>
                    </button>
                    {(activeTopic.timelineEvents || []).length > 1 && (
                      <button
                        type="button"
                        onClick={handleSortTimelineEvents}
                        className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                      >
                        <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Sort Chronologically</span>
                      </button>
                    )}
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
                      <span>{hideTimelineDates ? 'Show All Dates' : 'Hide Dates Self-Test'}</span>
                    </button>
                  </div>
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
                          One event per line (<code className="font-mono-num">Date | Event Title | Impact | Era</code> or{' '}
                          <code className="font-mono-num">1923 — Hyperinflation: Marks became worthless</code>), or paste a legacy{' '}
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
                        'Nov 1918 | Armistice Signed | Ended WWI and forced Kaiser abdication | Weimar\nJun 1919 | Treaty of Versailles | Article 231 war guilt and £6.6bn reparations | Weimar\nJan 1923 — Ruhr Crisis: French troops occupied industrial heartland'
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

                {/* Quick-Add Historical Event Bar */}
                <form
                  onSubmit={handleAddTimelineEvent}
                  className="sd-card grid gap-2.5 p-4 sm:grid-cols-12"
                >
                  <input
                    type="text"
                    required
                    value={tlDate}
                    onChange={(e) => setTlDate(e.target.value)}
                    placeholder="Year / Date (e.g. Nov 1918)"
                    className="sd-input text-xs sm:col-span-3"
                  />
                  <input
                    type="text"
                    required
                    value={tlTitle}
                    onChange={(e) => setTlTitle(e.target.value)}
                    placeholder="Event title (e.g. Armistice Signed)"
                    className="sd-input text-xs sm:col-span-4"
                  />
                  <input
                    type="text"
                    value={tlDetail}
                    onChange={(e) => setTlDetail(e.target.value)}
                    placeholder="Impact / why it mattered"
                    className="sd-input text-xs sm:col-span-3"
                  />
                  <input
                    type="text"
                    value={tlEra}
                    onChange={(e) => setTlEra(e.target.value)}
                    placeholder="Era (opt.)"
                    className="sd-input text-xs sm:col-span-2"
                  />
                  <div className="flex justify-end sm:col-span-12">
                    <button type="submit" className="sd-btn-pri px-4 py-1.5 text-xs whitespace-nowrap">
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Add to Timeline</span>
                    </button>
                  </div>
                </form>

                {/* Vertical Chronological Spine */}
                {(activeTopic.timelineEvents || []).length === 0 ? (
                  <div className="sd-card p-6 text-center text-xs text-[var(--mute)]">
                    No History events for {activeTopic.name} yet. Enter a date and event above to start your timeline.
                  </div>
                ) : (
                  <div className="relative space-y-3 pl-6 before:absolute before:bottom-3 before:left-[9px] before:top-3 before:w-[2px] before:bg-[var(--line)]">
                    {(activeTopic.timelineEvents || []).map((ev, idx) => {
                      const isHidden = hideTimelineDates && !revealedEventIds.has(ev.id);
                      const isEditingEv = editingEventId === ev.id;
                      const listLen = (activeTopic.timelineEvents || []).length;

                      return (
                        <div key={ev.id} className="relative">
                          {/* Timeline Node */}
                          <span
                            className="absolute -left-[21px] top-5 h-3 w-3 rounded-full border-2 border-[var(--card)] bg-[var(--e3)]"
                            aria-hidden="true"
                          />

                          {isEditingEv ? (
                            <div className="sd-card space-y-2.5 p-4">
                              <div className="grid gap-2 sm:grid-cols-12">
                                <input
                                  type="text"
                                  value={editEvDate}
                                  onChange={(e) => setEditEvDate(e.target.value)}
                                  placeholder="Date / Year"
                                  className="sd-input text-xs font-bold sm:col-span-3"
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
                                placeholder="Historical significance / detail…"
                                className="sd-input text-xs"
                              />
                              <div className="flex justify-end gap-2">
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
                          ) : (
                            <div className="sd-card flex flex-wrap items-start justify-between gap-3 p-4">
                              <div className="flex min-w-0 flex-1 items-start gap-4">
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
                                  className={`font-mono-num shrink-0 cursor-pointer rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-1 text-xs font-bold ${
                                    isHidden ? 'text-transparent select-none' : 'text-[var(--e3)]'
                                  }`}
                                  title={isHidden ? 'Click to reveal date' : ev.date}
                                >
                                  {isHidden ? 'Reveal Date' : ev.date}
                                </button>

                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-baseline gap-2">
                                    <span className="font-display text-base font-bold text-[var(--ink)]">
                                      {ev.title}
                                    </span>
                                    {ev.era && (
                                      <span className="text-xs font-semibold text-[var(--mute)]">
                                        · {ev.era}
                                      </span>
                                    )}
                                  </div>
                                  {ev.detail && (
                                    <p className="mt-1 text-sm text-[var(--mute)]">{ev.detail}</p>
                                  )}
                                </div>
                              </div>

                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => handleMoveTimelineEvent(idx, -1)}
                                  aria-label="Move event earlier"
                                  className="sd-btn h-7 w-7 p-0 disabled:opacity-40"
                                >
                                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === listLen - 1}
                                  onClick={() => handleMoveTimelineEvent(idx, 1)}
                                  aria-label="Move event later"
                                  className="sd-btn h-7 w-7 p-0 disabled:opacity-40"
                                >
                                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingEventId(ev.id);
                                    setEditEvDate(ev.date);
                                    setEditEvTitle(ev.title);
                                    setEditEvDetail(ev.detail);
                                    setEditEvEra(ev.era || '');
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
                          )}
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

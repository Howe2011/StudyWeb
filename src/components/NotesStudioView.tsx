import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  Eye,
  EyeOff,
  Layers,
  Plus,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  createEmptyStructuredNote,
  estimateNoteReadingMinutes,
  makeNoteId,
} from '../lib/noteFormat';
import { makeId } from '../lib/workspaceStore';
import {
  KeyTermPair,
  NoteSectionBlock,
  StructuredNoteData,
  StudyFlashcard,
  StudyTopic,
  TimelineEventItem,
  WorkspaceData,
  WorkspaceTab,
} from '../types';

interface NotesStudioViewProps {
  workspace: WorkspaceData;
  selectedSubjectId: string;
  onSelectSubjectId: (id: string) => void;
  onUpdateWorkspace: (updater: (prev: WorkspaceData) => WorkspaceData) => void;
  onOpenImport: () => void;
  onShareTopic: (subjectId: string, topicId: string) => void;
  onNavigate: (tab: WorkspaceTab) => void;
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
  onSelectSubjectId,
  onUpdateWorkspace,
  onOpenImport,
  onShareTopic,
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

  const [selectedTopicId, setSelectedTopicId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'read' | 'edit' | 'timeline'>('read');
  const [newTopicName, setNewTopicName] = useState('');
  const [addingTopic, setAddingTopic] = useState(false);
  const [cardsFeedback, setCardsFeedback] = useState<string | null>(null);
  const [showLegacyHtml, setShowLegacyHtml] = useState(false);

  // Timeline form & hide-dates drill state
  const [hideTimelineDates, setHideTimelineDates] = useState(false);
  const [revealedEventIds, setRevealedEventIds] = useState<Set<string>>(new Set());
  const [tlDate, setTlDate] = useState('');
  const [tlTitle, setTlTitle] = useState('');
  const [tlDetail, setTlDetail] = useState('');

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
    if (viewMode === 'timeline' && activeSubject && !activeSubject.hasTimeline && !(activeTopic?.timelineEvents?.length)) {
      setViewMode('read');
    }
  }, [activeTopic, activeSubject, selectedTopicId, viewMode]);

  const updateTopic = (topicId: string, updater: (t: StudyTopic) => StudyTopic) => {
    onUpdateWorkspace((prev) => ({
      ...prev,
      topics: prev.topics.map((t) => (t.id === topicId ? updater(t) : t)),
      updatedAt: new Date().toISOString(),
    }));
  };

  const updateActiveNote = (updater: (n: StructuredNoteData) => StructuredNoteData) => {
    if (!activeTopic) return;
    updateTopic(activeTopic.id, (t) => ({
      ...t,
      notes: {
        ...updater(t.notes),
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
      setCardsFeedback('Add key terms in Edit mode first.');
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
    };
    updateTopic(activeTopic.id, (t) => ({
      ...t,
      timelineEvents: [...(t.timelineEvents || []), item],
    }));
    setTlDate('');
    setTlTitle('');
    setTlDetail('');
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
                className="sd-btn-pri px-4 py-2 text-sm"
              >
                Quick-Add Subjects
              </button>
              <button
                type="button"
                onClick={onOpenImport}
                className="sd-btn px-4 py-2 text-sm"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>Import Notes / .docx</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const showTimelineTab = Boolean(
    activeSubject?.hasTimeline || (activeTopic?.timelineEvents && activeTopic.timelineEvents.length > 0)
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--bg)] lg:flex-row">
      {/* Left Subject & Topic Navigator */}
      <aside className="shrink-0 border-b border-[var(--line)] bg-[var(--card)] p-4 lg:w-[270px] lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
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
                className="sd-btn px-2 py-1 text-[11px]"
              >
                <Upload className="h-3 w-3" aria-hidden="true" />
                <span>Import</span>
              </button>
              <button
                type="button"
                onClick={() => setAddingTopic((v) => !v)}
                className="sd-btn-pri px-2 py-1 text-[11px]"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                <span>Topic</span>
              </button>
            </div>
          </div>

          {addingTopic && (
            <form onSubmit={handleAddTopic} className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-2.5">
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
        </div>
      </aside>

      {/* Main Reader / Editor Canvas */}
      <div className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        {!activeTopic ? (
          <div className="mx-auto max-w-2xl sd-card p-6 text-center text-sm text-[var(--mute)]">
            Select or create a topic on the left to start writing Save My Exams-style structured notes.
          </div>
        ) : (
          <div className="mx-auto space-y-6" style={{ maxWidth: 'var(--mw, 860px)' }}>
            {/* Topic Header & Action Toolbar */}
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] pb-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mute)]">
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
                <h1 className="font-display mt-1 text-2xl font-extrabold tracking-tight text-[var(--ink)] sm:text-3xl">
                  {activeTopic.name}
                </h1>
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
                  {showTimelineTab && (
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
                  className={`sd-btn px-3 py-1.5 text-xs whitespace-nowrap ${
                    activeTopic.completed ? 'border-[var(--ok)] text-[var(--ok)]' : ''
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{activeTopic.completed ? 'Studied' : 'Mark Studied'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => activeSubject && onShareTopic(activeSubject.id, activeTopic.id)}
                  className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
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
                    <p className="mt-1.5 text-[var(--ink)]">
                      {renderInlineBold(activeTopic.notes.summary)}
                    </p>
                  </section>
                ) : null}

                {/* Specification Sections */}
                {activeTopic.notes.sections.some((s) => s.points.length > 0) ? (
                  <div className="space-y-5">
                    {activeTopic.notes.sections.map((sec) => {
                      if (!sec.heading.trim() && sec.points.length === 0) return null;
                      return (
                        <section key={sec.id} className="sd-card p-6">
                          <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                            {sec.heading || 'Key Points'}
                          </h2>
                          {sec.points.length > 0 && (
                            <ul className="mt-3 list-disc space-y-2 pl-5 text-[var(--ink)]">
                              {sec.points.map((pt, i) => (
                                <li key={i}>{renderInlineBold(pt)}</li>
                              ))}
                            </ul>
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
                        className="sd-btn-pri px-4 py-2 text-xs"
                      >
                        <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Write Revision Notes</span>
                      </button>
                      <button
                        type="button"
                        onClick={onOpenImport}
                        className="sd-btn px-4 py-2 text-xs"
                      >
                        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Paste / Import Notes</span>
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* Key Terms & Definitions Table + 1-Click Flashcards */}
                {activeTopic.notes.keyTerms.length > 0 && (
                  <section className="sd-card overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-4">
                      <div>
                        <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                          Key Terms &amp; Definitions
                        </h2>
                        <p className="text-xs text-[var(--mute)]">
                          Convert definitions directly into spaced-repetition flashcards.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleMakeFlashcardsFromTerms}
                        className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap"
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

            {/* MODE 2: CLEAN BEGINNER EDITOR */}
            {viewMode === 'edit' && (
              <div className="space-y-5">
                <section className="sd-card space-y-3 p-5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                    Topic Overview / Summary
                    <textarea
                      rows={3}
                      value={activeTopic.notes.summary}
                      onChange={(e) =>
                        updateActiveNote((n) => ({ ...n, summary: e.target.value }))
                      }
                      placeholder="Write a 1–2 sentence core summary of what the exam specification requires…"
                      className="sd-input mt-1.5 text-sm font-normal"
                    />
                  </label>
                </section>

                {/* Sections Editor */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                      Sections &amp; Bullet Points
                    </h2>
                    <button
                      type="button"
                      onClick={() =>
                        updateActiveNote((n) => ({
                          ...n,
                          sections: [
                            ...n.sections,
                            {
                              id: makeNoteId('sec'),
                              heading: 'New Section',
                              points: [],
                            },
                          ],
                        }))
                      }
                      className="sd-btn px-3 py-1.5 text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Add Section</span>
                    </button>
                  </div>

                  {activeTopic.notes.sections.map((sec: NoteSectionBlock) => (
                    <div key={sec.id} className="sd-card space-y-3 p-5">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={sec.heading}
                          onChange={(e) =>
                            updateActiveNote((n) => ({
                              ...n,
                              sections: n.sections.map((s) =>
                                s.id === sec.id ? { ...s, heading: e.target.value } : s
                              ),
                            }))
                          }
                          placeholder="Section heading"
                          className="sd-input flex-1 font-display text-sm font-bold"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateActiveNote((n) => ({
                              ...n,
                              sections: n.sections.filter((s) => s.id !== sec.id),
                            }))
                          }
                          aria-label="Delete section"
                          className="sd-btn h-9 w-9 shrink-0 p-0 text-[var(--bad)]"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>

                      <label className="block text-xs font-semibold text-[var(--mute)]">
                        Bullet points (one per line · wrap key phrases in **bold**)
                        <textarea
                          rows={Math.max(3, Math.min(10, sec.points.length + 1))}
                          value={sec.points.join('\n')}
                          onChange={(e) => {
                            const nextPts = e.target.value.split('\n');
                            updateActiveNote((n) => ({
                              ...n,
                              sections: n.sections.map((s) =>
                                s.id === sec.id ? { ...s, points: nextPts } : s
                              ),
                            }));
                          }}
                          placeholder="First key fact or mechanism&#10;Second key fact (**key term**: explanation)"
                          className="sd-input mt-1 text-sm leading-relaxed"
                        />
                      </label>
                    </div>
                  ))}
                </section>

                {/* Key Terms Editor */}
                <section className="sd-card space-y-3 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                        Key Terms
                      </h2>
                      <p className="text-xs text-[var(--mute)]">
                        One-click conversion to active-recall flashcards.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateActiveNote((n) => ({
                          ...n,
                          keyTerms: [
                            ...n.keyTerms,
                            { id: makeNoteId('term'), term: '', definition: '' },
                          ],
                        }))
                      }
                      className="sd-btn px-3 py-1.5 text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Add Key Term</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    {activeTopic.notes.keyTerms.map((kt: KeyTermPair) => (
                      <div key={kt.id} className="grid gap-2 sm:grid-cols-12">
                        <input
                          type="text"
                          value={kt.term}
                          onChange={(e) =>
                            updateActiveNote((n) => ({
                              ...n,
                              keyTerms: n.keyTerms.map((x) =>
                                x.id === kt.id ? { ...x, term: e.target.value } : x
                              ),
                            }))
                          }
                          placeholder="Term"
                          className="sd-input text-xs font-semibold sm:col-span-4"
                        />
                        <input
                          type="text"
                          value={kt.definition}
                          onChange={(e) =>
                            updateActiveNote((n) => ({
                              ...n,
                              keyTerms: n.keyTerms.map((x) =>
                                x.id === kt.id ? { ...x, definition: e.target.value } : x
                              ),
                            }))
                          }
                          placeholder="Clear exam definition"
                          className="sd-input text-xs sm:col-span-7"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateActiveNote((n) => ({
                              ...n,
                              keyTerms: n.keyTerms.filter((x) => x.id !== kt.id),
                            }))
                          }
                          aria-label="Remove key term"
                          className="sd-btn h-9 p-0 text-[var(--bad)] sm:col-span-1"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Worked Example & Examiner Tip Editor */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="sd-card p-5">
                    <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ok)]">
                      Worked Example
                      <textarea
                        rows={3}
                        value={activeTopic.notes.workedExample}
                        onChange={(e) =>
                          updateActiveNote((n) => ({ ...n, workedExample: e.target.value }))
                        }
                        placeholder="Step-by-step calculation, case study, or model answer…"
                        className="sd-input mt-1.5 text-sm font-normal text-[var(--ink)]"
                      />
                    </label>
                  </div>
                  <div className="sd-card p-5">
                    <label className="block text-xs font-bold uppercase tracking-wider text-[var(--e2)]">
                      Examiner Tip
                      <textarea
                        rows={3}
                        value={activeTopic.notes.examTip}
                        onChange={(e) =>
                          updateActiveNote((n) => ({ ...n, examTip: e.target.value }))
                        }
                        placeholder="Common mistake or mark-scheme phrase to remember…"
                        className="sd-input mt-1.5 text-sm font-normal text-[var(--ink)]"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* MODE 3: INTERACTIVE TIMELINE */}
            {viewMode === 'timeline' && (
              <div className="space-y-5">
                <div className="sd-card flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-2 text-xs text-[var(--mute)]">
                    <Calendar className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                    <span>
                      {(activeTopic.timelineEvents || []).length} events · Toggle Hide Dates to drill
                      chronology
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setHideTimelineDates((v) => !v);
                      setRevealedEventIds(new Set());
                    }}
                    className={`sd-btn px-3 py-1.5 text-xs ${
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

                <form onSubmit={handleAddTimelineEvent} className="sd-card grid gap-3 p-4 sm:grid-cols-12">
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
                    placeholder="Event title"
                    className="sd-input text-xs sm:col-span-4"
                  />
                  <input
                    type="text"
                    value={tlDetail}
                    onChange={(e) => setTlDetail(e.target.value)}
                    placeholder="Impact / detail (optional)"
                    className="sd-input text-xs sm:col-span-3"
                  />
                  <button type="submit" className="sd-btn-pri py-2 text-xs sm:col-span-2">
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Add Event</span>
                  </button>
                </form>

                <div className="space-y-2.5">
                  {(activeTopic.timelineEvents || []).map((ev) => {
                    const isHidden = hideTimelineDates && !revealedEventIds.has(ev.id);
                    return (
                      <div
                        key={ev.id}
                        className="sd-card flex items-start justify-between gap-4 p-4"
                      >
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
                            {isHidden ? 'Click to reveal' : ev.date}
                          </button>
                          <div className="min-w-0">
                            <div className="font-display text-base font-bold text-[var(--ink)]">
                              {ev.title}
                            </div>
                            {ev.detail && (
                              <p className="mt-0.5 text-sm text-[var(--mute)]">{ev.detail}</p>
                            )}
                          </div>
                        </div>
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
                          className="sd-btn h-8 w-8 shrink-0 p-0 text-[var(--bad)]"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                  {(!activeTopic.timelineEvents || activeTopic.timelineEvents.length === 0) && (
                    <div className="sd-card p-6 text-center text-xs text-[var(--mute)]">
                      No timeline events for {activeTopic.name} yet. Add your first event above.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

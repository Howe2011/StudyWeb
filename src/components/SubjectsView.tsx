import { FormEvent, useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  Check,
  Edit3,
  Layers,
  Plus,
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { createEmptyStructuredNote, makeNoteId } from '../lib/noteFormat';
import {
  CatalogSubjectTemplate,
  QUICK_ADD_SUBJECT_CATALOG,
  SUBJECT_CATEGORIES,
  SUBJECT_COLOR_SWATCHES,
} from '../lib/subjectCatalog';
import { makeId } from '../lib/workspaceStore';
import {
  StudyFlashcard,
  StudySubject,
  StudyTopic,
  WorkspaceData,
  WorkspaceTab,
} from '../types';

interface SubjectsViewProps {
  workspace: WorkspaceData;
  initialQuickAddOpen?: boolean;
  onUpdateWorkspace: (updater: (prev: WorkspaceData) => WorkspaceData) => void;
  onOpenSubjectNotes: (subjectId: string) => void;
  onOpenSubjectCards: (subjectId: string) => void;
  onShareSubject: (subjectId: string) => void;
  onNavigate: (tab: WorkspaceTab) => void;
}

export function SubjectsView({
  workspace,
  initialQuickAddOpen = false,
  onUpdateWorkspace,
  onOpenSubjectNotes,
  onOpenSubjectCards,
  onShareSubject,
}: SubjectsViewProps) {
  const [quickAddOpen, setQuickAddOpen] = useState(
    initialQuickAddOpen || workspace.subjects.length === 0
  );
  const [categoryFilter, setCategoryFilter] = useState<(typeof SUBJECT_CATEGORIES)[number]>('All');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<CatalogSubjectTemplate | null>(null);
  const [selectedTopicNames, setSelectedTopicNames] = useState<string[]>([]);
  const [quickExamDate, setQuickExamDate] = useState('');
  const [quickBoard, setQuickBoard] = useState('');

  // Custom subject modal/form
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customBoard, setCustomBoard] = useState('GCSE / Edexcel');
  const [customExamDate, setCustomExamDate] = useState('');
  const [customWeight, setCustomWeight] = useState<1 | 2 | 3>(2);
  const [customColor, setCustomColor] = useState<string>(SUBJECT_COLOR_SWATCHES[0]);
  const [customHasTimeline, setCustomHasTimeline] = useState(false);
  const [customTopicsRaw, setCustomTopicsRaw] = useState('');

  // Inline edit state
  const [editingSubjId, setEditingSubjId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<StudySubject>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const existingSubjectNames = useMemo(
    () => new Set(workspace.subjects.map((s) => s.name.trim().toLowerCase())),
    [workspace.subjects]
  );

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return QUICK_ADD_SUBJECT_CATALOG.filter((item) => {
      if (categoryFilter !== 'All' && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.topics.some((t) => t.name.toLowerCase().includes(q))
      );
    });
  }, [categoryFilter, catalogSearch]);

  const openTemplatePicker = (tpl: CatalogSubjectTemplate) => {
    setSelectedTemplate(tpl);
    setSelectedTopicNames(tpl.topics.map((t) => t.name));
    setQuickBoard(tpl.examBoard);
    setQuickExamDate('');
  };

  const handleConfirmQuickAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate) return;
    const tpl = selectedTemplate;
    const chosenTopics = tpl.topics.filter((t) => selectedTopicNames.includes(t.name));

    onUpdateWorkspace((prev) => {
      const existing = prev.subjects.find(
        (s) => s.name.toLowerCase() === tpl.name.toLowerCase()
      );
      const subjId = existing ? existing.id : makeId('subj');
      const nextSubjects = existing
        ? prev.subjects
        : [
            ...prev.subjects,
            {
              id: subjId,
              name: tpl.name,
              examBoard: quickBoard.trim() || tpl.examBoard,
              color: tpl.color,
              examDate: quickExamDate,
              weight: 2 as const,
              hasTimeline: Boolean(tpl.hasTimeline),
              createdAt: new Date().toISOString(),
            },
          ];

      const newTopics: StudyTopic[] = [];
      const newCards: StudyFlashcard[] = [];
      const existingTopicNames = new Set(
        prev.topics.filter((t) => t.subjectId === subjId).map((t) => t.name.toLowerCase())
      );

      for (const ct of chosenTopics) {
        if (existingTopicNames.has(ct.name.toLowerCase())) continue;
        const topicId = makeId('top');
        const note = createEmptyStructuredNote(ct.summary || '');
        if (ct.keyTerms && ct.keyTerms.length > 0) {
          note.keyTerms = ct.keyTerms.map((kt) => ({
            id: makeNoteId('term'),
            term: kt.term,
            definition: kt.definition,
          }));
          ct.keyTerms.forEach((kt) => {
            newCards.push({
              id: makeId('fc'),
              subjectId: subjId,
              topicId,
              sectionName: ct.name,
              q: kt.term,
              a: kt.definition,
              box: 1,
              dueAt: Date.now(),
              flagged: false,
              createdAt: new Date().toISOString(),
            });
          });
        }

        newTopics.push({
          id: topicId,
          subjectId: subjId,
          name: ct.name,
          specCode: ct.specCode,
          completed: false,
          notes: note,
          createdAt: new Date().toISOString(),
        });
      }

      return {
        ...prev,
        subjects: nextSubjects,
        topics: [...prev.topics, ...newTopics],
        flashcards: [...prev.flashcards, ...newCards],
        updatedAt: new Date().toISOString(),
      };
    });

    setSelectedTemplate(null);
  };

  const handleInstantAddCatalog = (tpl: CatalogSubjectTemplate) => {
    onUpdateWorkspace((prev) => {
      if (prev.subjects.some((s) => s.name.toLowerCase() === tpl.name.toLowerCase())) {
        return prev;
      }
      const subjId = makeId('subj');
      const subj: StudySubject = {
        id: subjId,
        name: tpl.name,
        examBoard: tpl.examBoard,
        color: tpl.color,
        examDate: '',
        weight: 2,
        hasTimeline: Boolean(tpl.hasTimeline),
        createdAt: new Date().toISOString(),
      };
      const newTopics: StudyTopic[] = [];
      const newCards: StudyFlashcard[] = [];
      for (const ct of tpl.topics) {
        const topicId = makeId('top');
        const note = createEmptyStructuredNote(ct.summary || '');
        if (ct.keyTerms && ct.keyTerms.length > 0) {
          note.keyTerms = ct.keyTerms.map((kt) => ({
            id: makeNoteId('term'),
            term: kt.term,
            definition: kt.definition,
          }));
          ct.keyTerms.forEach((kt) => {
            newCards.push({
              id: makeId('fc'),
              subjectId: subjId,
              topicId,
              sectionName: ct.name,
              q: kt.term,
              a: kt.definition,
              box: 1,
              dueAt: Date.now(),
              flagged: false,
              createdAt: new Date().toISOString(),
            });
          });
        }
        newTopics.push({
          id: topicId,
          subjectId: subjId,
          name: ct.name,
          specCode: ct.specCode,
          completed: false,
          notes: note,
          createdAt: new Date().toISOString(),
        });
      }
      return {
        ...prev,
        subjects: [...prev.subjects, subj],
        topics: [...prev.topics, ...newTopics],
        flashcards: [...prev.flashcards, ...newCards],
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleCreateCustom = (e: FormEvent) => {
    e.preventDefault();
    const cleanName = customName.trim();
    if (!cleanName) return;

    const topicNames = customTopicsRaw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    onUpdateWorkspace((prev) => {
      const subjId = makeId('subj');
      const subj: StudySubject = {
        id: subjId,
        name: cleanName,
        examBoard: customBoard.trim() || 'Custom',
        color: customColor,
        examDate: customExamDate,
        weight: customWeight,
        hasTimeline: customHasTimeline,
        createdAt: new Date().toISOString(),
      };
      const topics: StudyTopic[] = (topicNames.length ? topicNames : ['Core Notes']).map((tName) => ({
        id: makeId('top'),
        subjectId: subjId,
        name: tName,
        completed: false,
        notes: createEmptyStructuredNote(),
        createdAt: new Date().toISOString(),
      }));
      return {
        ...prev,
        subjects: [...prev.subjects, subj],
        topics: [...prev.topics, ...topics],
        updatedAt: new Date().toISOString(),
      };
    });

    setCustomName('');
    setCustomTopicsRaw('');
    setCustomExamDate('');
    setCustomOpen(false);
  };

  const handleSaveEdit = (subjId: string) => {
    onUpdateWorkspace((prev) => ({
      ...prev,
      subjects: prev.subjects.map((s) =>
        s.id === subjId
          ? {
              ...s,
              name: (editForm.name || s.name).trim(),
              examBoard: (editForm.examBoard ?? s.examBoard).trim(),
              examDate: editForm.examDate ?? s.examDate,
              targetGrade: (editForm.targetGrade ?? s.targetGrade ?? '').trim(),
              weight: (editForm.weight as 1 | 2 | 3) || s.weight,
              color: editForm.color || s.color,
              hasTimeline: editForm.hasTimeline ?? s.hasTimeline,
            }
          : s
      ),
      updatedAt: new Date().toISOString(),
    }));
    setEditingSubjId(null);
  };

  const handleDeleteSubject = (subjId: string) => {
    onUpdateWorkspace((prev) => ({
      ...prev,
      subjects: prev.subjects.filter((s) => s.id !== subjId),
      topics: prev.topics.filter((t) => t.subjectId !== subjId),
      flashcards: prev.flashcards.filter((c) => c.subjectId !== subjId),
      todos: prev.todos.map((td) =>
        td.subjectId === subjId ? { ...td, subjectId: undefined } : td
      ),
      calendarBlocks: prev.calendarBlocks.filter((b) => b.subjectId !== subjId),
      updatedAt: new Date().toISOString(),
    }));
    setConfirmDeleteId(null);
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-[var(--ink)] sm:text-3xl">
              Subjects &amp; Quick Add
            </h1>
            <p className="mt-1 text-sm text-[var(--mute)]">
              Organise your exam subjects, target dates, and specification topics.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setQuickAddOpen((v) => !v)}
              className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{quickAddOpen ? 'Hide Quick-Add Catalog' : 'Quick-Add Subjects (22)'}</span>
            </button>
            <button
              type="button"
              onClick={() => setCustomOpen((v) => !v)}
              className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Custom Subject</span>
            </button>
          </div>
        </div>

        {/* Custom Subject Form */}
        {customOpen && (
          <form onSubmit={handleCreateCustom} className="sd-card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                Create Custom Subject
              </h2>
              <button
                type="button"
                onClick={() => setCustomOpen(false)}
                aria-label="Close custom subject form"
                className="sd-btn h-8 w-8 p-0"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block text-xs font-semibold text-[var(--mute)]">
                Subject Name *
                <input
                  type="text"
                  required
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g. Drama, Mandarin"
                  className="sd-input mt-1 text-sm"
                />
              </label>

              <label className="block text-xs font-semibold text-[var(--mute)]">
                Exam Board / Level
                <input
                  type="text"
                  value={customBoard}
                  onChange={(e) => setCustomBoard(e.target.value)}
                  placeholder="e.g. GCSE Edexcel"
                  className="sd-input mt-1 text-sm"
                />
              </label>

              <label className="block text-xs font-semibold text-[var(--mute)]">
                Next Exam Date
                <input
                  type="date"
                  value={customExamDate}
                  onChange={(e) => setCustomExamDate(e.target.value)}
                  className="sd-input mt-1 text-sm"
                />
              </label>

              <label className="block text-xs font-semibold text-[var(--mute)]">
                Study Priority
                <select
                  value={customWeight}
                  onChange={(e) => setCustomWeight(Number(e.target.value) as 1 | 2 | 3)}
                  className="sd-input mt-1 text-sm"
                >
                  <option value={1}>Low priority</option>
                  <option value={2}>Standard</option>
                  <option value={3}>High priority (extra planner slots)</option>
                </select>
              </label>
            </div>

            <label className="block text-xs font-semibold text-[var(--mute)]">
              Initial Topics (comma or new-line separated)
              <textarea
                rows={2}
                value={customTopicsRaw}
                onChange={(e) => setCustomTopicsRaw(e.target.value)}
                placeholder="Topic 1, Topic 2, Topic 3"
                className="sd-input mt-1 text-sm"
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold text-[var(--mute)]">Colour:</span>
                {SUBJECT_COLOR_SWATCHES.map((col) => (
                  <button
                    key={col}
                    type="button"
                    aria-label={`Select color ${col}`}
                    onClick={() => setCustomColor(col)}
                    className={`h-6 w-6 cursor-pointer rounded-full border-2 transition-transform ${
                      customColor === col ? 'scale-110 border-[var(--ink)]' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: col }}
                  />
                ))}
                <label className="ml-2 flex cursor-pointer items-center gap-2 text-xs text-[var(--mute)]">
                  <input
                    type="checkbox"
                    checked={customHasTimeline}
                    onChange={(e) => setCustomHasTimeline(e.target.checked)}
                    className="accent-[var(--e3)]"
                  />
                  <span>Enable interactive Timeline tab in Notes</span>
                </label>
              </div>
              <button type="submit" className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap">
                Save Subject
              </button>
            </div>
          </form>
        )}

        {/* Quick-Add Catalog Section */}
        {quickAddOpen && (
          <section className="sd-card space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                  Quick-Add Subject Library
                </h2>
                <p className="mt-0.5 text-xs text-[var(--mute)]">
                  Click &ldquo;+ Quick Add&rdquo; for instant setup, or &ldquo;Pick Topics&rdquo; to
                  customise syllabus topics.
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--mute)]"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="Search 22 subjects or topics…"
                  className="sd-input pl-8 py-1.5 text-xs"
                />
              </div>
            </div>

            {/* Category Filter Bar */}
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Subject categories">
              {SUBJECT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    categoryFilter === cat
                      ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]'
                      : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)] hover:text-[var(--ink)]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Catalog Cards */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredCatalog.map((tpl) => {
                const alreadyAdded = existingSubjectNames.has(tpl.name.toLowerCase());
                return (
                  <div
                    key={tpl.key}
                    className="flex flex-col justify-between rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 font-display text-base font-bold text-[var(--ink)]">
                          <span
                            className="h-3 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: tpl.color }}
                          />
                          <span className="truncate">{tpl.name}</span>
                        </span>
                        <span className="shrink-0 text-xs text-[var(--mute)]">
                          {tpl.topics.length} topics
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--mute)]">
                        {tpl.category} · {tpl.examBoard}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-[var(--mute)]">
                        {tpl.description}
                      </p>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {alreadyAdded ? (
                        <button
                          type="button"
                          onClick={() => openTemplatePicker(tpl)}
                          className="sd-btn px-3 py-1.5 text-xs text-[var(--ok)] whitespace-nowrap"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Added · Add Topics</span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleInstantAddCatalog(tpl)}
                            className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Quick Add</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openTemplatePicker(tpl)}
                            className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                          >
                            Pick Topics
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Active Subjects List */}
        {workspace.subjects.length > 0 && (
          <section className="space-y-4">
            <h2 className="font-display text-lg font-bold text-[var(--ink)]">
              My Active Subjects ({workspace.subjects.length})
            </h2>

            <div className="grid gap-4 md:grid-cols-2">
              {workspace.subjects.map((subj) => {
                const topics = workspace.topics.filter((t) => t.subjectId === subj.id);
                const completedCount = topics.filter((t) => t.completed).length;
                const cards = workspace.flashcards.filter((c) => c.subjectId === subj.id);
                const editing = editingSubjId === subj.id;

                if (editing) {
                  return (
                    <div key={subj.id} className="sd-card space-y-3 p-5">
                      <div className="flex items-center justify-between">
                        <span className="font-display text-base font-bold text-[var(--ink)]">
                          Edit {subj.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => setEditingSubjId(null)}
                          aria-label="Cancel editing"
                          className="sd-btn h-8 w-8 p-0"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs font-semibold text-[var(--mute)]">
                          Subject Name
                          <input
                            type="text"
                            value={editForm.name ?? subj.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="sd-input mt-1 text-xs"
                          />
                        </label>
                        <label className="text-xs font-semibold text-[var(--mute)]">
                          Exam Board
                          <input
                            type="text"
                            value={editForm.examBoard ?? subj.examBoard}
                            onChange={(e) =>
                              setEditForm({ ...editForm, examBoard: e.target.value })
                            }
                            className="sd-input mt-1 text-xs"
                          />
                        </label>
                        <label className="text-xs font-semibold text-[var(--mute)]">
                          Exam Date
                          <input
                            type="date"
                            value={editForm.examDate ?? subj.examDate}
                            onChange={(e) =>
                              setEditForm({ ...editForm, examDate: e.target.value })
                            }
                            className="sd-input mt-1 text-xs"
                          />
                        </label>
                        <label className="text-xs font-semibold text-[var(--mute)]">
                          Target Grade
                          <input
                            type="text"
                            value={editForm.targetGrade ?? subj.targetGrade ?? ''}
                            onChange={(e) =>
                              setEditForm({ ...editForm, targetGrade: e.target.value })
                            }
                            placeholder="e.g. Grade 9 / A*"
                            className="sd-input mt-1 text-xs"
                          />
                        </label>
                        <label className="text-xs font-semibold text-[var(--mute)]">
                          Planner Priority
                          <select
                            value={editForm.weight ?? subj.weight}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                weight: Number(e.target.value) as 1 | 2 | 3,
                              })
                            }
                            className="sd-input mt-1 text-xs"
                          >
                            <option value={1}>Low priority</option>
                            <option value={2}>Standard priority</option>
                            <option value={3}>High priority</option>
                          </select>
                        </label>
                        <div className="flex items-end pb-1.5">
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--ink)]">
                            <input
                              type="checkbox"
                              checked={editForm.hasTimeline ?? Boolean(subj.hasTimeline)}
                              onChange={(e) =>
                                setEditForm({ ...editForm, hasTimeline: e.target.checked })
                              }
                              className="accent-[var(--e3)]"
                            />
                            <span>Enable Timeline tab</span>
                          </label>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 pt-1">
                        <div className="flex gap-1.5">
                          {SUBJECT_COLOR_SWATCHES.map((col) => (
                            <button
                              key={col}
                              type="button"
                              onClick={() => setEditForm({ ...editForm, color: col })}
                              className={`h-5 w-5 cursor-pointer rounded-full border-2 ${
                                (editForm.color || subj.color) === col
                                  ? 'border-[var(--ink)]'
                                  : 'border-transparent'
                              }`}
                              style={{ backgroundColor: col }}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(subj.id)}
                          className="sd-btn-pri px-4 py-1.5 text-xs whitespace-nowrap"
                        >
                          Save Changes
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={subj.id} className="sd-card flex flex-col justify-between p-5">
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="h-3.5 w-3.5 shrink-0 rounded-full"
                              style={{ backgroundColor: subj.color }}
                            />
                            <h3 className="font-display truncate text-lg font-bold text-[var(--ink)]">
                              {subj.name}
                            </h3>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--mute)]">
                            <span>{subj.examBoard || 'Revision'}</span>
                            {subj.targetGrade && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>Target {subj.targetGrade}</span>
                              </>
                            )}
                            {subj.examDate && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 font-mono-num">
                                  <Calendar className="h-3 w-3" aria-hidden="true" />
                                  {subj.examDate}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onShareSubject(subj.id)}
                            title="Share subject notes & cards"
                            aria-label={`Share ${subj.name}`}
                            className="sd-btn h-8 w-8 p-0"
                          >
                            <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSubjId(subj.id);
                              setEditForm({ ...subj });
                            }}
                            title="Edit subject"
                            aria-label={`Edit ${subj.name}`}
                            className="sd-btn h-8 w-8 p-0"
                          >
                            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirmDeleteId === subj.id) {
                                handleDeleteSubject(subj.id);
                              } else {
                                setConfirmDeleteId(subj.id);
                              }
                            }}
                            title={
                              confirmDeleteId === subj.id
                                ? 'Click again to confirm deletion'
                                : 'Delete subject'
                            }
                            className="sd-btn h-8 px-2 text-xs text-[var(--bad)] whitespace-nowrap"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            {confirmDeleteId === subj.id && <span>Confirm</span>}
                          </button>
                        </div>
                      </div>

                      <div className="font-mono-num mt-3 flex items-center gap-3 text-xs text-[var(--mute)]">
                        <span>
                          {completedCount}/{topics.length} topics studied
                        </span>
                        <span>·</span>
                        <span>{cards.length} flashcards</span>
                        <span>·</span>
                        <span>
                          {subj.weight === 3
                            ? 'High priority'
                            : subj.weight === 1
                            ? 'Low priority'
                            : 'Standard'}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
                      <button
                        type="button"
                        onClick={() => onOpenSubjectNotes(subj.id)}
                        className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap"
                      >
                        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Open Study Notes</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenSubjectCards(subj.id)}
                        className="sd-btn px-3.5 py-1.5 text-xs whitespace-nowrap"
                      >
                        <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Flashcards ({cards.length})</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Topic Picker Modal for Catalog Templates */}
        {selectedTemplate && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
            role="dialog"
            aria-modal="true"
          >
            <form
              onSubmit={handleConfirmQuickAdd}
              className="sd-card flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                    Configure {selectedTemplate.name}
                  </h2>
                  <p className="text-xs text-[var(--mute)]">
                    Choose specification topics and optional exam date.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTemplate(null)}
                  className="sd-btn h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-[var(--mute)]">
                    Exam Board
                    <input
                      type="text"
                      value={quickBoard}
                      onChange={(e) => setQuickBoard(e.target.value)}
                      className="sd-input mt-1 text-xs"
                    />
                  </label>
                  <label className="text-xs font-semibold text-[var(--mute)]">
                    Exam Date (Optional)
                    <input
                      type="date"
                      value={quickExamDate}
                      onChange={(e) => setQuickExamDate(e.target.value)}
                      className="sd-input mt-1 text-xs"
                    />
                  </label>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[var(--mute)]">
                    <span>Specification Topics ({selectedTopicNames.length})</span>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedTopicNames(
                          selectedTopicNames.length === selectedTemplate.topics.length
                            ? []
                            : selectedTemplate.topics.map((t) => t.name)
                        )
                      }
                      className="cursor-pointer text-[var(--e3)] hover:underline"
                    >
                      {selectedTopicNames.length === selectedTemplate.topics.length
                        ? 'Clear all'
                        : 'Select all'}
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {selectedTemplate.topics.map((tp) => {
                      const checked = selectedTopicNames.includes(tp.name);
                      return (
                        <label
                          key={tp.name}
                          className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--ink)]"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedTopicNames((prev) =>
                                checked
                                  ? prev.filter((x) => x !== tp.name)
                                  : [...prev, tp.name]
                              )
                            }
                            className="accent-[var(--e3)]"
                          />
                          <span className="font-mono-num text-[var(--mute)]">
                            {tp.specCode || '•'}
                          </span>
                          <span className="font-semibold">{tp.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-3.5">
                <button
                  type="button"
                  onClick={() => setSelectedTemplate(null)}
                  className="sd-btn px-3.5 py-2 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                >
                  Add {selectedTemplate.name}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

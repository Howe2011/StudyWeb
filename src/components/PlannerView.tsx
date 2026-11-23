import { FormEvent, useMemo, useState } from 'react';
import {
  Check,
  CheckSquare,
  Flag,
  Play,
  Plus,
  Star,
  Trash2,
  Undo2,
} from 'lucide-react';
import { makeId } from '../lib/workspaceStore';
import {
  StudySubject,
  TodoTaskItem,
  WorkspaceData,
} from '../types';

interface PlannerViewProps {
  workspace: WorkspaceData;
  onUpdateWorkspace: (updater: (prev: WorkspaceData) => WorkspaceData) => void;
  onStartStudySession?: (subjectName?: string) => void;
}

type TodoCategory = 'exam' | 'hw' | 'oth';
type TodoViewFilter = 'all' | 'star' | 'today' | 'done' | 'c:exam' | 'c:hw' | 'c:oth';
type TodoGroupMode = 'due' | 'cat' | 'sub' | 'pri' | 'none';
type TodoSortMode = 'due' | 'pri' | 'new' | 'az';

const CAT_META: Record<TodoCategory, { label: string; color: string }> = {
  exam: { label: 'Exam', color: 'var(--e1)' },
  hw: { label: 'Homework', color: 'var(--e2)' },
  oth: { label: 'Other', color: 'var(--e3)' },
};

const PRI_LABELS: Record<0 | 1 | 2 | 3, string> = {
  0: 'No priority',
  1: 'Low',
  2: 'Medium',
  3: 'High',
};

const SUBJ_ALIASES: Record<string, string> = {
  chem: 'chemistry',
  bio: 'biology',
  phys: 'physics',
  cs: 'computer',
  comp: 'computer',
  geo: 'geography',
  math: 'maths',
  eng: 'english',
  hist: 'history',
  fr: 'french',
  sp: 'spanish',
};

function addDaysIso(baseIso: string, days: number): string {
  const dt = new Date(`${baseIso}T12:00:00`);
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}

function dowMon0(iso: string): number {
  return (new Date(`${iso}T12:00:00`).getDay() + 6) % 7;
}

function dayDiff(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T12:00:00`).getTime();
  const b = new Date(`${toIso}T12:00:00`).getTime();
  return Math.round((b - a) / (24 * 3600 * 1000));
}

function formatShortDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function parseSmartTodo(
  raw: string,
  todayStr: string,
  subjects: StudySubject[]
): {
  title: string;
  dueDate: string;
  priority: 0 | 1 | 2 | 3;
  tags: string[];
  estMins: number;
  category: TodoCategory;
  subjectId?: string;
} {
  let r = ` ${raw} `;
  let dueDate = '';
  let priority: 0 | 1 | 2 | 3 = 0;

  const bangMatch = r.match(/(!{1,3})(?=\s)/);
  if (bangMatch) {
    priority = Math.min(3, bangMatch[1].length) as 1 | 2 | 3;
    r = r.replace(bangMatch[0], ' ');
  }
  if (/\b(urgent|asap)\b/i.test(r)) priority = 3;

  const tags: string[] = [];
  r = r.replace(/(^|\s)#([\w-]+)/g, (_full, _sp, tag) => {
    tags.push(String(tag).toLowerCase());
    return ' ';
  });

  let estMins = 0;
  const estMatch = r.match(/\s~(\d+)\s?(h|hr|m|min)?(?=\s)/i);
  if (estMatch) {
    estMins = Number(estMatch[1]) * (/^h/i.test(estMatch[2] || '') ? 60 : 1);
    r = r.replace(estMatch[0], ' ');
  }

  const WD = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|wed|thurs|thu|fri|sat|sun';
  const todayMatch = r.match(/\s(?:on |by |due )?(today|tonight)\s/i);
  const tmrMatch = r.match(/\s(?:on |by |due )?(tomorrow|tmrw|tmr)\s/i);
  const inDaysMatch = r.match(/\sin (\d+) days?\s/i);
  const nextWkMatch = r.match(/\s(?:by |due )?next week\s/i);
  const wdMatch = r.match(new RegExp(`\\s(?:(?:on|by|due|next|this) )?(${WD})\\s`, 'i'));

  if (todayMatch) {
    dueDate = todayStr;
    r = r.replace(todayMatch[0], ' ');
  } else if (tmrMatch) {
    dueDate = addDaysIso(todayStr, 1);
    r = r.replace(tmrMatch[0], ' ');
  } else if (inDaysMatch) {
    dueDate = addDaysIso(todayStr, Number(inDaysMatch[1]));
    r = r.replace(inDaysMatch[0], ' ');
  } else if (nextWkMatch) {
    dueDate = addDaysIso(todayStr, 7 - dowMon0(todayStr));
    r = r.replace(nextWkMatch[0], ' ');
  } else if (wdMatch) {
    const idx = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(
      wdMatch[1].slice(0, 3).toLowerCase()
    );
    const delta = (idx - dowMon0(todayStr) + 7) % 7;
    dueDate = addDaysIso(todayStr, delta || 7);
    r = r.replace(wdMatch[0], ' ');
  }

  const lower = raw.toLowerCase();
  const words = lower.match(/[a-z0-9]+/g) || [];
  let category: TodoCategory = 'oth';
  if (
    words.some((w) =>
      ['test', 'tests', 'exam', 'exams', 'mock', 'mocks', 'quiz', 'quizzes', 'assessment', 'finals'].includes(
        w
      )
    )
  ) {
    category = 'exam';
  } else if (
    words.some((w) =>
      ['hw', 'homework', 'assignment', 'worksheet', 'handin', 'essay', 'coursework', 'project'].includes(
        w
      )
    )
  ) {
    category = 'hw';
  }

  let subjectId: string | undefined;
  for (const tok of lower.match(/[a-z]+/g) || []) {
    const key = SUBJ_ALIASES[tok] || tok;
    if (key.length < 4) continue;
    const found = subjects.find((s) => s.name.toLowerCase().includes(key));
    if (found) {
      subjectId = found.id;
      break;
    }
  }

  const title =
    r
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s+(on|by|due|for|at)$/i, '') || raw.trim();

  return { title, dueDate, priority, tags, estMins, category, subjectId };
}

export function PlannerView({
  workspace,
  onUpdateWorkspace,
  onStartStudySession,
}: PlannerViewProps) {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Smart To-Do state
  const [quickInput, setQuickInput] = useState('');
  const [manualDue, setManualDue] = useState('');
  const [addToToday, setAddToToday] = useState(false);

  const [viewFilter, setViewFilter] = useState<TodoViewFilter>('all');
  const [searchQ, setSearchQ] = useState('');
  const [subjFilter, setSubjFilter] = useState('');
  const [priFilter, setPriFilter] = useState('');
  const [dueFilter, setDueFilter] = useState('');
  const [groupMode, setGroupMode] = useState<TodoGroupMode>('due');
  const [sortMode, setSortMode] = useState<TodoSortMode>('due');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newStepText, setNewStepText] = useState('');
  const [undoSnapshot, setUndoSnapshot] = useState<{ label: string; todos: TodoTaskItem[] } | null>(
    null
  );



  const subjById = useMemo(
    () => new Map(workspace.subjects.map((s) => [s.id, s])),
    [workspace.subjects]
  );

  const parsedPreview = useMemo(
    () => parseSmartTodo(quickInput, todayStr, workspace.subjects),
    [quickInput, todayStr, workspace.subjects]
  );

  const commitTodoChange = (
    label: string | null,
    updater: (todos: TodoTaskItem[]) => TodoTaskItem[]
  ) => {
    if (label) {
      setUndoSnapshot({ label, todos: workspace.todos });
    }
    onUpdateWorkspace((prev) => ({
      ...prev,
      todos: updater(prev.todos),
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleAddSmartTodo = (e: FormEvent) => {
    e.preventDefault();
    if (!quickInput.trim()) return;
    const p = parsedPreview;
    const catFromView: TodoCategory =
      p.category !== 'oth'
        ? p.category
        : viewFilter.startsWith('c:')
        ? (viewFilter.slice(2) as TodoCategory)
        : 'oth';

    const item: TodoTaskItem = {
      id: makeId('todo'),
      title: p.title,
      subjectId: p.subjectId,
      dueDate: manualDue || p.dueDate || (viewFilter === 'today' ? todayStr : ''),
      priority: p.priority,
      done: false,
      category: catFromView,
      starred: viewFilter === 'star',
      addedToday: addToToday ? todayStr : '',
      tags: p.tags,
      estMins: p.estMins || undefined,
      steps: [],
      note: '',
      repeat: '',
      createdAt: new Date().toISOString(),
    };
    commitTodoChange(null, (todos) => [item, ...todos]);
    setQuickInput('');
    setManualDue('');
    setAddToToday(false);
  };

  const handleToggleDone = (td: TodoTaskItem) => {
    const markingDone = !td.done;
    commitTodoChange(markingDone ? `"${td.title}" completed` : null, (todos) => {
      const updated = todos.map((x) =>
        x.id === td.id
          ? { ...x, done: markingDone, doneAt: markingDone ? todayStr : undefined }
          : x
      );
      if (markingDone && td.repeat) {
        const base = td.dueDate || todayStr;
        let nextDue = base;
        if (td.repeat === 'daily') nextDue = addDaysIso(base, 1);
        else if (td.repeat === 'weekly') nextDue = addDaysIso(base, 7);
        else if (td.repeat === 'weekdays') {
          const dw = dowMon0(base);
          nextDue = addDaysIso(base, dw >= 4 ? 7 - dw : 1);
        } else if (td.repeat === 'monthly') {
          const dt = new Date(`${base}T12:00:00`);
          dt.setMonth(dt.getMonth() + 1);
          nextDue = dt.toISOString().slice(0, 10);
        }
        updated.unshift({
          ...td,
          id: makeId('todo'),
          dueDate: nextDue,
          done: false,
          doneAt: undefined,
          steps: (td.steps || []).map((st) => ({ ...st, done: false })),
          createdAt: new Date().toISOString(),
        });
      }
      return updated;
    });
  };

  const handleUpdateTask = (id: string, patch: Partial<TodoTaskItem>) => {
    commitTodoChange(null, (todos) => todos.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const handleDeleteTask = (id: string) => {
    commitTodoChange('Task deleted', (todos) => todos.filter((t) => t.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const handleClearCompleted = () => {
    commitTodoChange('Completed tasks cleared', (todos) => todos.filter((t) => !t.done));
  };

  const handleUndo = () => {
    if (!undoSnapshot) return;
    const restored = undoSnapshot.todos;
    setUndoSnapshot(null);
    onUpdateWorkspace((prev) => ({
      ...prev,
      todos: restored,
      updatedAt: new Date().toISOString(),
    }));
  };

  const counts = useMemo(() => {
    const allOpen = workspace.todos.filter((t) => !t.done);
    return {
      all: allOpen.length,
      star: allOpen.filter((t) => t.starred).length,
      today: allOpen.filter((t) => t.addedToday === todayStr || t.dueDate === todayStr).length,
      done: workspace.todos.filter((t) => t.done).length,
      exam: allOpen.filter((t) => (t.category || 'oth') === 'exam').length,
      hw: allOpen.filter((t) => (t.category || 'oth') === 'hw').length,
      oth: allOpen.filter((t) => (t.category || 'oth') === 'oth').length,
    };
  }, [workspace.todos, todayStr]);

  const filteredTodos = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    return workspace.todos
      .filter((t) => {
        if (viewFilter === 'done') {
          if (!t.done) return false;
        } else {
          if (t.done) return false;
          if (viewFilter === 'star' && !t.starred) return false;
          if (viewFilter === 'today' && !(t.addedToday === todayStr || t.dueDate === todayStr)) {
            return false;
          }
          if (viewFilter.startsWith('c:') && (t.category || 'oth') !== viewFilter.slice(2)) {
            return false;
          }
        }
        if (q && !(t.title + ' ' + (t.note || '')).toLowerCase().includes(q)) return false;
        if (subjFilter && (t.subjectId || '') !== subjFilter) return false;
        if (priFilter !== '' && String(t.priority) !== priFilter) return false;
        if (dueFilter) {
          const diff = t.dueDate ? dayDiff(todayStr, t.dueDate) : null;
          if (dueFilter === 'over' && !(diff !== null && diff < 0)) return false;
          if (dueFilter === 'today' && diff !== 0) return false;
          if (dueFilter === 'week' && !(diff !== null && diff >= 0 && diff <= 7)) return false;
          if (dueFilter === 'none' && Boolean(t.dueDate)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const da = a.dueDate || '9999';
        const db = b.dueDate || '9999';
        if (sortMode === 'az') return a.title.localeCompare(b.title);
        if (sortMode === 'new') return b.createdAt.localeCompare(a.createdAt);
        if (sortMode === 'pri') return b.priority - a.priority || da.localeCompare(db);
        return da.localeCompare(db) || b.priority - a.priority;
      });
  }, [
    workspace.todos,
    viewFilter,
    searchQ,
    subjFilter,
    priFilter,
    dueFilter,
    sortMode,
    todayStr,
  ]);

  const groupedTodos = useMemo(() => {
    if (groupMode === 'none' || viewFilter === 'done') {
      return [['Tasks', filteredTodos]] as Array<[string, TodoTaskItem[]]>;
    }
    const groups = new Map<string, TodoTaskItem[]>();
    const addToGroup = (label: string, item: TodoTaskItem) => {
      const list = groups.get(label) || [];
      list.push(item);
      groups.set(label, list);
    };

    for (const t of filteredTodos) {
      if (groupMode === 'due') {
        if (!t.dueDate) addToGroup('No date', t);
        else {
          const diff = dayDiff(todayStr, t.dueDate);
          if (diff < 0) addToGroup('Overdue', t);
          else if (diff === 0) addToGroup('Today', t);
          else if (diff === 1) addToGroup('Tomorrow', t);
          else if (diff <= 6 - dowMon0(todayStr)) addToGroup('This week', t);
          else addToGroup('Later', t);
        }
      } else if (groupMode === 'cat') {
        addToGroup(CAT_META[t.category || 'oth'].label, t);
      } else if (groupMode === 'sub') {
        const s = t.subjectId ? subjById.get(t.subjectId) : undefined;
        addToGroup(s?.name || 'No subject', t);
      } else if (groupMode === 'pri') {
        addToGroup(PRI_LABELS[t.priority], t);
      }
    }

    const orderHint: Record<string, string[]> = {
      due: ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later', 'No date'],
      cat: ['Exam', 'Homework', 'Other'],
      pri: ['High', 'Medium', 'Low', 'No priority'],
    };
    const order = orderHint[groupMode];
    if (!order) return Array.from(groups.entries());
    const out: Array<[string, TodoTaskItem[]]> = [];
    order.forEach((lbl) => {
      const list = groups.get(lbl);
      if (list) out.push([lbl, list]);
    });
    return out;
  }, [filteredTodos, groupMode, viewFilter, todayStr, subjById]);

  // Daily progress header metrics
  const doneTodayCount = workspace.todos.filter((t) => t.done && t.doneAt === todayStr).length;
  const leftTodayCount = workspace.todos.filter(
    (t) => !t.done && ((t.dueDate && t.dueDate <= todayStr) || t.addedToday === todayStr)
  ).length;
  const overdueCount = workspace.todos.filter(
    (t) => !t.done && t.dueDate && t.dueDate < todayStr
  ).length;
  const nextExamTask = workspace.todos
    .filter((t) => !t.done && t.category === 'exam' && t.dueDate && t.dueDate >= todayStr)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-[var(--ink)] sm:text-3xl">
              Planner
            </h1>
            <p className="mt-1 text-sm text-[var(--mute)]">
              Smart natural-language To-Do manager and Today&apos;s plan.
            </p>
          </div>
          <div className="font-mono-num text-xs font-semibold text-[var(--mute)]">
            {counts.all} open · {counts.done} completed
          </div>
        </div>

        <div className="space-y-4">
            {/* Progress Header Card */}
            <div className="sd-card p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-lg font-bold text-[var(--ink)]">Today&apos;s Plan</h2>
                  <p className="mt-0.5 text-xs text-[var(--mute)]">
                    <strong className="text-[var(--ink)]">{doneTodayCount}</strong> done today,{' '}
                    <strong className="text-[var(--ink)]">{leftTodayCount}</strong> left for today
                    {overdueCount > 0 && (
                      <>
                        {' · '}
                        <span className="font-bold text-[var(--bad)]">{overdueCount} overdue</span>
                      </>
                    )}
                    {nextExamTask && (
                      <>
                        {' · '}Next exam: {nextExamTask.title} (
                        {dayDiff(todayStr, nextExamTask.dueDate) === 0
                          ? 'today'
                          : `in ${dayDiff(todayStr, nextExamTask.dueDate)} days`}
                        )
                      </>
                    )}
                  </p>
                </div>
                {undoSnapshot && (
                  <button
                    type="button"
                    onClick={handleUndo}
                    className="sd-btn px-3 py-1.5 text-xs text-[var(--e3)]"
                  >
                    <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Undo ({undoSnapshot.label})</span>
                  </button>
                )}
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--line)]">
                <div
                  className="h-full rounded-full bg-[var(--e3)] transition-[width] duration-300"
                  style={{
                    width: `${
                      doneTodayCount + leftTodayCount > 0
                        ? Math.round((doneTodayCount / (doneTodayCount + leftTodayCount)) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            {/* Natural Language Smart Add Card */}
            <form onSubmit={handleAddSmartTodo} className="sd-card space-y-2.5 p-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  type="text"
                  value={quickInput}
                  onChange={(e) => setQuickInput(e.target.value)}
                  placeholder="Add a task, e.g. chem test friday !! ~30m #paper1"
                  className="sd-input min-w-[220px] flex-1 py-2 text-sm"
                />
                <input
                  type="date"
                  value={manualDue}
                  onChange={(e) => setManualDue(e.target.value)}
                  aria-label="Due date override"
                  className="sd-input w-auto py-2 text-xs"
                />
                <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-[var(--mute)] whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={addToToday}
                    onChange={(e) => setAddToToday(e.target.checked)}
                    className="accent-[var(--e3)]"
                  />
                  <span>Add to Today</span>
                </label>
                <button type="submit" className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap">
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add</span>
                </button>
              </div>

              {/* Live Auto-detection Strip */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--mute)]">
                {!quickInput.trim() ? (
                  <span>
                    Tip: Type <code>today</code>, <code>tomorrow</code>, <code>friday</code>,{' '}
                    <code>!</code>/<code>!!</code> priority, <code>~30m</code>, or{' '}
                    <code>#tag</code>
                  </span>
                ) : (
                  <>
                    <span>Auto:</span>
                    <span
                      className="rounded-full border border-[var(--line)] px-2 py-0.5 font-semibold"
                      style={{ color: CAT_META[parsedPreview.category].color }}
                    >
                      {CAT_META[parsedPreview.category].label}
                    </span>
                    {parsedPreview.subjectId && subjById.get(parsedPreview.subjectId) && (
                      <span className="rounded-full border border-[var(--line)] px-2 py-0.5 font-semibold text-[var(--ink)]">
                        {subjById.get(parsedPreview.subjectId)!.name}
                      </span>
                    )}
                    {(manualDue || parsedPreview.dueDate) && (
                      <span className="rounded-full border border-[var(--line)] px-2 py-0.5 font-semibold text-[var(--e3)]">
                        {formatShortDate(manualDue || parsedPreview.dueDate)}
                      </span>
                    )}
                    {parsedPreview.priority > 0 && (
                      <span className="rounded-full border border-[var(--line)] px-2 py-0.5 font-semibold text-[var(--bad)]">
                        ⚑ {PRI_LABELS[parsedPreview.priority]}
                      </span>
                    )}
                    {parsedPreview.estMins > 0 && (
                      <span className="rounded-full border border-[var(--line)] px-2 py-0.5">
                        ⏱ {parsedPreview.estMins}m
                      </span>
                    )}
                    {parsedPreview.tags.map((tg) => (
                      <span
                        key={tg}
                        className="rounded-full border border-[var(--line)] px-2 py-0.5"
                      >
                        #{tg}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </form>

            {/* Left Filter Sidebar + Task Workspace */}
            <div className="grid gap-5 lg:grid-cols-12">
              <aside className="space-y-1.5 lg:col-span-3">
                {(
                  [
                    ['all', 'All tasks', counts.all],
                    ['today', 'Added to Today', counts.today],
                    ['star', 'Important ★', counts.star],
                    ['done', 'Completed', counts.done],
                  ] as const
                ).map(([v, label, cnt]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setViewFilter(v);
                      setExpandedId(null);
                    }}
                    className={`flex w-full cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                      viewFilter === v
                        ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--card))] text-[var(--e3)]'
                        : 'border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:bg-[var(--bg)]'
                    }`}
                  >
                    <span>{label}</span>
                    <span className="font-mono-num text-[11px] opacity-80">{cnt}</span>
                  </button>
                ))}

                <div className="px-1 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                  Types
                </div>
                {(
                  [
                    ['c:exam', 'Exam', counts.exam, CAT_META.exam.color],
                    ['c:hw', 'Homework', counts.hw, CAT_META.hw.color],
                    ['c:oth', 'Other', counts.oth, CAT_META.oth.color],
                  ] as const
                ).map(([v, label, cnt, color]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setViewFilter(v);
                      setExpandedId(null);
                    }}
                    className={`flex w-full cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                      viewFilter === v
                        ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--card))] text-[var(--e3)]'
                        : 'border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:bg-[var(--bg)]'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span>{label}</span>
                    </span>
                    <span className="font-mono-num text-[11px] opacity-80">{cnt}</span>
                  </button>
                ))}
              </aside>

              <div className="sd-card space-y-4 p-4 sm:p-5 lg:col-span-9">
                {/* Search, Filter, Group & Sort Controls */}
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder="Search tasks…"
                    className="sd-input min-w-[140px] flex-1 py-1.5 text-xs"
                  />
                  <select
                    aria-label="Filter by subject"
                    value={subjFilter}
                    onChange={(e) => setSubjFilter(e.target.value)}
                    className="sd-input w-auto py-1.5 text-xs"
                  >
                    <option value="">All subjects</option>
                    {workspace.subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter by priority"
                    value={priFilter}
                    onChange={(e) => setPriFilter(e.target.value)}
                    className="sd-input w-auto py-1.5 text-xs"
                  >
                    <option value="">Any priority</option>
                    <option value="3">High</option>
                    <option value="2">Medium</option>
                    <option value="1">Low</option>
                    <option value="0">None</option>
                  </select>
                  <select
                    aria-label="Filter by due date"
                    value={dueFilter}
                    onChange={(e) => setDueFilter(e.target.value)}
                    className="sd-input w-auto py-1.5 text-xs"
                  >
                    <option value="">Any date</option>
                    <option value="over">Overdue</option>
                    <option value="today">Today</option>
                    <option value="week">Next 7 days</option>
                    <option value="none">No date</option>
                  </select>
                  <select
                    aria-label="Group tasks"
                    value={groupMode}
                    onChange={(e) => setGroupMode(e.target.value as TodoGroupMode)}
                    className="sd-input w-auto py-1.5 text-xs"
                  >
                    <option value="due">Group: due date</option>
                    <option value="cat">Group: type</option>
                    <option value="sub">Group: subject</option>
                    <option value="pri">Group: priority</option>
                    <option value="none">No grouping</option>
                  </select>
                  <select
                    aria-label="Sort tasks"
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as TodoSortMode)}
                    className="sd-input w-auto py-1.5 text-xs"
                  >
                    <option value="due">Sort: due date</option>
                    <option value="pri">Sort: priority</option>
                    <option value="new">Sort: newest</option>
                    <option value="az">Sort: A to Z</option>
                  </select>
                </div>

                {/* Task Groups & Items */}
                {filteredTodos.length === 0 ? (
                  <div className="py-10 text-center text-xs text-[var(--mute)]">
                    <CheckSquare className="mx-auto mb-2 h-7 w-7 text-[var(--ok)]" aria-hidden="true" />
                    {workspace.todos.length === 0
                      ? 'No tasks yet. Type one above and press Enter.'
                      : 'Nothing matches these filters.'}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {groupedTodos.map(([groupLabel, items]) => (
                      <div key={groupLabel} className="space-y-1.5">
                        {groupMode !== 'none' && viewFilter !== 'done' && (
                          <div
                            className={`text-xs font-bold uppercase tracking-wider ${
                              groupLabel === 'Overdue' ? 'text-[var(--bad)]' : 'text-[var(--mute)]'
                            }`}
                          >
                            {groupLabel} · {items.length}
                          </div>
                        )}

                        <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--bg)]">
                          {items.map((td) => {
                            const subj = td.subjectId ? subjById.get(td.subjectId) : undefined;
                            const cat = CAT_META[td.category || 'oth'];
                            const diff = td.dueDate ? dayDiff(todayStr, td.dueDate) : null;
                            const isExpanded = expandedId === td.id;
                            const isAddedToday = td.addedToday === todayStr;

                            return (
                              <div key={td.id} className="p-3">
                                <div className="flex items-start gap-3">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleDone(td)}
                                    aria-label="Complete task"
                                    style={{ borderColor: td.done ? 'var(--ok)' : cat.color }}
                                    className={`mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 ${
                                      td.done
                                        ? 'bg-[var(--ok)] text-white'
                                        : 'bg-transparent text-transparent'
                                    }`}
                                  >
                                    {td.done && <Check className="h-3 w-3" aria-hidden="true" />}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => setExpandedId(isExpanded ? null : td.id)}
                                    className="min-w-0 flex-1 cursor-pointer text-left"
                                  >
                                    <div
                                      className={`text-sm font-semibold ${
                                        td.done
                                          ? 'line-through text-[var(--mute)]'
                                          : 'text-[var(--ink)]'
                                      }`}
                                    >
                                      {td.title}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--mute)]">
                                      <span style={{ color: cat.color }} className="font-semibold">
                                        {cat.label}
                                      </span>
                                      {subj && (
                                        <span className="font-semibold" style={{ color: subj.color }}>
                                          {subj.name}
                                        </span>
                                      )}
                                      {diff !== null && (
                                        <span
                                          className={
                                            diff < 0 && !td.done
                                              ? 'font-bold text-[var(--bad)]'
                                              : diff === 0
                                              ? 'font-bold text-[var(--e3)]'
                                              : ''
                                          }
                                        >
                                          {diff < 0 && !td.done
                                            ? `Overdue (${formatShortDate(td.dueDate)})`
                                            : diff === 0
                                            ? 'Today'
                                            : diff === 1
                                            ? 'Tomorrow'
                                            : formatShortDate(td.dueDate)}
                                        </span>
                                      )}
                                      {td.priority > 0 && (
                                        <span
                                          className="inline-flex items-center gap-0.5 font-semibold"
                                          style={{
                                            color:
                                              td.priority === 3
                                                ? 'var(--bad)'
                                                : td.priority === 2
                                                ? 'var(--e2)'
                                                : 'var(--e3)',
                                          }}
                                        >
                                          <Flag className="h-3 w-3" aria-hidden="true" />
                                          {PRI_LABELS[td.priority]}
                                        </span>
                                      )}
                                      {td.steps && td.steps.length > 0 && (
                                        <span>
                                          ☑ {td.steps.filter((s) => s.done).length}/
                                          {td.steps.length}
                                        </span>
                                      )}
                                      {td.repeat && <span>↻ {td.repeat}</span>}
                                      {td.estMins && <span>⏱ {td.estMins}m</span>}
                                      {td.tags?.map((tg) => (
                                        <span key={tg}>#{tg}</span>
                                      ))}
                                    </div>
                                  </button>

                                  <div className="flex shrink-0 items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleUpdateTask(td.id, { starred: !td.starred })
                                      }
                                      aria-label={td.starred ? 'Remove important' : 'Mark important'}
                                      className={`sd-btn h-7 w-7 p-0 ${
                                        td.starred ? 'text-[var(--e2)]' : 'text-[var(--mute)]'
                                      }`}
                                    >
                                      <Star
                                        className="h-3.5 w-3.5"
                                        fill={td.starred ? 'currentColor' : 'none'}
                                        aria-hidden="true"
                                      />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleUpdateTask(td.id, {
                                          addedToday: isAddedToday ? '' : todayStr,
                                        })
                                      }
                                      className={`sd-btn h-7 px-2 text-[11px] whitespace-nowrap ${
                                        isAddedToday ? 'border-[var(--e3)] text-[var(--e3)]' : ''
                                      }`}
                                    >
                                      {isAddedToday ? '✓ Today' : '+ Today'}
                                    </button>
                                  </div>
                                </div>

                                {/* Expanded Task Detail Editor */}
                                {isExpanded && (
                                  <div className="mt-3 space-y-3 border-t border-[var(--line)] pt-3">
                                    <input
                                      type="text"
                                      value={td.title}
                                      onChange={(e) =>
                                        handleUpdateTask(td.id, { title: e.target.value })
                                      }
                                      className="sd-input text-sm font-semibold"
                                    />

                                    <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                                      <label className="text-[11px] font-semibold text-[var(--mute)]">
                                        Due
                                        <input
                                          type="date"
                                          value={td.dueDate || ''}
                                          onChange={(e) =>
                                            handleUpdateTask(td.id, { dueDate: e.target.value })
                                          }
                                          className="sd-input mt-1 py-1 text-xs"
                                        />
                                      </label>
                                      <label className="text-[11px] font-semibold text-[var(--mute)]">
                                        Type
                                        <select
                                          value={td.category || 'oth'}
                                          onChange={(e) =>
                                            handleUpdateTask(td.id, {
                                              category: e.target.value as TodoCategory,
                                            })
                                          }
                                          className="sd-input mt-1 py-1 text-xs"
                                        >
                                          <option value="exam">Exam</option>
                                          <option value="hw">Homework</option>
                                          <option value="oth">Other</option>
                                        </select>
                                      </label>
                                      <label className="text-[11px] font-semibold text-[var(--mute)]">
                                        Subject
                                        <select
                                          value={td.subjectId || ''}
                                          onChange={(e) =>
                                            handleUpdateTask(td.id, {
                                              subjectId: e.target.value || undefined,
                                            })
                                          }
                                          className="sd-input mt-1 py-1 text-xs"
                                        >
                                          <option value="">No subject</option>
                                          {workspace.subjects.map((s) => (
                                            <option key={s.id} value={s.id}>
                                              {s.name}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                      <label className="text-[11px] font-semibold text-[var(--mute)]">
                                        Priority
                                        <select
                                          value={td.priority}
                                          onChange={(e) =>
                                            handleUpdateTask(td.id, {
                                              priority: Number(e.target.value) as 0 | 1 | 2 | 3,
                                            })
                                          }
                                          className="sd-input mt-1 py-1 text-xs"
                                        >
                                          <option value={0}>None</option>
                                          <option value={1}>Low</option>
                                          <option value={2}>Medium</option>
                                          <option value={3}>High</option>
                                        </select>
                                      </label>
                                      <label className="text-[11px] font-semibold text-[var(--mute)]">
                                        Repeat
                                        <select
                                          value={td.repeat || ''}
                                          onChange={(e) =>
                                            handleUpdateTask(td.id, {
                                              repeat: e.target.value as TodoTaskItem['repeat'],
                                            })
                                          }
                                          className="sd-input mt-1 py-1 text-xs"
                                        >
                                          <option value="">Never</option>
                                          <option value="daily">Daily</option>
                                          <option value="weekdays">Weekdays</option>
                                          <option value="weekly">Weekly</option>
                                          <option value="monthly">Monthly</option>
                                        </select>
                                      </label>
                                      <label className="text-[11px] font-semibold text-[var(--mute)]">
                                        Minutes
                                        <input
                                          type="number"
                                          min={0}
                                          value={td.estMins || ''}
                                          onChange={(e) =>
                                            handleUpdateTask(td.id, {
                                              estMins: Number(e.target.value) || undefined,
                                            })
                                          }
                                          className="sd-input mt-1 py-1 text-xs"
                                        />
                                      </label>
                                    </div>

                                    {/* Subtasks / Steps */}
                                    <div className="space-y-1.5">
                                      {(td.steps || []).map((st, idx) => (
                                        <div key={idx} className="flex items-center gap-2 text-xs">
                                          <input
                                            type="checkbox"
                                            checked={st.done}
                                            onChange={() => {
                                              const nextSteps = (td.steps || []).map((x, i) =>
                                                i === idx ? { ...x, done: !x.done } : x
                                              );
                                              handleUpdateTask(td.id, { steps: nextSteps });
                                            }}
                                            className="accent-[var(--ok)]"
                                          />
                                          <span
                                            className={`flex-1 ${
                                              st.done ? 'line-through text-[var(--mute)]' : ''
                                            }`}
                                          >
                                            {st.text}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const nextSteps = (td.steps || []).filter(
                                                (_, i) => i !== idx
                                              );
                                              handleUpdateTask(td.id, { steps: nextSteps });
                                            }}
                                            aria-label="Remove step"
                                            className="cursor-pointer text-[var(--mute)] hover:text-[var(--bad)]"
                                          >
                                            ✕
                                          </button>
                                        </div>
                                      ))}
                                      <div className="flex gap-2">
                                        <input
                                          type="text"
                                          value={newStepText}
                                          onChange={(e) => setNewStepText(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' && newStepText.trim()) {
                                              e.preventDefault();
                                              handleUpdateTask(td.id, {
                                                steps: [
                                                  ...(td.steps || []),
                                                  { text: newStepText.trim(), done: false },
                                                ],
                                              });
                                              setNewStepText('');
                                            }
                                          }}
                                          placeholder="+ Add a checklist step (Enter)"
                                          className="sd-input flex-1 py-1 text-xs"
                                        />
                                      </div>
                                    </div>

                                    <textarea
                                      rows={2}
                                      value={td.note || ''}
                                      onChange={(e) =>
                                        handleUpdateTask(td.id, { note: e.target.value })
                                      }
                                      placeholder="Task notes…"
                                      className="sd-input text-xs"
                                    />

                                    <div className="flex flex-wrap items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => onStartStudySession?.(subj?.name)}
                                        className="sd-btn-pri px-3 py-1.5 text-xs"
                                      >
                                        <Play className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span>Start study session</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleUpdateTask(td.id, {
                                            dueDate: addDaysIso(todayStr, 1),
                                          })
                                        }
                                        className="sd-btn px-3 py-1.5 text-xs"
                                      >
                                        Tomorrow
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleUpdateTask(td.id, {
                                            dueDate: addDaysIso(todayStr, 7 - dowMon0(todayStr)),
                                          })
                                        }
                                        className="sd-btn px-3 py-1.5 text-xs"
                                      >
                                        Next week
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteTask(td.id)}
                                        className="sd-btn px-3 py-1.5 text-xs text-[var(--bad)]"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span>Delete</span>
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {viewFilter === 'done' && counts.done > 0 && (
                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={handleClearCompleted}
                      className="sd-btn px-3 py-1.5 text-xs text-[var(--bad)]"
                    >
                      Clear completed
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}

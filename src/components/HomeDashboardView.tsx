import { FormEvent, PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CalendarDays,
  Check,
  CheckSquare,
  Globe,
  GripVertical,
  Layers,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  StickyNote,
  Target,
  Timer,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  DEFAULT_HOME_LAYOUT,
  homeWidgetsFromLayout,
  makeId,
} from '../lib/workspaceStore';
import {
  HomeWidgetId,
  HomeWidgetLayoutItem,
  LiveTimerState,
  PlannerSubTab,
  WorkspaceData,
  WorkspaceTab,
} from '../types';

interface HomeDashboardViewProps {
  workspace: WorkspaceData;
  onUpdateWorkspace: (updater: (prev: WorkspaceData) => WorkspaceData) => void;
  onNavigate: (
    tab: WorkspaceTab,
    opts?: {
      subjectId?: string;
      topicId?: string;
      plannerTab?: PlannerSubTab;
      openQuickAdd?: boolean;
      communityTypeFilter?: 'all' | 'notes' | 'flashcards' | 'subject';
    }
  ) => void;
  onOpenImport: () => void;
  liveTimer: LiveTimerState;
  timerRemainingSec: number;
  timerDurationMins: number;
  onToggleTimer: () => void;
  onResetTimer: (mins?: number) => void;
}

interface WidgetMeta {
  id: HomeWidgetId;
  label: string;
  desc: string;
  category: 'Home & Tasks' | 'Progress & Goals' | 'Flashcards & Quiz';
  defaultCols: number;
}

const WIDGET_CATALOG: WidgetMeta[] = [
  {
    id: 'dueCards',
    label: 'Active Recall Queue',
    desc: 'Due flashcards count and instant study / Live Quiz shortcuts.',
    category: 'Flashcards & Quiz',
    defaultCols: 7,
  },
  {
    id: 'timer',
    label: 'Focus Timer',
    desc: 'Live countdown timer with 25m / 50m focus presets.',
    category: 'Home & Tasks',
    defaultCols: 5,
  },
  {
    id: 'schedule',
    label: "Today's Schedule",
    desc: 'Planned blocks for today with 1-click completion.',
    category: 'Home & Tasks',
    defaultCols: 6,
  },
  {
    id: 'todos',
    label: 'Quick To-Do',
    desc: 'Fast task capture linked to subjects and priorities.',
    category: 'Home & Tasks',
    defaultCols: 6,
  },
  {
    id: 'mastery',
    label: 'Subject Mastery',
    desc: 'Topic confidence and flashcard mastery across your subjects.',
    category: 'Progress & Goals',
    defaultCols: 12,
  },
  {
    id: 'dailyGoal',
    label: 'Daily Study Target',
    desc: 'Adjust daily study minutes target and track streak progress.',
    category: 'Progress & Goals',
    defaultCols: 4,
  },
  {
    id: 'examCountdowns',
    label: 'Exam Countdowns',
    desc: 'Days remaining until upcoming subject exam dates.',
    category: 'Progress & Goals',
    defaultCols: 4,
  },
  {
    id: 'scratchpad',
    label: 'Quick Scratchpad',
    desc: 'Auto-saving pad for formulas, mnemonics, and quick jottings.',
    category: 'Home & Tasks',
    defaultCols: 4,
  },
  {
    id: 'flashcardBreakdown',
    label: 'Leitner Box Breakdown',
    desc: 'Visual breakdown of cards across Box 1 to Box 5 plus flagged items.',
    category: 'Flashcards & Quiz',
    defaultCols: 6,
  },
  {
    id: 'liveQuiz',
    label: 'Live Quiz & Shared Notes',
    desc: 'Jump directly into multiplayer quizzes or browse classmates’ notes.',
    category: 'Flashcards & Quiz',
    defaultCols: 6,
  },
];

const COL_SPAN_CLASS: Record<number, string> = {
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  5: 'lg:col-span-5',
  6: 'lg:col-span-6',
  7: 'lg:col-span-7',
  8: 'lg:col-span-8',
  9: 'lg:col-span-9',
  10: 'lg:col-span-10',
  11: 'lg:col-span-11',
  12: 'lg:col-span-12',
};

function daysUntilDate(dateStr: string): number | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const target = new Date(`${dateStr}T09:00:00`).getTime();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target - now.getTime()) / (24 * 3600 * 1000));
}

export function HomeDashboardView({
  workspace,
  onUpdateWorkspace,
  onNavigate,
  onOpenImport,
  liveTimer,
  timerRemainingSec,
  timerDurationMins,
  onToggleTimer,
  onResetTimer,
}: HomeDashboardViewProps) {
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [dragWidgetId, setDragWidgetId] = useState<HomeWidgetId | null>(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState<HomeWidgetId | null>(null);
  const [quickTodoText, setQuickTodoText] = useState('');
  const [quickTodoSubj, setQuickTodoSubj] = useState('');
  const gridRef = useRef<HTMLDivElement | null>(null);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const nowMs = Date.now();

  const layout: HomeWidgetLayoutItem[] = useMemo(
    () =>
      workspace.homeLayout && workspace.homeLayout.length >= 0
        ? workspace.homeLayout
        : DEFAULT_HOME_LAYOUT.map((w) => ({ ...w })),
    [workspace.homeLayout]
  );

  const activeWidgetIds = useMemo(() => new Set(layout.map((w) => w.id)), [layout]);

  const dueCount = useMemo(
    () => workspace.flashcards.filter((c) => c.dueAt <= nowMs).length,
    [workspace.flashcards, nowMs]
  );

  const flaggedCount = useMemo(
    () => workspace.flashcards.filter((c) => c.flagged).length,
    [workspace.flashcards]
  );

  const boxCounts = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    workspace.flashcards.forEach((c) => {
      const idx = Math.max(0, Math.min(4, (c.box || 1) - 1));
      counts[idx] += 1;
    });
    return counts;
  }, [workspace.flashcards]);

  const todaysBlocks = useMemo(
    () =>
      workspace.calendarBlocks
        .filter((b) => b.date === todayStr)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [workspace.calendarBlocks, todayStr]
  );

  const todayPlannedMinsDone = useMemo(
    () =>
      todaysBlocks
        .filter((b) => b.done)
        .reduce((acc, b) => acc + (b.durationMins || 25), 0),
    [todaysBlocks]
  );

  const upcomingExams = useMemo(() => {
    return workspace.subjects
      .map((s) => ({
        subject: s,
        days: daysUntilDate(s.examDate),
      }))
      .filter(
        (item): item is { subject: typeof item.subject; days: number } =>
          item.days !== null && item.days >= 0
      )
      .sort((a, b) => a.days - b.days)
      .slice(0, 6);
  }, [workspace.subjects]);

  const activeTodos = useMemo(
    () =>
      workspace.todos
        .filter((t) => !t.done)
        .sort(
          (a, b) =>
            b.priority - a.priority ||
            (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
        )
        .slice(0, 6),
    [workspace.todos]
  );

  const subjectStats = useMemo(() => {
    return workspace.subjects.map((subj) => {
      const topics = workspace.topics.filter((t) => t.subjectId === subj.id);
      const completedTopics = topics.filter(
        (t) => t.completed || t.confidence === 3
      ).length;
      const cards = workspace.flashcards.filter((c) => c.subjectId === subj.id);
      const masteredCards = cards.filter((c) => c.box >= 4).length;
      return {
        subj,
        topicCount: topics.length,
        completedTopics,
        cardCount: cards.length,
        masteredCards,
      };
    });
  }, [workspace.subjects, workspace.topics, workspace.flashcards]);

  const setHomeLayout = (updater: (prev: HomeWidgetLayoutItem[]) => HomeWidgetLayoutItem[]) => {
    onUpdateWorkspace((prev) => {
      const current = prev.homeLayout ?? DEFAULT_HOME_LAYOUT.map((w) => ({ ...w }));
      const nextLayout = updater(current);
      return {
        ...prev,
        homeLayout: nextLayout,
        homeWidgets: homeWidgetsFromLayout(nextLayout),
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const addWidget = (id: HomeWidgetId) => {
    const meta = WIDGET_CATALOG.find((m) => m.id === id);
    setHomeLayout((prev) => {
      if (prev.some((w) => w.id === id)) return prev;
      return [...prev, { id, cols: meta?.defaultCols || 6, h: null }];
    });
  };

  const removeWidget = (id: HomeWidgetId) => {
    setHomeLayout((prev) => prev.filter((w) => w.id !== id));
  };

  const moveWidget = (index: number, delta: -1 | 1) => {
    setHomeLayout((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  };

  const reorderWidgets = (fromId: HomeWidgetId, toId: HomeWidgetId) => {
    if (fromId === toId) return;
    setHomeLayout((prev) => {
      const fromIdx = prev.findIndex((w) => w.id === fromId);
      const toIdx = prev.findIndex((w) => w.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
  };

  const updateWidgetSize = (
    id: HomeWidgetId,
    patch: { cols?: number; h?: number | null }
  ) => {
    setHomeLayout((prev) =>
      prev.map((w) =>
        w.id === id
          ? {
              ...w,
              cols:
                patch.cols !== undefined
                  ? Math.max(3, Math.min(12, Math.round(patch.cols)))
                  : w.cols,
              h:
                patch.h !== undefined
                  ? patch.h === null
                    ? null
                    : Math.max(180, Math.min(760, Math.round(patch.h)))
                  : w.h,
            }
          : w
      )
    );
  };

  const handleResetWidgets = () => {
    setHomeLayout(() => DEFAULT_HOME_LAYOUT.map((w) => ({ ...w })));
  };

  // Interactive edge/corner pointer resize (matching original planner resize feel)
  const startResize = (
    e: ReactPointerEvent<HTMLDivElement>,
    item: HomeWidgetLayoutItem,
    mode: 'width' | 'both'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const cardEl = (e.currentTarget as HTMLElement).closest('section') as HTMLElement | null;
    const gridEl = gridRef.current;
    if (!cardEl || !gridEl) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const startCols = item.cols;
    const startH = cardEl.getBoundingClientRect().height;
    const gridWidth = gridEl.getBoundingClientRect().width || 1100;
    const colWidth = gridWidth / 12;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const nextCols = Math.max(3, Math.min(12, Math.round(startCols + dx / colWidth)));
      const nextH =
        mode === 'both' ? Math.max(190, Math.min(720, Math.round(startH + dy))) : item.h;
      updateWidgetSize(item.id, {
        cols: nextCols,
        ...(mode === 'both' ? { h: nextH } : {}),
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleQuickAddTodo = (e: FormEvent) => {
    e.preventDefault();
    const title = quickTodoText.trim();
    if (!title) return;
    onUpdateWorkspace((prev) => ({
      ...prev,
      todos: [
        {
          id: makeId('todo'),
          title,
          subjectId: quickTodoSubj || undefined,
          dueDate: todayStr,
          priority: 2,
          done: false,
          createdAt: new Date().toISOString(),
        },
        ...prev.todos,
      ],
      updatedAt: new Date().toISOString(),
    }));
    setQuickTodoText('');
  };

  const toggleTodoDone = (todoId: string) => {
    onUpdateWorkspace((prev) => ({
      ...prev,
      todos: prev.todos.map((t) =>
        t.id === todoId
          ? {
              ...t,
              done: !t.done,
              doneAt: !t.done ? new Date().toISOString() : undefined,
            }
          : t
      ),
      updatedAt: new Date().toISOString(),
    }));
  };

  const toggleBlockDone = (blockId: string) => {
    onUpdateWorkspace((prev) => ({
      ...prev,
      calendarBlocks: prev.calendarBlocks.map((b) =>
        b.id === blockId ? { ...b, done: !b.done } : b
      ),
      updatedAt: new Date().toISOString(),
    }));
  };

  const mm = String(Math.floor(timerRemainingSec / 60)).padStart(2, '0');
  const ss = String(timerRemainingSec % 60).padStart(2, '0');
  const dailyGoalMins = workspace.dailyGoalMinutes || 60;
  const dailyProgressMins =
    todayPlannedMinsDone > 0
      ? todayPlannedMinsDone
      : workspace.lastStudyDate === todayStr
      ? Math.min(dailyGoalMins * 2, workspace.studyMinutesLogged)
      : 0;
  const dailyGoalPct = Math.min(100, Math.round((dailyProgressMins / dailyGoalMins) * 100));

  const renderWidgetBody = (id: HomeWidgetId) => {
    switch (id) {
      case 'dueCards':
        return (
          <div className="flex h-full flex-col justify-between">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--e3)]">
                  Active Recall Queue
                </div>
                <h2 className="font-display mt-1 text-xl font-bold text-[var(--ink)]">
                  {dueCount > 0
                    ? `${dueCount} flashcard${dueCount === 1 ? '' : 's'} due for review`
                    : workspace.flashcards.length > 0
                    ? 'All scheduled cards caught up'
                    : 'Create your first flashcard deck'}
                </h2>
                <p className="mt-1 text-sm text-[var(--mute)]">
                  {workspace.flashcards.length} total cards across {workspace.subjects.length}{' '}
                  subject{workspace.subjects.length === 1 ? '' : 's'} · Flip &amp; Type-to-Recall modes
                </p>
              </div>
              <div className="font-mono-num text-3xl font-extrabold text-[var(--e3)]">
                {dueCount}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => onNavigate('flashcards')}
                className="sd-btn-pri px-4 py-2 text-sm whitespace-nowrap shrink-0"
              >
                <Layers className="h-4 w-4" aria-hidden="true" />
                <span>{dueCount > 0 ? 'Start Review Session' : 'Open Flashcards'}</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('quiz')}
                className="sd-btn px-4 py-2 text-sm whitespace-nowrap shrink-0"
              >
                <Zap className="h-4 w-4 text-[var(--e2)]" aria-hidden="true" />
                <span>Host Live Quiz</span>
              </button>
            </div>
          </div>
        );

      case 'timer':
        return (
          <div className="flex h-full flex-col justify-between">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                <Timer className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                <span>Focus Timer</span>
              </div>
              <span className="font-mono-num text-xs text-[var(--mute)]">
                {timerDurationMins}m session
              </span>
            </div>

            <div className="my-3 flex items-baseline justify-between gap-3">
              <div className="font-mono-num text-4xl font-extrabold tracking-tight text-[var(--ink)]">
                {mm}:{ss}
              </div>
              <div className="text-xs text-[var(--mute)]">
                {liveTimer.running ? 'Running' : 'Ready'}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onToggleTimer}
                className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap shrink-0"
              >
                {liveTimer.running ? (
                  <>
                    <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Start Focus</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => onResetTimer(25)}
                className="sd-btn px-3 py-2 text-xs whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>25m</span>
              </button>
              <button
                type="button"
                onClick={() => onResetTimer(50)}
                className="sd-btn px-3 py-2 text-xs whitespace-nowrap shrink-0"
              >
                <span>50m</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('planner', { plannerTab: 'timer' })}
                className="sd-btn px-3 py-2 text-xs whitespace-nowrap shrink-0"
              >
                <span>Full Timer</span>
              </button>
            </div>
          </div>
        );

      case 'schedule':
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
                <h2 className="font-display flex items-center gap-2 text-lg font-bold text-[var(--ink)]">
                  <CalendarDays className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                  <span>Today&apos;s Schedule</span>
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('calendar')}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                >
                  Open Calendar →
                </button>
              </div>

              {upcomingExams.length > 0 && !activeWidgetIds.has('examCountdowns') && (
                <div className="mt-4">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                    Next Exams
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {upcomingExams.slice(0, 2).map(({ subject, days }) => (
                      <div
                        key={subject.id}
                        className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs"
                      >
                        <span className="flex min-w-0 items-center gap-2 font-semibold text-[var(--ink)]">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: subject.color }}
                          />
                          <span className="truncate">{subject.name}</span>
                        </span>
                        <span className="font-mono-num shrink-0 font-bold text-[var(--e2)]">
                          {days === 0 ? 'Today' : `${days}d`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                  Scheduled Sessions Today ({todaysBlocks.length})
                </div>
                {todaysBlocks.length === 0 ? (
                  <div className="mt-2 rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-4 text-xs text-[var(--mute)]">
                    No blocks planned for today. Use{' '}
                    <button
                      type="button"
                      onClick={() => onNavigate('calendar')}
                      className="cursor-pointer font-semibold text-[var(--e3)] hover:underline"
                    >
                      Auto-Plan Week
                    </button>{' '}
                    to schedule revision around your exams.
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {todaysBlocks.map((blk) => (
                      <button
                        key={blk.id}
                        type="button"
                        onClick={() => toggleBlockDone(blk.id)}
                        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-left text-xs transition-colors hover:border-[var(--e3)]"
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              blk.done
                                ? 'border-[var(--ok)] bg-[var(--ok)] text-white'
                                : 'border-[var(--mute)]'
                            }`}
                          >
                            {blk.done && <Check className="h-3 w-3" aria-hidden="true" />}
                          </span>
                          <span
                            className={`truncate font-semibold ${
                              blk.done ? 'line-through text-[var(--mute)]' : 'text-[var(--ink)]'
                            }`}
                          >
                            {blk.title}
                          </span>
                        </span>
                        <span className="font-mono-num shrink-0 text-[var(--mute)]">
                          {blk.startTime} · {blk.durationMins}m
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case 'todos':
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
                <h2 className="font-display flex items-center gap-2 text-lg font-bold text-[var(--ink)]">
                  <CheckSquare className="h-4 w-4 text-[var(--ok)]" aria-hidden="true" />
                  <span>Quick To-Do</span>
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('planner', { plannerTab: 'todo' })}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                >
                  All Tasks ({workspace.todos.length}) →
                </button>
              </div>

              <form onSubmit={handleQuickAddTodo} className="mt-4 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={quickTodoText}
                  onChange={(e) => setQuickTodoText(e.target.value)}
                  placeholder="Add a revision task…"
                  className="sd-input min-w-0 flex-1 py-1.5 text-sm"
                />
                {workspace.subjects.length > 0 && (
                  <select
                    aria-label="Task subject"
                    value={quickTodoSubj}
                    onChange={(e) => setQuickTodoSubj(e.target.value)}
                    className="sd-input w-auto max-w-[140px] py-1.5 text-xs"
                  >
                    <option value="">General</option>
                    {workspace.subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="submit"
                  className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add</span>
                </button>
              </form>

              <div className="mt-3 space-y-2">
                {activeTodos.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-4 text-xs text-[var(--mute)]">
                    No open to-do tasks. Add one above or open Planner for smart dates &amp; priorities.
                  </p>
                ) : (
                  activeTodos.map((td) => {
                    const subj = td.subjectId
                      ? workspace.subjects.find((s) => s.id === td.subjectId)
                      : null;
                    return (
                      <button
                        key={td.id}
                        type="button"
                        onClick={() => toggleTodoDone(td.id)}
                        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-left text-xs transition-colors hover:border-[var(--e3)]"
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--mute)]" />
                          <span className="truncate font-semibold text-[var(--ink)]">
                            {td.title}
                          </span>
                        </span>
                        <span className="shrink-0 text-[var(--mute)]">
                          {subj ? `${subj.name} · ` : ''}
                          {td.priority === 3 ? 'High' : td.priority === 1 ? 'Low' : 'Normal'}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );

      case 'mastery':
        return (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
              <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                Your Subjects
              </h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('subjects', { openQuickAdd: true })}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                >
                  + Quick-Add Subjects
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('progress')}
                  className="cursor-pointer text-xs font-semibold text-[var(--mute)] hover:text-[var(--ink)] whitespace-nowrap"
                >
                  Detailed Progress →
                </button>
              </div>
            </div>

            {workspace.subjects.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-5 text-center text-xs text-[var(--mute)]">
                No subjects added yet. Click &ldquo;+ Quick-Add Subjects&rdquo; to pick from 22 GCSE templates.
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {subjectStats.map(
                  ({ subj, topicCount, completedTopics, cardCount, masteredCards }) => {
                    const topicPct =
                      topicCount > 0 ? Math.round((completedTopics / topicCount) * 100) : 0;
                    return (
                      <button
                        key={subj.id}
                        type="button"
                        onClick={() => onNavigate('notes', { subjectId: subj.id })}
                        className="flex cursor-pointer flex-col justify-between rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 text-left transition-colors hover:border-[var(--e3)]"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-2 font-display text-base font-bold text-[var(--ink)]">
                              <span
                                className="h-3 w-3 shrink-0 rounded-full"
                                style={{ backgroundColor: subj.color }}
                              />
                              <span className="truncate">{subj.name}</span>
                            </span>
                            <span className="text-xs text-[var(--mute)]">{subj.examBoard}</span>
                          </div>
                          <div className="font-mono-num mt-2 flex items-center gap-3 text-xs text-[var(--mute)]">
                            <span>
                              {completedTopics}/{topicCount} topics
                            </span>
                            <span>·</span>
                            <span>
                              {masteredCards}/{cardCount} cards mastered
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
                          <div
                            className="h-full transition-all"
                            style={{
                              width: `${topicPct}%`,
                              backgroundColor: subj.color,
                            }}
                          />
                        </div>
                      </button>
                    );
                  }
                )}
              </div>
            )}
          </div>
        );

      case 'dailyGoal':
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--ok)]">
                  <Target className="h-4 w-4" aria-hidden="true" />
                  <span>Daily Study Target</span>
                </span>
                <span className="font-mono-num text-xs font-bold text-[var(--mute)]">
                  {workspace.studyStreakDays}d streak
                </span>
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-2">
                <div className="font-mono-num text-3xl font-extrabold text-[var(--ink)]">
                  {dailyProgressMins}m
                  <span className="text-sm font-semibold text-[var(--mute)]">
                    {' '}
                    / {dailyGoalMins}m
                  </span>
                </div>
                <span className="font-mono-num text-xs font-bold text-[var(--ok)]">
                  {dailyGoalPct}%
                </span>
              </div>
              <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[var(--line)]">
                <div
                  className="h-full bg-[var(--ok)] transition-all"
                  style={{ width: `${dailyGoalPct}%` }}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-3">
              <span className="text-[11px] font-semibold text-[var(--mute)]">Target:</span>
              <div className="flex items-center gap-1">
                {[30, 60, 90, 120].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() =>
                      onUpdateWorkspace((prev) => ({
                        ...prev,
                        dailyGoalMinutes: mins,
                        updatedAt: new Date().toISOString(),
                      }))
                    }
                    className={`cursor-pointer rounded-md border px-2 py-0.5 font-mono-num text-[11px] font-semibold ${
                      dailyGoalMins === mins
                        ? 'border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_12%,var(--bg))] text-[var(--ok)]'
                        : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)]'
                    }`}
                  >
                    {mins}m
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      case 'examCountdowns':
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--e2)]">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  <span>Exam Countdowns</span>
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('subjects')}
                  className="cursor-pointer text-[11px] font-semibold text-[var(--e3)] hover:underline"
                >
                  Edit dates
                </button>
              </div>
              {upcomingExams.length === 0 ? (
                <p className="mt-3 text-xs leading-relaxed text-[var(--mute)]">
                  No upcoming exam dates set yet. Edit any subject in Subjects to add an exam date.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {upcomingExams.map(({ subject, days }) => (
                    <div
                      key={subject.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: subject.color }}
                        />
                        <span className="truncate font-semibold text-[var(--ink)]">
                          {subject.name}
                        </span>
                      </span>
                      <span className="font-mono-num shrink-0 font-bold text-[var(--e2)]">
                        {days === 0 ? 'Today' : `${days}d`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );

      case 'scratchpad':
        return (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-2 pb-2">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                <StickyNote className="h-4 w-4 text-[var(--e2)]" aria-hidden="true" />
                <span>Quick Scratchpad</span>
              </span>
              <span className="text-[11px] text-[var(--mute)]">Auto-saved</span>
            </div>
            <textarea
              value={workspace.scratchpad || ''}
              onChange={(e) =>
                onUpdateWorkspace((prev) => ({
                  ...prev,
                  scratchpad: e.target.value,
                  updatedAt: new Date().toISOString(),
                }))
              }
              placeholder="Write formulas, mnemonics, weak subtopics, or quick reminders…"
              className="sd-input min-h-[120px] flex-1 resize-none text-xs leading-relaxed"
            />
          </div>
        );

      case 'flashcardBreakdown': {
        const total = Math.max(1, workspace.flashcards.length);
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--e3)]">
                  <Layers className="h-4 w-4" aria-hidden="true" />
                  <span>Leitner Box Breakdown</span>
                </span>
                <span className="font-mono-num text-xs text-[var(--mute)]">
                  {flaggedCount} flagged
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {boxCounts.map((count, idx) => {
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <span className="font-mono-num w-12 shrink-0 text-[var(--mute)]">
                        Box {idx + 1}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--line)]">
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${workspace.flashcards.length > 0 ? pct : 0}%`,
                            backgroundColor: idx >= 3 ? 'var(--ok)' : 'var(--e3)',
                          }}
                        />
                      </div>
                      <span className="font-mono-num w-8 shrink-0 text-right font-semibold text-[var(--ink)]">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => onNavigate('flashcards')}
                className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
              >
                Open Flashcards →
              </button>
            </div>
          </div>
        );
      }

      case 'liveQuiz':
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--e2)]">
                <Globe className="h-4 w-4" aria-hidden="true" />
                <span>Multiplayer &amp; Shared Library</span>
              </div>
              <h2 className="font-display mt-1 text-lg font-bold text-[var(--ink)]">
                Compete or Copy Classmates&apos; Notes
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[var(--mute)]">
                Host a live recall quiz room from your decks or browse structured notes shared by other students.
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigate('quiz')}
                className="sd-btn-pri px-3.5 py-2 text-xs whitespace-nowrap"
              >
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Live Quiz Arena</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  onNavigate('community', { communityTypeFilter: 'notes' })
                }
                className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap"
              >
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Browse Others&apos; Notes</span>
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        {/* Header Row */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-[var(--ink)] sm:text-3xl">
              Revision Home
            </h1>
            <p className="mt-1 text-sm text-[var(--mute)]">
              <span className="font-mono-num font-semibold text-[var(--ink)]">
                {workspace.studyStreakDays} day streak
              </span>{' '}
              ·{' '}
              <span className="font-mono-num">
                {workspace.studyMinutesLogged} mins logged
              </span>{' '}
              ·{' '}
              <span className="font-mono-num">{workspace.subjects.length} subjects</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenImport}
              className="sd-btn-pri px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Import Notes / Quizlet</span>
            </button>
            <button
              type="button"
              onClick={() => setCustomizeOpen((v) => !v)}
              aria-expanded={customizeOpen}
              className={`sd-btn px-3.5 py-2 text-xs whitespace-nowrap shrink-0 ${
                customizeOpen ? 'border-[var(--e3)] text-[var(--e3)]' : ''
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{customizeOpen ? 'Done Customizing' : 'Customize Widgets'}</span>
            </button>
          </div>
        </div>

        {/* Interactive Widget Customizer Tray */}
        {customizeOpen && (
          <section className="sd-card space-y-4 border-[var(--e3)] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-[var(--ink)]">
                  Customize Home Widgets ({layout.length} active)
                </h2>
                <p className="text-xs text-[var(--mute)]">
                  Add or remove widgets below · Drag cards or use ↑ ↓ arrows to reorder · Use width presets or drag edges to resize.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetWidgets}
                  className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Reset Default</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCustomizeOpen(false)}
                  className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap"
                >
                  Done
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {(['Home & Tasks', 'Progress & Goals', 'Flashcards & Quiz'] as const).map((cat) => (
                <div
                  key={cat}
                  className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 space-y-2"
                >
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                    {cat}
                  </div>
                  <div className="space-y-1.5">
                    {WIDGET_CATALOG.filter((m) => m.category === cat).map((meta) => {
                      const active = activeWidgetIds.has(meta.id);
                      return (
                        <div
                          key={meta.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--card)] px-2.5 py-2"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-xs font-bold text-[var(--ink)]">
                              {meta.label}
                            </div>
                            <div className="truncate text-[11px] text-[var(--mute)]">
                              {meta.desc}
                            </div>
                          </div>
                          {active ? (
                            <button
                              type="button"
                              onClick={() => removeWidget(meta.id)}
                              className="sd-btn shrink-0 px-2 py-1 text-[11px] text-[var(--bad)] whitespace-nowrap"
                            >
                              Remove
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => addWidget(meta.id)}
                              className="sd-btn-pri shrink-0 px-2.5 py-1 text-[11px] whitespace-nowrap"
                            >
                              + Add
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Beginner Onboarding Empty State */}
        {workspace.subjects.length === 0 && (
          <section className="sd-card p-6 sm:p-8">
            <div className="max-w-2xl">
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--e3)]">
                Quick Start · Takes under 30 seconds
              </div>
              <h2 className="font-display mt-1 text-2xl font-extrabold text-[var(--ink)]">
                Set up your revision workspace in 3 simple ways
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[var(--mute)]">
                Pick GCSE / A-Level subjects with ready-made syllabus topics, paste Quizlet sets or
                Word notes cleanly in zero-AI instant mode, or copy revision notes shared by friends.
              </p>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => onNavigate('subjects', { openQuickAdd: true })}
                className="flex cursor-pointer flex-col justify-between rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 text-left transition-colors hover:border-[var(--e3)]"
              >
                <div>
                  <BookOpen className="h-5 w-5 text-[var(--e3)]" aria-hidden="true" />
                  <div className="mt-2.5 font-display text-base font-bold text-[var(--ink)]">
                    1. Quick-Add Subjects
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--mute)]">
                    22 GCSE subjects with specification topics, starter summaries &amp; key terms.
                  </p>
                </div>
                <div className="mt-3 text-xs font-bold text-[var(--e3)]">Choose subjects →</div>
              </button>

              <button
                type="button"
                onClick={onOpenImport}
                className="flex cursor-pointer flex-col justify-between rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 text-left transition-colors hover:border-[var(--e3)]"
              >
                <div>
                  <Upload className="h-5 w-5 text-[var(--ok)]" aria-hidden="true" />
                  <div className="mt-2.5 font-display text-base font-bold text-[var(--ink)]">
                    2. Import Notes / Quizlet
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--mute)]">
                    Paste Quizlet TSV, CSV, Markdown, or upload Word (.docx) files into clean cards &amp; notes.
                  </p>
                </div>
                <div className="mt-3 text-xs font-bold text-[var(--ok)]">Open Importer →</div>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('community', { communityTypeFilter: 'notes' })}
                className="flex cursor-pointer flex-col justify-between rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 text-left transition-colors hover:border-[var(--e3)]"
              >
                <div>
                  <Globe className="h-5 w-5 text-[var(--e2)]" aria-hidden="true" />
                  <div className="mt-2.5 font-display text-base font-bold text-[var(--ink)]">
                    3. Browse Shared Notes
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--mute)]">
                    Read classmates&apos; notes, enter a 6-letter share code, or copy decks straight into your workspace.
                  </p>
                </div>
                <div className="mt-3 text-xs font-bold text-[var(--e2)]">Explore shares →</div>
              </button>
            </div>
          </section>
        )}

        {/* Customizable 12-Column Widget Grid */}
        {layout.length === 0 ? (
          <div className="sd-card p-8 text-center">
            <p className="text-sm text-[var(--mute)]">
              All widgets are currently hidden. Click &ldquo;Customize Widgets&rdquo; above to add widgets back.
            </p>
            <button
              type="button"
              onClick={handleResetWidgets}
              className="sd-btn-pri mt-4 px-4 py-2 text-xs"
            >
              Restore Default Widgets
            </button>
          </div>
        ) : (
          <div ref={gridRef} className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {layout.map((item, idx) => {
              const spanClass = COL_SPAN_CLASS[item.cols] || 'lg:col-span-6';
              const meta = WIDGET_CATALOG.find((m) => m.id === item.id);
              const pct = Math.round((item.cols / 12) * 100);

              return (
                <section
                  key={item.id}
                  draggable={customizeOpen}
                  onDragStart={() => setDragWidgetId(item.id)}
                  onDragEnd={() => {
                    setDragWidgetId(null);
                    setDragOverWidgetId(null);
                  }}
                  onDragOver={(e) => {
                    if (!customizeOpen || !dragWidgetId) return;
                    e.preventDefault();
                    setDragOverWidgetId(item.id);
                  }}
                  onDrop={(e) => {
                    if (!customizeOpen || !dragWidgetId) return;
                    e.preventDefault();
                    reorderWidgets(dragWidgetId, item.id);
                    setDragWidgetId(null);
                    setDragOverWidgetId(null);
                  }}
                  style={item.h ? { minHeight: `${item.h}px` } : undefined}
                  className={`sd-card relative flex flex-col justify-between p-6 transition-shadow ${spanClass} ${
                    customizeOpen ? 'ring-1 ring-[var(--line)]' : ''
                  } ${
                    dragOverWidgetId === item.id && dragWidgetId !== item.id
                      ? 'ring-2 ring-[var(--e3)]'
                      : ''
                  }`}
                >
                  {customizeOpen && (
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-[var(--line)] pb-2.5 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="cursor-grab text-[var(--mute)] active:cursor-grabbing"
                          title="Drag to reorder"
                        >
                          <GripVertical className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="font-bold text-[var(--ink)]">{meta?.label}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveWidget(idx, -1)}
                          aria-label={`Move ${meta?.label} earlier`}
                          className="sd-btn h-6 w-6 p-0 text-[11px]"
                        >
                          <ArrowUp className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === layout.length - 1}
                          onClick={() => moveWidget(idx, 1)}
                          aria-label={`Move ${meta?.label} later`}
                          className="sd-btn h-6 w-6 p-0 text-[11px]"
                        >
                          <ArrowDown className="h-3 w-3" aria-hidden="true" />
                        </button>

                        <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden="true" />

                        <button
                          type="button"
                          disabled={item.cols <= 3}
                          onClick={() => updateWidgetSize(item.id, { cols: item.cols - 1 })}
                          aria-label="Narrow widget"
                          className="sd-btn h-6 w-6 p-0"
                        >
                          <Minus className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <span className="font-mono-num min-w-[38px] text-center text-[11px] font-bold text-[var(--mute)]">
                          {pct}%
                        </span>
                        <button
                          type="button"
                          disabled={item.cols >= 12}
                          onClick={() => updateWidgetSize(item.id, { cols: item.cols + 1 })}
                          aria-label="Widen widget"
                          className="sd-btn h-6 w-6 p-0"
                        >
                          <Plus className="h-3 w-3" aria-hidden="true" />
                        </button>

                        <div className="hidden items-center gap-1 sm:flex">
                          {[3, 6, 9, 12].map((colsPreset) => (
                            <button
                              key={colsPreset}
                              type="button"
                              onClick={() => updateWidgetSize(item.id, { cols: colsPreset })}
                              className={`cursor-pointer rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                                item.cols === colsPreset
                                  ? 'border-[var(--e3)] text-[var(--e3)]'
                                  : 'border-[var(--line)] text-[var(--mute)]'
                              }`}
                            >
                              {Math.round((colsPreset / 12) * 100)}%
                            </button>
                          ))}
                        </div>

                        {item.h && (
                          <button
                            type="button"
                            onClick={() => updateWidgetSize(item.id, { h: null })}
                            className="sd-btn px-1.5 py-0.5 text-[10px]"
                          >
                            Auto H
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => removeWidget(item.id)}
                          aria-label={`Remove ${meta?.label}`}
                          className="sd-btn ml-1 h-6 w-6 p-0 text-[var(--bad)]"
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="min-h-0 flex-1">{renderWidgetBody(item.id)}</div>

                  {customizeOpen && (
                    <>
                      <div
                        onPointerDown={(e) => startResize(e, item, 'width')}
                        title="Drag horizontally to resize width"
                        className="hidden lg:block absolute right-1 top-12 bottom-5 w-2 cursor-ew-resize rounded-full hover:bg-[color-mix(in_srgb,var(--e3)_35%,transparent)]"
                      />
                      <div
                        onPointerDown={(e) => startResize(e, item, 'both')}
                        title="Drag corner to resize width & height"
                        className="hidden lg:block absolute right-1.5 bottom-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-br border-r-2 border-b-2 border-[var(--e3)] opacity-75 hover:opacity-100"
                      />
                    </>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

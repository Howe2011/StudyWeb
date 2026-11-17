import { FormEvent, useMemo, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  Check,
  CheckSquare,
  Globe,
  Layers,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Timer,
  Upload,
  Zap,
} from 'lucide-react';
import { makeId } from '../lib/workspaceStore';
import {
  HomeWidgetPrefs,
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
    opts?: { subjectId?: string; plannerTab?: PlannerSubTab; openQuickAdd?: boolean }
  ) => void;
  onOpenImport: () => void;
  liveTimer: LiveTimerState;
  timerRemainingSec: number;
  timerDurationMins: number;
  onToggleTimer: () => void;
  onResetTimer: (mins?: number) => void;
}

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
  const [quickTodoText, setQuickTodoText] = useState('');
  const [quickTodoSubj, setQuickTodoSubj] = useState('');

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const nowMs = Date.now();

  const dueCount = useMemo(
    () => workspace.flashcards.filter((c) => c.dueAt <= nowMs).length,
    [workspace.flashcards, nowMs]
  );

  const todaysBlocks = useMemo(
    () =>
      workspace.calendarBlocks
        .filter((b) => b.date === todayStr)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [workspace.calendarBlocks, todayStr]
  );

  const upcomingExams = useMemo(() => {
    return workspace.subjects
      .map((s) => ({
        subject: s,
        days: daysUntilDate(s.examDate),
      }))
      .filter((item): item is { subject: typeof item.subject; days: number } => item.days !== null && item.days >= 0)
      .sort((a, b) => a.days - b.days)
      .slice(0, 4);
  }, [workspace.subjects]);

  const activeTodos = useMemo(
    () =>
      workspace.todos
        .filter((t) => !t.done)
        .sort((a, b) => b.priority - a.priority || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
        .slice(0, 6),
    [workspace.todos]
  );

  const subjectStats = useMemo(() => {
    return workspace.subjects.map((subj) => {
      const topics = workspace.topics.filter((t) => t.subjectId === subj.id);
      const completedTopics = topics.filter((t) => t.completed).length;
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

  const toggleWidget = (key: keyof HomeWidgetPrefs) => {
    onUpdateWorkspace((prev) => ({
      ...prev,
      homeWidgets: {
        ...prev.homeWidgets,
        [key]: !prev.homeWidgets[key],
      },
      updatedAt: new Date().toISOString(),
    }));
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
      todos: prev.todos.map((t) => (t.id === todoId ? { ...t, done: !t.done } : t)),
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
  const widgets = workspace.homeWidgets;

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
              className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Widgets</span>
            </button>
          </div>
        </div>

        {/* Home Widget Visibility Customizer */}
        {customizeOpen && (
          <div className="sd-card p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
              Show or hide Home panels
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {(
                [
                  ['dueCards', 'Due Flashcards'],
                  ['schedule', 'Today Schedule & Exams'],
                  ['timer', 'Focus Timer'],
                  ['todos', 'Quick To-Do'],
                  ['mastery', 'Subject Mastery'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={widgets[key]}
                  onClick={() => toggleWidget(key)}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    widgets[key]
                      ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--bg))] text-[var(--e3)]'
                      : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)]'
                  }`}
                >
                  {widgets[key] ? '✓ ' : ''}
                  {label}
                </button>
              ))}
            </div>
          </div>
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
                onClick={() => onNavigate('community')}
                className="flex cursor-pointer flex-col justify-between rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 text-left transition-colors hover:border-[var(--e3)]"
              >
                <div>
                  <Globe className="h-5 w-5 text-[var(--e2)]" aria-hidden="true" />
                  <div className="mt-2.5 font-display text-base font-bold text-[var(--ink)]">
                    3. Browse Community
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--mute)]">
                    Enter a friend&apos;s 6-letter share code or copy public notes and flashcard decks.
                  </p>
                </div>
                <div className="mt-3 text-xs font-bold text-[var(--e2)]">Explore shares →</div>
              </button>
            </div>
          </section>
        )}

        {/* Primary Focal Row: Due Flashcards + Today's Focus Timer */}
        {(widgets.dueCards || widgets.timer) && (
          <div className="grid gap-5 lg:grid-cols-12">
            {widgets.dueCards && (
              <section
                className={`sd-card flex flex-col justify-between p-6 ${
                  widgets.timer ? 'lg:col-span-7' : 'lg:col-span-12'
                }`}
              >
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
              </section>
            )}

            {widgets.timer && (
              <section
                className={`sd-card flex flex-col justify-between p-6 ${
                  widgets.dueCards ? 'lg:col-span-5' : 'lg:col-span-12'
                }`}
              >
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
              </section>
            )}
          </div>
        )}

        {/* Secondary Grid: Schedule + Quick To-Do */}
        {(widgets.schedule || widgets.todos) && (
          <div className="grid gap-5 lg:grid-cols-2">
            {widgets.schedule && (
              <section className="sd-card flex flex-col justify-between p-6">
                <div>
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
                    <h2 className="font-display flex items-center gap-2 text-lg font-bold text-[var(--ink)]">
                      <CalendarDays className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                      <span>Today&apos;s Schedule &amp; Exams</span>
                    </h2>
                    <button
                      type="button"
                      onClick={() => onNavigate('calendar')}
                      className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                    >
                      Open Calendar →
                    </button>
                  </div>

                  {upcomingExams.length > 0 && (
                    <div className="mt-4">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                        Exam Countdowns
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {upcomingExams.map(({ subject, days }) => (
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
                        to generate sessions around your exams.
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
              </section>
            )}

            {widgets.todos && (
              <section className="sd-card flex flex-col justify-between p-6">
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
                        No open to-do tasks. Add one above or import notes to get started.
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
              </section>
            )}
          </div>
        )}

        {/* Subject Mastery Grid */}
        {widgets.mastery && workspace.subjects.length > 0 && (
          <section className="sd-card p-6">
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

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {subjectStats.map(({ subj, topicCount, completedTopics, cardCount, masteredCards }) => {
                const topicPct = topicCount > 0 ? Math.round((completedTopics / topicCount) * 100) : 0;
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
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

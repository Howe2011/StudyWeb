import { useMemo } from 'react';
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock,
  Flame,
  Layers,
  TrendingUp,
} from 'lucide-react';
import { WorkspaceData, WorkspaceTab } from '../types';

interface ProgressViewProps {
  workspace: WorkspaceData;
  onNavigate: (tab: WorkspaceTab, opts?: { subjectId?: string }) => void;
}

const BOX_LABELS: Array<{ box: 1 | 2 | 3 | 4 | 5; name: string; desc: string }> = [
  { box: 1, name: 'Box 1 · New / Again', desc: 'Review every session' },
  { box: 2, name: 'Box 2 · Learning', desc: 'Every 2 days' },
  { box: 3, name: 'Box 3 · Familiar', desc: 'Every 4 days' },
  { box: 4, name: 'Box 4 · Strong', desc: 'Every 8 days' },
  { box: 5, name: 'Box 5 · Mastered', desc: 'Every 16–30 days' },
];

function daysUntilDate(dateStr: string): number | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const target = new Date(`${dateStr}T09:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today.getTime()) / (24 * 3600 * 1000));
}

export function ProgressView({ workspace, onNavigate }: ProgressViewProps) {
  const todayIso = new Date().toISOString().slice(0, 10);

  const metrics = useMemo(() => {
    const totalTopics = workspace.topics.length;
    const completedTopics = workspace.topics.filter((t) => t.completed).length;
    const topicPct = totalTopics > 0 ? Math.round((completedTopics / totalTopics) * 100) : 0;

    const totalCards = workspace.flashcards.length;
    const masteredCards = workspace.flashcards.filter((c) => c.box >= 4).length;
    const masteredPct = totalCards > 0 ? Math.round((masteredCards / totalCards) * 100) : 0;
    const dueCards = workspace.flashcards.filter((c) => c.dueAt <= Date.now()).length;

    const boxCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
    for (const c of workspace.flashcards) {
      boxCounts[c.box] = (boxCounts[c.box] || 0) + 1;
    }

    const totalTodos = workspace.todos.length;
    const doneTodos = workspace.todos.filter((t) => t.done).length;
    const completedBlocks = workspace.calendarBlocks.filter((b) => b.done).length;

    return {
      totalTopics,
      completedTopics,
      topicPct,
      totalCards,
      masteredCards,
      masteredPct,
      dueCards,
      boxCounts,
      totalTodos,
      doneTodos,
      completedBlocks,
    };
  }, [workspace]);

  const subjectRows = useMemo(() => {
    return workspace.subjects.map((subj) => {
      const topics = workspace.topics.filter((t) => t.subjectId === subj.id);
      const topicsDone = topics.filter((t) => t.completed).length;
      const topicPct = topics.length > 0 ? Math.round((topicsDone / topics.length) * 100) : 0;

      const cards = workspace.flashcards.filter((c) => c.subjectId === subj.id);
      const cardsMastered = cards.filter((c) => c.box >= 4).length;
      const cardPct = cards.length > 0 ? Math.round((cardsMastered / cards.length) * 100) : 0;

      const upcomingSessions = workspace.calendarBlocks.filter(
        (b) => b.subjectId === subj.id && b.date >= todayIso && !b.done
      ).length;

      const daysLeft = daysUntilDate(subj.examDate);

      return {
        subj,
        topicsTotal: topics.length,
        topicsDone,
        topicPct,
        cardsTotal: cards.length,
        cardsMastered,
        cardPct,
        upcomingSessions,
        daysLeft,
      };
    });
  }, [workspace, todayIso]);

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-[1160px] space-y-6 px-4 py-7 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--line)] pb-5">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-[var(--ink)] sm:text-3xl">
              Revision Progress
            </h1>
            <p className="mt-1 text-sm text-[var(--mute)]">
              Live mastery across your flashcards, structured topic notes, and planned sessions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate('flashcards')}
              className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap shrink-0"
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Practice Due ({metrics.dueCards})</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('calendar')}
              className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
            >
              <CalendarDays className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
              <span>Open Calendar</span>
            </button>
          </div>
        </div>

        {/* Top 4 KPI Cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="sd-card p-5">
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--mute)]">
              <span>Study Streak</span>
              <Flame className="h-4 w-4 text-[var(--e2)]" aria-hidden="true" />
            </div>
            <div className="font-mono-num mt-2 text-3xl font-extrabold text-[var(--ink)]">
              {workspace.studyStreakDays}d
            </div>
            <div className="mt-1 text-xs text-[var(--mute)]">
              {workspace.lastStudyDate ? `Last studied ${workspace.lastStudyDate}` : 'Log a timer session to start'}
            </div>
          </div>

          <div className="sd-card p-5">
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--mute)]">
              <span>Time Logged</span>
              <Clock className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
            </div>
            <div className="font-mono-num mt-2 text-3xl font-extrabold text-[var(--ink)]">
              {Math.floor(workspace.studyMinutesLogged / 60)}h {workspace.studyMinutesLogged % 60}m
            </div>
            <div className="font-mono-num mt-1 text-xs text-[var(--mute)]">
              {metrics.completedBlocks} planned sessions done
            </div>
          </div>

          <div className="sd-card p-5">
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--mute)]">
              <span>Mastered Cards</span>
              <Layers className="h-4 w-4 text-[var(--ok)]" aria-hidden="true" />
            </div>
            <div className="font-mono-num mt-2 text-3xl font-extrabold text-[var(--ink)]">
              {metrics.masteredPct}%
            </div>
            <div className="font-mono-num mt-1 text-xs text-[var(--mute)]">
              {metrics.masteredCards} of {metrics.totalCards} in Box 4–5
            </div>
          </div>

          <div className="sd-card p-5">
            <div className="flex items-center justify-between text-xs font-semibold text-[var(--mute)]">
              <span>Topics Studied</span>
              <CheckCircle2 className="h-4 w-4 text-[var(--ok)]" aria-hidden="true" />
            </div>
            <div className="font-mono-num mt-2 text-3xl font-extrabold text-[var(--ink)]">
              {metrics.topicPct}%
            </div>
            <div className="font-mono-num mt-1 text-xs text-[var(--mute)]">
              {metrics.completedTopics} of {metrics.totalTopics} topics complete
            </div>
          </div>
        </div>

        {/* Leitner Spaced Repetition Distribution */}
        <section className="sd-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                Flashcard Memory Distribution (Leitner Boxes)
              </h2>
              <p className="mt-0.5 text-xs text-[var(--mute)]">
                Cards move up a box each time you mark them Good or Easy, spacing reviews further apart.
              </p>
            </div>
            <span className="font-mono-num text-xs font-semibold text-[var(--mute)]">
              {metrics.dueCards} due now
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-5">
            {BOX_LABELS.map((item) => {
              const count = metrics.boxCounts[item.box];
              const pct =
                metrics.totalCards > 0 ? Math.round((count / metrics.totalCards) * 100) : 0;
              return (
                <div
                  key={item.box}
                  className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-bold text-[var(--ink)]">{item.name}</span>
                    <span className="font-mono-num text-sm font-extrabold text-[var(--e3)]">
                      {count}
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--card)] border border-[var(--line)]">
                    <div
                      className="h-full rounded-full transition-[width] duration-300"
                      style={{
                        width: `${pct}%`,
                        background:
                          item.box >= 4
                            ? 'var(--ok)'
                            : item.box === 1
                            ? 'var(--e1)'
                            : 'var(--e3)',
                      }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-[var(--mute)]">
                    <span>{item.desc}</span>
                    <span className="font-mono-num">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Per-Subject Exam Readiness Table */}
        <section className="sd-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
              <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                Subject Exam Readiness
              </h2>
            </div>
            <span className="font-mono-num text-xs text-[var(--mute)]">
              {metrics.doneTodos}/{metrics.totalTodos} tasks completed
            </span>
          </div>

          {subjectRows.length === 0 ? (
            <div className="p-8 text-center">
              <BookOpen className="mx-auto mb-2 h-6 w-6 text-[var(--mute)]" aria-hidden="true" />
              <p className="text-sm font-semibold text-[var(--ink)]">No subjects added yet</p>
              <p className="mt-1 text-xs text-[var(--mute)]">
                Pick subjects from Quick Add to track topic progress and exam countdowns here.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('subjects')}
                className="sd-btn-pri mt-4 px-4 py-2 text-xs whitespace-nowrap"
              >
                Add Subjects
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[var(--bg)] text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                    <th className="px-6 py-3">Subject</th>
                    <th className="px-4 py-3">Exam</th>
                    <th className="px-4 py-3">Topics Covered</th>
                    <th className="px-4 py-3">Card Mastery</th>
                    <th className="px-4 py-3">Scheduled</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {subjectRows.map((row) => (
                    <tr key={row.subj.id} className="hover:bg-[var(--bg)]/60">
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="h-3 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: row.subj.color }}
                            aria-hidden="true"
                          />
                          <div>
                            <div className="font-bold text-[var(--ink)]">{row.subj.name}</div>
                            <div className="text-xs text-[var(--mute)]">{row.subj.examBoard}</div>
                          </div>
                        </div>
                      </td>
                      <td className="font-mono-num px-4 py-3.5 text-xs">
                        {row.daysLeft !== null ? (
                          <span
                            className={
                              row.daysLeft <= 14
                                ? 'font-bold text-[var(--bad)]'
                                : 'font-semibold text-[var(--ink)]'
                            }
                          >
                            {row.daysLeft > 0
                              ? `${row.daysLeft}d left`
                              : row.daysLeft === 0
                              ? 'Today'
                              : 'Passed'}
                          </span>
                        ) : (
                          <span className="text-[var(--mute)]">No date</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full border border-[var(--line)] bg-[var(--bg)]">
                            <div
                              className="h-full rounded-full bg-[var(--ok)]"
                              style={{ width: `${row.topicPct}%` }}
                            />
                          </div>
                          <span className="font-mono-num text-xs text-[var(--mute)]">
                            {row.topicsDone}/{row.topicsTotal}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full border border-[var(--line)] bg-[var(--bg)]">
                            <div
                              className="h-full rounded-full bg-[var(--e3)]"
                              style={{ width: `${row.cardPct}%` }}
                            />
                          </div>
                          <span className="font-mono-num text-xs text-[var(--mute)]">
                            {row.cardsMastered}/{row.cardsTotal}
                          </span>
                        </div>
                      </td>
                      <td className="font-mono-num px-4 py-3.5 text-xs text-[var(--mute)]">
                        {row.upcomingSessions} session{row.upcomingSessions === 1 ? '' : 's'}
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <div className="inline-flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => onNavigate('notes', { subjectId: row.subj.id })}
                            className="sd-btn px-2.5 py-1 text-xs whitespace-nowrap"
                          >
                            Notes
                          </button>
                          <button
                            type="button"
                            onClick={() => onNavigate('flashcards', { subjectId: row.subj.id })}
                            className="sd-btn px-2.5 py-1 text-xs whitespace-nowrap"
                          >
                            Cards
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

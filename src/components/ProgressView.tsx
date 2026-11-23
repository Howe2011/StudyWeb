import { useMemo } from 'react';
import {
  StudyTopic,
  WorkspaceData,
  WorkspaceTab,
} from '../types';

interface ProgressViewProps {
  workspace: WorkspaceData;
  onNavigate: (
    tab: WorkspaceTab,
    opts?: { subjectId?: string; plannerTab?: 'calendar' | 'todo' }
  ) => void;
}

function getConfidence(topic: StudyTopic): 0 | 1 | 2 | 3 {
  if (
    topic.confidence === 0 ||
    topic.confidence === 1 ||
    topic.confidence === 2 ||
    topic.confidence === 3
  ) {
    return topic.confidence;
  }
  return topic.completed ? 3 : 0;
}

function toLocalIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysIso(baseDate: Date, offsetDays: number): string {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + offsetDays);
  return toLocalIso(d);
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00`).getTime();
  const b = new Date(`${toIso}T00:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}

function formatExamCountdown(days: number): { text: string; urgent: boolean } {
  if (days < 0) return { text: 'Passed', urgent: false };
  if (days === 0) return { text: 'Today', urgent: true };
  if (days === 1) return { text: 'Tomorrow', urgent: true };
  if (days <= 14) return { text: `${days}d left`, urgent: true };
  return { text: `${days}d left`, urgent: false };
}

export function ProgressView({ workspace, onNavigate }: ProgressViewProps) {
  const stats = useMemo(() => {
    const now = new Date();
    const todayIso = toLocalIso(now);

    // Topics & readiness (3-level scale just like original planner.html)
    const totalTopics = workspace.topics.length;
    const confCounts: Record<0 | 1 | 2 | 3, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    let confSum = 0;
    for (const t of workspace.topics) {
      const c = getConfidence(t);
      confCounts[c] += 1;
      confSum += c;
    }
    const syllabusPct = totalTopics > 0 ? Math.round((confSum / (totalTopics * 3)) * 100) : 0;
    const topicsLeft = workspace.topics.filter((t) => getConfidence(t) < 3).length;

    // Earliest upcoming exam
    const upcomingExamDays = workspace.subjects
      .map((s) => (s.examDate && /^\d{4}-\d{2}-\d{2}$/.test(s.examDate) ? daysBetweenIso(todayIso, s.examDate) : null))
      .filter((d): d is number => d !== null && d >= 0)
      .sort((a, b) => a - b);
    const earliestExamDays = upcomingExamDays.length > 0 ? upcomingExamDays[0] : null;

    // Study logs & time
    const logs = workspace.studyLog || [];
    const loggedSum = logs.reduce((acc, l) => acc + (l.mins || 0), 0);
    const totalMins = Math.max(workspace.studyMinutesLogged || 0, loggedSum);
    const todayMins = logs
      .filter((l) => l.date === todayIso)
      .reduce((acc, l) => acc + (l.mins || 0), 0);

    const nSessions = logs.length;
    const bestSessionMins = nSessions > 0 ? Math.max(...logs.map((l) => l.mins || 0)) : 0;
    const avgSessionMins = nSessions > 0 ? Math.round(loggedSum / nSessions) : 0;

    // Week minutes (Mon..Sun)
    const mondayOffset = (now.getDay() + 6) % 7;
    const weekMins = (weeksAgo: number) => {
      let sum = 0;
      for (let q = 0; q < 7; q++) {
        const dt = addDaysIso(now, -mondayOffset - 7 * weeksAgo + q);
        for (const l of logs) {
          if (l.date === dt) sum += l.mins || 0;
        }
      }
      return sum;
    };
    const thisWeekMins = weekMins(0);
    const lastWeekMins = weekMins(1);
    const weeklyPlannedHours = (workspace.plannerPrefs?.availHours || [2, 2, 2, 2, 2, 3, 3]).reduce(
      (a, b) => a + b,
      0
    );

    // Streak calculation (from studyLog + stored studyStreakDays)
    const logDays = new Set(logs.filter((l) => l.mins > 0).map((l) => l.date));
    let calcStreak = 0;
    let offset = logDays.has(todayIso) ? 0 : 1;
    while (logDays.has(addDaysIso(now, -offset))) {
      calcStreak += 1;
      offset += 1;
    }
    const currentStreak = Math.max(calcStreak, workspace.studyStreakDays || 0);

    const sortedDays = [...logDays].sort();
    let bestStreak = currentStreak;
    let run = 0;
    let prevIso: string | null = null;
    for (const dt of sortedDays) {
      run = prevIso && daysBetweenIso(prevIso, dt) === 1 ? run + 1 : 1;
      if (run > bestStreak) bestStreak = run;
      prevIso = dt;
    }

    // Subjects (weakest readiness first)
    const subjectRows = workspace.subjects
      .map((subj) => {
        const sTopics = workspace.topics.filter((t) => t.subjectId === subj.id);
        const sSum = sTopics.reduce((acc, t) => acc + getConfidence(t), 0);
        const sMastered = sTopics.filter((t) => getConfidence(t) === 3).length;
        const pct = sTopics.length > 0 ? Math.round((sSum / (sTopics.length * 3)) * 100) : null;
        const mins = logs
          .filter((l) => l.subjectId === subj.id)
          .reduce((acc, l) => acc + (l.mins || 0), 0);
        const examDays =
          subj.examDate && /^\d{4}-\d{2}-\d{2}$/.test(subj.examDate)
            ? daysBetweenIso(todayIso, subj.examDate)
            : null;
        return {
          subj,
          pct,
          mastered: sMastered,
          total: sTopics.length,
          mins,
          examDays,
        };
      })
      .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));

    // Flashcards
    const nowTs = Date.now();
    const totalCards = workspace.flashcards.length;
    const masteredCards = workspace.flashcards.filter((c) => c.box >= 4).length;
    const fcPct = totalCards > 0 ? Math.round((masteredCards / totalCards) * 100) : 0;
    const dueCards = workspace.flashcards.filter((c) => c.dueAt <= nowTs).length;
    const flaggedCards = workspace.flashcards.filter((c) => c.flagged).length;

    const cardRows = workspace.subjects
      .map((subj) => {
        const cards = workspace.flashcards.filter((c) => c.subjectId === subj.id);
        return {
          subj,
          total: cards.length,
          mastered: cards.filter((c) => c.box >= 4).length,
          due: cards.filter((c) => c.dueAt <= nowTs).length,
        };
      })
      .filter((r) => r.total > 0);

    // To-do summary
    const todos = workspace.todos;
    const todosDone = todos.filter((t) => t.done).length;
    const todosDoneToday = todos.filter(
      (t) => t.done && (t.doneAt || '').slice(0, 10) === todayIso
    ).length;
    const todosOpen = todos.filter((t) => !t.done);
    const todosLeftToday = todosOpen.filter(
      (t) => (t.dueDate && t.dueDate <= todayIso) || t.addedToday === todayIso
    ).length;
    const todosOverdue = todosOpen.filter((t) => t.dueDate && t.dueDate < todayIso).length;

    const todoCats: Array<{ key: 'exam' | 'hw' | 'oth'; label: string; color: string }> = [
      { key: 'exam', label: 'Exam & Revision', color: 'var(--e3)' },
      { key: 'hw', label: 'Homework', color: 'var(--e2)' },
      { key: 'oth', label: 'Other', color: 'var(--ok)' },
    ];
    const todoCategoryRows = todoCats
      .map((c) => {
        const all = todos.filter((t) => (t.category || 'oth') === c.key);
        const done = all.filter((t) => t.done).length;
        return { ...c, total: all.length, done };
      })
      .filter((r) => r.total > 0);

    // Recent scores & sessions (Latest 5)
    const recentScores = [...(workspace.paperScores || [])].slice(-5).reverse();
    const recentLogs = [...logs].slice(-5).reverse();

    return {
      syllabusPct,
      totalTopics,
      confCounts,
      topicsLeft,
      earliestExamDays,
      totalMins,
      todayMins,
      thisWeekMins,
      lastWeekMins,
      weeklyPlannedHours,
      nSessions,
      avgSessionMins,
      bestSessionMins,
      currentStreak,
      bestStreak,
      subjectRows,
      totalCards,
      masteredCards,
      fcPct,
      dueCards,
      flaggedCards,
      cardRows,
      todosTotal: todos.length,
      todosDone,
      todosDoneToday,
      todosLeftToday,
      todosOverdue,
      todoCategoryRows,
      recentScores,
      recentLogs,
    };
  }, [workspace]);

  const subjectById = useMemo(
    () => new Map(workspace.subjects.map((s) => [s.id, s])),
    [workspace.subjects]
  );

  const summaryLine = `${stats.syllabusPct}% syllabus · ${(stats.totalMins / 60).toFixed(
    1
  )}h revised · ${stats.masteredCards}/${stats.totalCards} flashcards`;

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-[880px] space-y-5 px-4 py-7 sm:px-6">
        {/* Original Editorial Header */}
        <div className="flex flex-wrap items-end justify-between gap-3 pb-1">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-[var(--ink)] sm:text-[26px]">
              Account &amp; Study Stats
            </h1>
            <div className="font-mono-num mt-0.5 text-[13px] text-[var(--mute)]">
              {summaryLine}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="sd-btn px-3.5 py-1.5 text-xs whitespace-nowrap shrink-0"
          >
            Add Progress charts to Home
          </button>
        </div>

        {/* 1. Study Activity & Pace */}
        <section className="sd-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
            <h2 className="font-display text-[15px] font-bold text-[var(--ink)]">
              Study Activity &amp; Pace
            </h2>
            <span className="font-mono-num text-xs text-[var(--mute)]">
              {stats.earliestExamDays !== null
                ? stats.earliestExamDays > 0
                  ? `${stats.earliestExamDays} days to next exam`
                  : 'Exam period'
                : 'No exam date set'}
            </span>
          </div>
          <div className="divide-y divide-[var(--line)] text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
              <span className="text-[var(--mute)]">Syllabus readiness</span>
              <span className="font-mono-num font-semibold text-[var(--ink)]">
                {stats.syllabusPct}% ({stats.confCounts[3]} mastered · {stats.confCounts[2]} alright ·{' '}
                {stats.confCounts[1]} weak · {stats.confCounts[0]} unstarted)
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
              <span className="text-[var(--mute)]">Remaining pace</span>
              <span className="font-mono-num font-semibold text-[var(--ink)]">
                {stats.topicsLeft} topics left
                {stats.earliestExamDays !== null && stats.earliestExamDays > 0
                  ? ` (~${(stats.topicsLeft / stats.earliestExamDays).toFixed(1)}/day)`
                  : ''}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
              <span className="text-[var(--mute)]">Total time revised</span>
              <span className="font-mono-num font-semibold text-[var(--ink)]">
                {(stats.totalMins / 60).toFixed(1)} h ({stats.todayMins} min today)
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
              <span className="text-[var(--mute)]">This week</span>
              <span className="font-mono-num font-semibold text-[var(--ink)]">
                {(stats.thisWeekMins / 60).toFixed(1)} h / {stats.weeklyPlannedHours.toFixed(1)} h
                planned
                {stats.lastWeekMins > 0
                  ? ` (${stats.thisWeekMins >= stats.lastWeekMins ? '+' : '-'}${Math.abs(
                      stats.thisWeekMins - stats.lastWeekMins
                    )}m vs last wk)`
                  : ''}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
              <span className="text-[var(--mute)]">Sessions &amp; streak</span>
              <span className="font-mono-num font-semibold text-[var(--ink)]">
                {stats.nSessions} sessions (avg {stats.avgSessionMins}m, best {stats.bestSessionMins}
                m) · {stats.currentStreak}d streak (best {stats.bestStreak}d)
              </span>
            </div>
          </div>
        </section>

        {/* 2. Subjects (weakest first) */}
        <section className="sd-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
            <h2 className="font-display text-[15px] font-bold text-[var(--ink)]">
              Subjects (weakest first)
            </h2>
            <span className="font-mono-num text-xs text-[var(--mute)]">
              {workspace.subjects.length} active
            </span>
          </div>
          <div className="divide-y divide-[var(--line)] text-[13px]">
            {stats.subjectRows.length === 0 ? (
              <button
                type="button"
                onClick={() => onNavigate('subjects')}
                className="flex w-full cursor-pointer items-center justify-between px-5 py-3 text-left hover:bg-[var(--bg)]"
              >
                <span className="text-[var(--mute)]">No active subjects</span>
                <span className="font-semibold text-[var(--e3)]">Add Subjects →</span>
              </button>
            ) : (
              stats.subjectRows.map((row) => {
                const cd = row.examDays !== null ? formatExamCountdown(row.examDays) : null;
                return (
                  <button
                    key={row.subj.id}
                    type="button"
                    onClick={() => onNavigate('notes', { subjectId: row.subj.id })}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-2.5 text-left transition-colors hover:bg-[var(--bg)]"
                  >
                    <span className="flex min-w-0 items-center gap-2 font-bold text-[var(--ink)]">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: row.subj.color }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{row.subj.name}</span>
                    </span>
                    <span className="font-mono-num shrink-0 font-semibold text-[var(--ink)]">
                      {row.pct !== null ? `${row.pct}%` : '—'} · {row.mastered}/{row.total} topics ·{' '}
                      {row.mins}m
                      {cd && (
                        <>
                          {' '}
                          ·{' '}
                          <span className={cd.urgent ? 'text-[var(--bad)]' : 'text-[var(--mute)]'}>
                            {cd.text}
                          </span>
                        </>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* 3. Flashcards */}
        <section className="sd-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
            <h2 className="font-display text-[15px] font-bold text-[var(--ink)]">Flashcards</h2>
            <button
              type="button"
              onClick={() => onNavigate('flashcards')}
              className="sd-btn px-3 py-1 text-xs whitespace-nowrap"
            >
              Open Flashcards
            </button>
          </div>
          <div className="divide-y divide-[var(--line)] text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
              <span className="text-[var(--mute)]">Overall deck mastery</span>
              <span className="font-mono-num font-semibold text-[var(--ink)]">
                {stats.fcPct}% · {stats.masteredCards}/{stats.totalCards} mastered · {stats.dueCards}{' '}
                due · {stats.flaggedCards} flagged
              </span>
            </div>
            {stats.cardRows.map((row) => (
              <button
                key={row.subj.id}
                type="button"
                onClick={() => onNavigate('flashcards', { subjectId: row.subj.id })}
                className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-2.5 text-left transition-colors hover:bg-[var(--bg)]"
              >
                <span className="text-[var(--ink)]">{row.subj.name}</span>
                <span className="font-mono-num font-semibold text-[var(--ink)]">
                  {row.mastered}/{row.total} mastered · {row.due} due
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* 4. To-do List */}
        <section className="sd-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
            <h2 className="font-display text-[15px] font-bold text-[var(--ink)]">To-do List</h2>
            <button
              type="button"
              onClick={() => onNavigate('planner', { plannerTab: 'todo' })}
              className="sd-btn px-3 py-1 text-xs whitespace-nowrap"
            >
              Open To-do
            </button>
          </div>
          <div className="divide-y divide-[var(--line)] text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
              <span className="text-[var(--mute)]">Tasks summary</span>
              <span className="font-mono-num font-semibold text-[var(--ink)]">
                {stats.todosDone}/{stats.todosTotal} done · {stats.todosDoneToday} today ·{' '}
                {stats.todosLeftToday} left
                {stats.todosOverdue > 0 ? ` · ${stats.todosOverdue} overdue` : ''}
              </span>
            </div>
            {stats.todoCategoryRows.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => onNavigate('planner', { plannerTab: 'todo' })}
                className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-2.5 text-left transition-colors hover:bg-[var(--bg)]"
              >
                <span className="flex items-center gap-2 text-[var(--ink)]">
                  <span
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ backgroundColor: cat.color }}
                    aria-hidden="true"
                  />
                  <span>{cat.label}</span>
                </span>
                <span className="font-mono-num font-semibold text-[var(--ink)]">
                  {cat.done}/{cat.total} done
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* 5. Recent Activity */}
        {(stats.recentScores.length > 0 || stats.recentLogs.length > 0) && (
          <section className="sd-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3.5">
              <h2 className="font-display text-[15px] font-bold text-[var(--ink)]">
                Recent Activity
              </h2>
              <span className="text-xs text-[var(--mute)]">Latest 5</span>
            </div>
            <div className="divide-y divide-[var(--line)] text-[13px]">
              {stats.recentScores.map((sc) => {
                const pct = sc.total > 0 ? Math.round((sc.mark / sc.total) * 100) : 0;
                const subjName = sc.subjectId
                  ? subjectById.get(sc.subjectId)?.name || 'Subject'
                  : 'Past Paper';
                return (
                  <div
                    key={sc.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5"
                  >
                    <span className="text-[var(--mute)]">
                      {subjName} · {sc.paper}
                    </span>
                    <span
                      className={`font-mono-num font-bold ${
                        pct >= 80
                          ? 'text-[var(--ok)]'
                          : pct >= 60
                          ? 'text-[var(--e2)]'
                          : 'text-[var(--bad)]'
                      }`}
                    >
                      {sc.mark}/{sc.total} ({pct}%)
                    </span>
                  </div>
                );
              })}

              {stats.recentLogs.map((log) => {
                const subjName = log.subjectId
                  ? subjectById.get(log.subjectId)?.name || 'Subject'
                  : 'General Study';
                return (
                  <div
                    key={log.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5"
                  >
                    <span className="text-[var(--mute)]">
                      {log.date}
                      {log.time ? ` ${log.time}` : ''} · {subjName}
                    </span>
                    <span className="font-mono-num font-semibold text-[var(--ink)]">
                      {log.mins} min
                      {log.kind ? ` · ${log.kind === 'pomo' ? 'pomodoro' : log.kind}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

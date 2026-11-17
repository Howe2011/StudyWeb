import { FormEvent, useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  autoGenerateStudySchedule,
  DEFAULT_PLANNER_PREFS,
  makeId,
} from '../lib/workspaceStore';
import { CalendarStudyBlock, WorkspaceData } from '../types';

interface CalendarViewProps {
  workspace: WorkspaceData;
  onUpdateWorkspace: (updater: (prev: WorkspaceData) => WorkspaceData) => void;
  onStartSession: (subjectName: string) => void;
}

type CalViewMode = 'month' | 'week' | 'day' | 'agenda';

const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function addDaysIso(baseIso: string, days: number): string {
  const dt = new Date(`${baseIso}T12:00:00`);
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}

function dowMon0(iso: string): number {
  return (new Date(`${iso}T12:00:00`).getDay() + 6) % 7;
}

function getMondayIso(iso: string): string {
  return addDaysIso(iso, -dowMon0(iso));
}

function addMinutesToTime(start: string, mins: number): string {
  const [h, m] = (start || '09:00').split(':').map(Number);
  const tot = ((Number.isFinite(h) ? h : 9) * 60 + (Number.isFinite(m) ? m : 0) + mins) % (24 * 60);
  return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
}

function timeToMins(t: string): number {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function formatLongDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', opts);
}

const KIND_LABELS: Record<CalendarStudyBlock['kind'], string> = {
  revision: 'Active recall',
  flashcards: 'Flashcards',
  'past-paper': 'Exam questions',
  exam: 'Exam date',
  busy: 'Busy time',
};

export function CalendarView({
  workspace,
  onUpdateWorkspace,
  onStartSession,
}: CalendarViewProps) {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [calMode, setCalMode] = useState<CalViewMode>('week');
  const [refDate, setRefDate] = useState<string>(todayStr);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [showHowPlans, setShowHowPlans] = useState<boolean>(false);

  // Auto-plan prefs state initialized from workspace.plannerPrefs
  const prefs = workspace.plannerPrefs || DEFAULT_PLANNER_PREFS;
  const [planDuration, setPlanDuration] = useState<number>(25);
  const [planDaysAhead, setPlanDaysAhead] = useState<number>(14);
  const [planBanner, setPlanBanner] = useState<string | null>(null);

  // Add your own session form
  const [ownSubjId, setOwnSubjId] = useState<string>(() => workspace.subjects[0]?.id || '');
  const [ownDate, setOwnDate] = useState<string>(todayStr);
  const [ownTime, setOwnTime] = useState<string>('17:00');
  const [ownMins, setOwnMins] = useState<number>(25);
  const [ownKind, setOwnKind] = useState<CalendarStudyBlock['kind']>('revision');
  const [ownTitle, setOwnTitle] = useState<string>('');

  // Block out busy time form
  const [busyTitle, setBusyTitle] = useState<string>('');
  const [busyDate, setBusyDate] = useState<string>(todayStr);
  const [busyStart, setBusyStart] = useState<string>('10:00');
  const [busyEnd, setBusyEnd] = useState<string>('12:00');

  const subjById = useMemo(
    () => new Map(workspace.subjects.map((s) => [s.id, s])),
    [workspace.subjects]
  );

  const examsByDate = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of workspace.subjects) {
      if (s.examDate) {
        const list = map.get(s.examDate) || [];
        list.push(`${s.name} exam`);
        map.set(s.examDate, list);
      }
    }
    return map;
  }, [workspace.subjects]);

  const blocksByDate = useMemo(() => {
    const map = new Map<string, CalendarStudyBlock[]>();
    for (const b of workspace.calendarBlocks) {
      const list = map.get(b.date) || [];
      list.push(b);
      map.set(b.date, list);
    }
    map.forEach((arr) => arr.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    return map;
  }, [workspace.calendarBlocks]);

  const selectedBlock = useMemo(
    () => workspace.calendarBlocks.find((b) => b.id === selectedBlockId) || null,
    [workspace.calendarBlocks, selectedBlockId]
  );

  const stepPeriod = (dir: -1 | 1) => {
    setSelectedBlockId(null);
    if (calMode === 'month') {
      const dt = new Date(`${refDate.slice(0, 8)}01T12:00:00`);
      dt.setMonth(dt.getMonth() + dir);
      setRefDate(dt.toISOString().slice(0, 10));
    } else if (calMode === 'week') {
      setRefDate(addDaysIso(refDate, dir * 7));
    } else if (calMode === 'day') {
      setRefDate(addDaysIso(refDate, dir));
    } else {
      setRefDate(addDaysIso(refDate, dir * 14));
    }
  };

  const periodTitle = useMemo(() => {
    if (calMode === 'month') {
      return formatLongDate(refDate, { month: 'long', year: 'numeric' });
    }
    if (calMode === 'week') {
      const wk = getMondayIso(refDate);
      return `${formatLongDate(wk, { day: 'numeric', month: 'short' })} to ${formatLongDate(
        addDaysIso(wk, 6),
        { day: 'numeric', month: 'short' }
      )}`;
    }
    if (calMode === 'day') {
      return formatLongDate(refDate, { weekday: 'long', day: 'numeric', month: 'long' });
    }
    return `Next 14 days from ${formatLongDate(refDate, { day: 'numeric', month: 'short' })}`;
  }, [calMode, refDate]);

  const weekDayList = useMemo(() => {
    if (calMode === 'day') return [refDate];
    const monday = getMondayIso(refDate);
    return Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i));
  }, [calMode, refDate]);

  const monthCells = useMemo(() => {
    const first = `${refDate.slice(0, 8)}01`;
    const startGrid = addDaysIso(first, -dowMon0(first));
    const currentYm = refDate.slice(0, 7);
    const out: Array<{ iso: string; outside: boolean }> = [];
    for (let k = 0; k < 42; k++) {
      const d = addDaysIso(startGrid, k);
      const outside = d.slice(0, 7) !== currentYm;
      if (k >= 35 && outside && dowMon0(d) === 0) break;
      out.push({ iso: d, outside });
    }
    return out;
  }, [refDate]);

  const agendaDays = useMemo(() => {
    const out: string[] = [];
    for (let k = 0; k < 14; k++) {
      const d = addDaysIso(refDate, k);
      if ((blocksByDate.get(d)?.length || 0) > 0 || (examsByDate.get(d)?.length || 0) > 0) {
        out.push(d);
      }
    }
    return out;
  }, [refDate, blocksByDate, examsByDate]);

  const updatePrefs = (patch: Partial<typeof prefs>) => {
    onUpdateWorkspace((prev) => ({
      ...prev,
      plannerPrefs: {
        ...(prev.plannerPrefs || DEFAULT_PLANNER_PREFS),
        ...patch,
      },
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleAvailChange = (idx: number, val: number) => {
    const clamped = Math.max(0, Math.min(12, Number(val) || 0));
    const next = [...prefs.availHours];
    next[idx] = clamped;
    updatePrefs({ availHours: next });
  };

  const runAutoPlan = () => {
    if (workspace.subjects.length === 0) return;
    onUpdateWorkspace((prev) => ({
      ...prev,
      calendarBlocks: autoGenerateStudySchedule(prev, {
        durationMins: planDuration,
        daysAhead: planDaysAhead,
        weekdayStart: prefs.weekdayStart,
        weekendStart: prefs.weekendStart,
        availHours: prefs.availHours,
      }),
      updatedAt: new Date().toISOString(),
    }));
    setPlanBanner('Re-planned schedule from today around busy blocks and exam dates.');
    window.setTimeout(() => setPlanBanner(null), 3200);
  };

  const handleEditSelectedBlock = (
    patch: Partial<CalendarStudyBlock> & { recalculateEnd?: boolean }
  ) => {
    if (!selectedBlock) return;
    onUpdateWorkspace((prev) => ({
      ...prev,
      calendarBlocks: prev.calendarBlocks.map((b) => {
        if (b.id !== selectedBlock.id) return b;
        const next: CalendarStudyBlock = { ...b, ...patch, manual: true };
        if (next.kind === 'busy' && patch.recalculateEnd) {
          next.endTime = addMinutesToTime(next.startTime, next.durationMins);
        }
        return next;
      }),
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleDeleteBlock = (id: string) => {
    const blk = workspace.calendarBlocks.find((b) => b.id === id);
    onUpdateWorkspace((prev) => {
      const filtered = prev.calendarBlocks.filter((b) => b.id !== id);
      if (blk?.kind === 'busy' && prev.subjects.length > 0) {
        return {
          ...prev,
          calendarBlocks: autoGenerateStudySchedule(
            { ...prev, calendarBlocks: filtered },
            { durationMins: planDuration, daysAhead: planDaysAhead }
          ),
          updatedAt: new Date().toISOString(),
        };
      }
      return {
        ...prev,
        calendarBlocks: filtered,
        updatedAt: new Date().toISOString(),
      };
    });
    if (selectedBlockId === id) setSelectedBlockId(null);
  };

  const handleAddOwnSession = (e: FormEvent) => {
    e.preventDefault();
    if (!ownDate) return;
    const subj = ownSubjId ? subjById.get(ownSubjId) : undefined;
    const fallbackTitle = subj
      ? `${subj.name}: ${KIND_LABELS[ownKind]}`
      : KIND_LABELS[ownKind];
    const blk: CalendarStudyBlock = {
      id: makeId('blk'),
      date: ownDate,
      startTime: ownTime || '17:00',
      durationMins: ownMins,
      title: ownTitle.trim() || fallbackTitle,
      subjectId: subj?.id,
      kind: ownKind,
      done: false,
      manual: true,
    };
    onUpdateWorkspace((prev) => ({
      ...prev,
      calendarBlocks: [...prev.calendarBlocks, blk],
      updatedAt: new Date().toISOString(),
    }));
    setOwnTitle('');
    setSelectedBlockId(blk.id);
  };

  const handleAddBusyTime = (e: FormEvent) => {
    e.preventDefault();
    if (!busyDate || !busyStart || !busyEnd) return;
    const sMins = timeToMins(busyStart);
    const eMins = timeToMins(busyEnd);
    if (eMins <= sMins) return;
    const busyBlk: CalendarStudyBlock = {
      id: makeId('blk'),
      date: busyDate,
      startTime: busyStart,
      endTime: busyEnd,
      durationMins: eMins - sMins,
      title: busyTitle.trim() || 'Busy',
      kind: 'busy',
      done: false,
      manual: true,
    };
    onUpdateWorkspace((prev) => {
      const nextBlocks = [...prev.calendarBlocks, busyBlk];
      const nextWs: WorkspaceData = {
        ...prev,
        calendarBlocks:
          prev.subjects.length > 0
            ? autoGenerateStudySchedule(
                { ...prev, calendarBlocks: nextBlocks },
                { durationMins: planDuration, daysAhead: planDaysAhead }
              )
            : nextBlocks,
        updatedAt: new Date().toISOString(),
      };
      return nextWs;
    });
    setBusyTitle('');
  };

  const blockAccentColor = (b: CalendarStudyBlock): string => {
    if (b.kind === 'busy') return 'var(--mute)';
    if (b.kind === 'exam') return 'var(--e2)';
    const s = b.subjectId ? subjById.get(b.subjectId) : undefined;
    return s?.color || 'var(--e3)';
  };

  const plannedStudyCount = workspace.calendarBlocks.filter(
    (b) => b.kind !== 'busy' && b.kind !== 'exam'
  ).length;
  const completedStudyCount = workspace.calendarBlocks.filter(
    (b) => b.kind !== 'busy' && b.kind !== 'exam' && b.done
  ).length;

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        {/* Page Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-[var(--ink)] sm:text-3xl">
              Revision Calendar
            </h1>
            <p className="mt-1 text-sm text-[var(--mute)]">
              Month, Week, Day &amp; Agenda timetable with exam markers, rescheduling, busy blocks, and spaced Auto-Plan.
            </p>
          </div>

          <div className="font-mono-num text-xs font-semibold text-[var(--mute)]">
            {plannedStudyCount} planned sessions · {completedStudyCount} done
          </div>
        </div>

        {/* Main Calendar Surface */}
        <section className="sd-card space-y-4 p-4 sm:p-5">
          {/* Top Controls: View Mode + Navigation */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="sd-seg" role="tablist" aria-label="Calendar view mode">
              {(
                [
                  ['month', 'Month'],
                  ['week', 'Week'],
                  ['day', 'Day'],
                  ['agenda', 'Agenda'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={calMode === mode}
                  onClick={() => {
                    setCalMode(mode);
                    setSelectedBlockId(null);
                  }}
                  className="sd-seg-btn"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => stepPeriod(-1)}
                aria-label="Previous period"
                className="sd-btn h-8 w-8 p-0"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setRefDate(todayStr);
                  setSelectedBlockId(null);
                }}
                className="sd-btn px-3 py-1.5 text-xs"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => stepPeriod(1)}
                aria-label="Next period"
                className="sd-btn h-8 w-8 p-0"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Period Title & Subject Legend */}
          <div>
            <h2 className="font-display text-xl font-bold text-[var(--ink)]">{periodTitle}</h2>
            {workspace.subjects.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--mute)]">
                {workspace.subjects.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                      style={{ backgroundColor: s.color }}
                    />
                    <span>{s.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Selected Session Inspector Panel (.sp) */}
          {selectedBlock && (
            <div className="rounded-xl border border-[var(--e3)] bg-[var(--bg)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-display text-base font-bold text-[var(--ink)]">
                    {selectedBlock.title}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--mute)]">
                    {formatLongDate(selectedBlock.date, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}{' '}
                    · {selectedBlock.startTime}–
                    {selectedBlock.endTime ||
                      addMinutesToTime(selectedBlock.startTime, selectedBlock.durationMins)}{' '}
                    · {KIND_LABELS[selectedBlock.kind]}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedBlock.kind !== 'busy' && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          const subjName =
                            (selectedBlock.subjectId &&
                              subjById.get(selectedBlock.subjectId)?.name) ||
                            'General Study';
                          onStartSession(subjName);
                        }}
                        className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap"
                      >
                        <Play className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Start session</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEditSelectedBlock({ done: !selectedBlock.done })}
                        className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{selectedBlock.done ? 'Mark not done' : 'Mark done'}</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDeleteBlock(selectedBlock.id)}
                    className="sd-btn px-3 py-1.5 text-xs text-[var(--bad)] whitespace-nowrap"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>

              {selectedBlock.kind !== 'busy' && (
                <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-[var(--line)] pt-3">
                  <label className="text-xs font-semibold text-[var(--mute)]">
                    Day
                    <input
                      type="date"
                      value={selectedBlock.date}
                      onChange={(e) => handleEditSelectedBlock({ date: e.target.value })}
                      className="sd-input mt-1 w-auto py-1 text-xs"
                    />
                  </label>
                  <label className="text-xs font-semibold text-[var(--mute)]">
                    Start
                    <input
                      type="time"
                      value={selectedBlock.startTime}
                      onChange={(e) => handleEditSelectedBlock({ startTime: e.target.value })}
                      className="sd-input mt-1 w-auto py-1 text-xs"
                    />
                  </label>
                  <label className="text-xs font-semibold text-[var(--mute)]">
                    Length
                    <select
                      value={selectedBlock.durationMins}
                      onChange={(e) =>
                        handleEditSelectedBlock({ durationMins: Number(e.target.value) })
                      }
                      className="sd-input mt-1 w-auto py-1 text-xs"
                    >
                      {[25, 40, 50, 75, 90].map((m) => (
                        <option key={m} value={m}>
                          {m} min
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      handleEditSelectedBlock({ date: addDaysIso(selectedBlock.date, 1) })
                    }
                    className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                  >
                    Move to tomorrow
                  </button>
                </div>
              )}
            </div>
          )}

          {/* MONTH VIEW */}
          {calMode === 'month' && (
            <div className="grid grid-cols-7 gap-1">
              {DAYS_SHORT.map((d) => (
                <div
                  key={d}
                  className="py-1 text-center text-xs font-bold uppercase tracking-wider text-[var(--mute)]"
                >
                  {d}
                </div>
              ))}
              {monthCells.map(({ iso, outside }) => {
                const isToday = iso === todayStr;
                const blocks = blocksByDate.get(iso) || [];
                const exams = examsByDate.get(iso) || [];
                return (
                  <div
                    key={iso}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setRefDate(iso);
                      setCalMode('day');
                      setSelectedBlockId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setRefDate(iso);
                        setCalMode('day');
                      }
                    }}
                    className={`flex min-h-[92px] cursor-pointer flex-col gap-1 rounded-xl border p-1.5 transition-colors hover:border-[var(--mute)] ${
                      isToday
                        ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_7%,var(--bg))]'
                        : 'border-[var(--line)] bg-[var(--bg)]'
                    } ${outside ? 'opacity-45' : ''}`}
                  >
                    <span
                      className={`font-mono-num text-xs font-bold ${
                        isToday ? 'text-[var(--e3)]' : 'text-[var(--ink)]'
                      }`}
                    >
                      {Number(iso.slice(8))}
                    </span>

                    {exams.map((ex) => (
                      <span
                        key={ex}
                        className="truncate rounded border border-[var(--e2)] px-1 text-[10px] font-semibold text-[var(--e2)]"
                      >
                        {ex}
                      </span>
                    ))}

                    {blocks.slice(0, 3).map((b) => {
                      const col = blockAccentColor(b);
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedBlockId(selectedBlockId === b.id ? null : b.id);
                          }}
                          style={{
                            borderLeftColor: col,
                            backgroundColor: `color-mix(in srgb, ${col} 18%, var(--card))`,
                          }}
                          className={`truncate rounded border-l-[3px] px-1.5 py-0.5 text-left text-[11px] font-medium ${
                            b.done ? 'line-through opacity-50' : 'text-[var(--ink)]'
                          } ${selectedBlockId === b.id ? 'ring-2 ring-[var(--ink)]' : ''}`}
                        >
                          {b.kind === 'busy'
                            ? b.title
                            : (b.subjectId && subjById.get(b.subjectId)?.name) || b.title}
                        </button>
                      );
                    })}
                    {blocks.length > 3 && (
                      <span className="text-[10px] text-[var(--mute)]">
                        +{blocks.length - 3} more
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* WEEK & DAY VIEWS */}
          {(calMode === 'week' || calMode === 'day') && (
            <div
              className={`grid gap-2.5 ${
                calMode === 'day' ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-7'
              }`}
            >
              {weekDayList.map((iso) => {
                const isToday = iso === todayStr;
                const blocks = blocksByDate.get(iso) || [];
                const exams = examsByDate.get(iso) || [];
                const workBlocks = blocks.filter((b) => b.kind !== 'busy');
                const doneCount = workBlocks.filter((b) => b.done).length;
                const oneDay = calMode === 'day';

                return (
                  <div
                    key={iso}
                    className={`flex min-h-[210px] flex-col gap-2 rounded-2xl border p-3 ${
                      isToday
                        ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_6%,var(--bg))]'
                        : 'border-[var(--line)] bg-[var(--bg)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setRefDate(iso);
                        setCalMode('day');
                        setSelectedBlockId(null);
                      }}
                      className="flex cursor-pointer flex-col items-center border-b border-[var(--line)] pb-2 text-center"
                    >
                      <span className="text-[11px] font-semibold uppercase text-[var(--mute)]">
                        {DAYS_SHORT[dowMon0(iso)]}
                      </span>
                      <span
                        className={`font-display text-2xl font-bold ${
                          isToday ? 'text-[var(--e3)]' : 'text-[var(--ink)]'
                        }`}
                      >
                        {Number(iso.slice(8))}
                      </span>
                      {workBlocks.length > 0 && (
                        <span className="font-mono-num text-[11px] text-[var(--mute)]">
                          {doneCount}/{workBlocks.length} done
                        </span>
                      )}
                    </button>

                    {exams.map((ex) => (
                      <div
                        key={ex}
                        className="rounded-lg border border-[var(--e2)] px-2 py-1 text-center text-[11px] font-bold text-[var(--e2)]"
                      >
                        {ex}
                      </div>
                    ))}

                    <div className="flex-1 space-y-2">
                      {blocks.map((b) => {
                        const col = blockAccentColor(b);
                        const endLabel =
                          b.endTime || addMinutesToTime(b.startTime, b.durationMins);
                        const isSelected = selectedBlockId === b.id;
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => setSelectedBlockId(isSelected ? null : b.id)}
                            style={{
                              borderLeftColor: col,
                              background: `linear-gradient(135deg, color-mix(in srgb, ${col} 26%, var(--card)), color-mix(in srgb, ${col} 10%, var(--card)))`,
                            }}
                            className={`relative flex w-full cursor-pointer flex-col gap-0.5 rounded-xl border-l-4 text-left transition-transform hover:-translate-y-0.5 ${
                              oneDay ? 'p-4' : 'p-2.5'
                            } ${b.done ? 'opacity-50' : ''} ${
                              isSelected ? 'ring-2 ring-[var(--ink)]' : ''
                            }`}
                          >
                            <span className="font-mono-num text-[11px] font-semibold text-[var(--mute)]">
                              {oneDay ? `${b.startTime} to ${endLabel}` : b.startTime}
                            </span>
                            <span
                              className={`font-bold text-[var(--ink)] ${
                                oneDay ? 'text-base' : 'text-xs'
                              } ${b.done ? 'line-through' : ''}`}
                            >
                              {b.title}
                            </span>
                            <span className="text-[11px] text-[var(--mute)]">
                              {KIND_LABELS[b.kind]} · {b.durationMins}m
                            </span>
                            {b.done && (
                              <span
                                aria-label="Done"
                                className="absolute right-2 top-2 text-xs font-bold text-[var(--ok)]"
                              >
                                ✓
                              </span>
                            )}
                          </button>
                        );
                      })}
                      {blocks.length === 0 && (
                        <div className="py-6 text-center text-xs text-[var(--mute)]">Rest day</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* AGENDA VIEW */}
          {calMode === 'agenda' && (
            <div className="space-y-4">
              {agendaDays.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-6 text-center text-xs text-[var(--mute)]">
                  Nothing planned in the next 14 days. Run Auto-plan below or add a session.
                </div>
              ) : (
                agendaDays.map((d) => {
                  const blocks = blocksByDate.get(d) || [];
                  const exams = examsByDate.get(d) || [];
                  return (
                    <div key={d} className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-[var(--ink)]">
                        <span>
                          {formatLongDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}
                          {d === todayStr ? ' (today)' : ''}
                        </span>
                        {exams.map((ex) => (
                          <span
                            key={ex}
                            className="rounded border border-[var(--e2)] px-1.5 py-0.5 text-[11px] text-[var(--e2)]"
                          >
                            {ex}
                          </span>
                        ))}
                      </div>
                      <div className="space-y-1.5">
                        {blocks.map((b) => {
                          const col = blockAccentColor(b);
                          return (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() =>
                                setSelectedBlockId(selectedBlockId === b.id ? null : b.id)
                              }
                              style={{
                                borderLeftColor: col,
                                backgroundColor: `color-mix(in srgb, ${col} 14%, var(--card))`,
                              }}
                              className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border-l-4 px-3 py-2 text-left text-xs ${
                                b.done ? 'line-through opacity-50' : 'text-[var(--ink)]'
                              } ${selectedBlockId === b.id ? 'ring-2 ring-[var(--ink)]' : ''}`}
                            >
                              <span className="font-semibold">
                                <span className="font-mono-num mr-2 text-[var(--mute)]">
                                  {b.startTime}
                                </span>
                                {b.title}
                              </span>
                              <span className="font-mono-num shrink-0 text-[var(--mute)]">
                                {b.durationMins}m · {KIND_LABELS[b.kind]}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          <p className="text-xs text-[var(--mute)]">
            Tap any block above to start a timed study session, reschedule, or mark it done.
          </p>
        </section>

        {/* AUTO-PLAN PANEL (Original planner.html Auto-plan Card) */}
        <section className="sd-card space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display flex items-center gap-2 text-lg font-bold text-[var(--ink)]">
                <Sparkles className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                <span>Auto-plan</span>
              </h2>
              <p className="mt-0.5 text-xs text-[var(--mute)]">
                Hours you can revise each day. Sessions you manually move or lock stay put when you re-plan.
              </p>
            </div>
            <button
              type="button"
              disabled={workspace.subjects.length === 0}
              onClick={runAutoPlan}
              className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Re-plan from today</span>
            </button>
          </div>

          {workspace.subjects.length === 0 && (
            <p className="text-xs font-semibold text-[var(--bad)]">
              Add at least one subject in Subjects first so Auto-plan can fill your calendar.
            </p>
          )}

          {planBanner && (
            <p className="text-xs font-semibold text-[var(--ok)]" role="status">
              {planBanner}
            </p>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold text-[var(--mute)]">
              Weekday start
              <input
                type="time"
                value={prefs.weekdayStart}
                onChange={(e) => updatePrefs({ weekdayStart: e.target.value })}
                className="sd-input mt-1 w-auto py-1.5 text-xs"
              />
            </label>
            <label className="text-xs font-semibold text-[var(--mute)]">
              Weekend start
              <input
                type="time"
                value={prefs.weekendStart}
                onChange={(e) => updatePrefs({ weekendStart: e.target.value })}
                className="sd-input mt-1 w-auto py-1.5 text-xs"
              />
            </label>
            <label className="text-xs font-semibold text-[var(--mute)]">
              Block length
              <select
                value={planDuration}
                onChange={(e) => setPlanDuration(Number(e.target.value))}
                className="sd-input mt-1 w-auto py-1.5 text-xs"
              >
                <option value={25}>25 min</option>
                <option value={40}>40 min</option>
                <option value={50}>50 min</option>
                <option value={60}>60 min</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-[var(--mute)]">
              Horizon
              <select
                value={planDaysAhead}
                onChange={(e) => setPlanDaysAhead(Number(e.target.value))}
                className="sd-input mt-1 w-auto py-1.5 text-xs"
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={21}>21 days</option>
                <option value={28}>28 days</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {DAYS_SHORT.map((dayName, idx) => (
              <label key={dayName} className="text-xs font-semibold text-[var(--mute)]">
                {dayName} (hrs)
                <input
                  type="number"
                  min={0}
                  max={12}
                  step={0.5}
                  value={prefs.availHours[idx] ?? 2}
                  onChange={(e) => handleAvailChange(idx, Number(e.target.value))}
                  className="sd-input font-mono-num mt-1 py-1.5 text-xs"
                />
              </label>
            ))}
          </div>

          <div className="border-t border-[var(--line)] pt-3">
            <button
              type="button"
              onClick={() => setShowHowPlans((v) => !v)}
              className="cursor-pointer text-xs font-semibold text-[var(--mute)] hover:text-[var(--ink)]"
            >
              {showHowPlans ? '▾ Hide how it plans' : '▸ How it plans'}
            </button>
            {showHowPlans && (
              <p className="mt-2 text-xs leading-relaxed text-[var(--mute)]">
                <strong className="text-[var(--ink)]">Spaced practice &amp; urgency:</strong>{' '}
                subjects with closer exam dates and incomplete topics are prioritized first.{' '}
                <strong className="text-[var(--ink)]">Interleaving:</strong> subjects alternate
                rather than repeating back-to-back.{' '}
                <strong className="text-[var(--ink)]">Exam questions:</strong> the last 9 days before
                each exam automatically add practice-paper blocks.{' '}
                <strong className="text-[var(--ink)]">Busy-aware rhythm:</strong> sessions schedule
                around busy time blocks with 5-minute breaks (and 15 minutes after every fourth block).
              </p>
            )}
          </div>
        </section>

        {/* Bottom Forms: Add Own Session & Block Out Busy Time */}
        <div className="grid gap-5 lg:grid-cols-2">
          <form onSubmit={handleAddOwnSession} className="sd-card space-y-3 p-5">
            <h2 className="font-display text-lg font-bold text-[var(--ink)]">
              Add your own session
            </h2>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="text-xs font-semibold text-[var(--mute)]">
                Subject
                <select
                  value={ownSubjId}
                  onChange={(e) => setOwnSubjId(e.target.value)}
                  className="sd-input mt-1 text-xs"
                >
                  <option value="">General Study</option>
                  {workspace.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-[var(--mute)]">
                Type
                <select
                  value={ownKind}
                  onChange={(e) => setOwnKind(e.target.value as CalendarStudyBlock['kind'])}
                  className="sd-input mt-1 text-xs"
                >
                  <option value="revision">Active recall</option>
                  <option value="flashcards">Flashcards</option>
                  <option value="past-paper">Exam questions</option>
                  <option value="exam">Exam date</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-[var(--mute)]">
                Date
                <input
                  type="date"
                  required
                  value={ownDate}
                  onChange={(e) => setOwnDate(e.target.value)}
                  className="sd-input mt-1 text-xs"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-[var(--mute)]">
                  Start
                  <input
                    type="time"
                    value={ownTime}
                    onChange={(e) => setOwnTime(e.target.value)}
                    className="sd-input mt-1 text-xs"
                  />
                </label>
                <label className="text-xs font-semibold text-[var(--mute)]">
                  Length
                  <select
                    value={ownMins}
                    onChange={(e) => setOwnMins(Number(e.target.value))}
                    className="sd-input mt-1 text-xs"
                  >
                    <option value={25}>25 min</option>
                    <option value={50}>50 min</option>
                    <option value={75}>75 min</option>
                    <option value={90}>90 min</option>
                  </select>
                </label>
              </div>
            </div>
            <input
              type="text"
              value={ownTitle}
              onChange={(e) => setOwnTitle(e.target.value)}
              placeholder="Optional custom title…"
              className="sd-input text-xs"
            />
            <button type="submit" className="sd-btn-pri px-4 py-2 text-xs">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add session</span>
            </button>
          </form>

          <form onSubmit={handleAddBusyTime} className="sd-card space-y-3 p-5">
            <h2 className="font-display text-lg font-bold text-[var(--ink)]">
              Block out busy time
            </h2>
            <p className="text-xs text-[var(--mute)]">
              Mark clubs, appointments, or matches so Auto-plan skips those hours.
            </p>
            <input
              type="text"
              value={busyTitle}
              onChange={(e) => setBusyTitle(e.target.value)}
              placeholder="e.g. Football match"
              className="sd-input text-xs"
            />
            <div className="grid gap-2.5 sm:grid-cols-3">
              <label className="text-xs font-semibold text-[var(--mute)]">
                Date
                <input
                  type="date"
                  required
                  value={busyDate}
                  onChange={(e) => setBusyDate(e.target.value)}
                  className="sd-input mt-1 text-xs"
                />
              </label>
              <label className="text-xs font-semibold text-[var(--mute)]">
                From
                <input
                  type="time"
                  required
                  value={busyStart}
                  onChange={(e) => setBusyStart(e.target.value)}
                  className="sd-input mt-1 text-xs"
                />
              </label>
              <label className="text-xs font-semibold text-[var(--mute)]">
                Until
                <input
                  type="time"
                  required
                  value={busyEnd}
                  onChange={(e) => setBusyEnd(e.target.value)}
                  className="sd-input mt-1 text-xs"
                />
              </label>
            </div>
            <button type="submit" className="sd-btn px-4 py-2 text-xs">
              <Clock className="h-3.5 w-3.5 text-[var(--e2)]" aria-hidden="true" />
              <span>Add and re-plan</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

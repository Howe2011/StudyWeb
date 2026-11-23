import { useState } from 'react';
import {
  CalendarDays,
  Check,
  ExternalLink,
  Flag,
  MonitorUp,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  SkipForward,
  Square,
  Timer,
  X,
} from 'lucide-react';
import { isDocumentPipSupported, isVideoPipSupported } from '../lib/floatingTimerPip';
import { addLoggedStudyMinutes } from '../lib/workspaceStore';
import { LiveTimerState, StopwatchState, WorkspaceData } from '../types';

export type TimerEngineMode = 'timer' | 'pomo' | 'stopwatch';

interface TimerViewProps {
  workspace: WorkspaceData;
  onUpdateWorkspace: (updater: (prev: WorkspaceData) => WorkspaceData) => void;
  timerMode: TimerEngineMode;
  onChangeTimerMode: (mode: TimerEngineMode) => void;
  liveTimer: LiveTimerState;
  timerRemainingSec: number;
  timerDurationMins: number;
  timerSubject: string;
  onChangeTimerSubject: (subject: string) => void;
  onToggleTimer: () => void;
  onResetTimer: (mins?: number) => void;
  onAddCountdownMins: (deltaMins: number) => void;
  pomoFocusMins: number;
  pomoBreakMins: number;
  pomoPhase: 'focus' | 'break';
  pomoRound: number;
  onChangePomoFocusMins: (mins: number) => void;
  onChangePomoBreakMins: (mins: number) => void;
  onSkipPomoPhase: () => void;
  stopwatch: StopwatchState;
  onToggleStopwatch: () => void;
  onLapStopwatch: () => void;
  onResetStopwatch: () => void;
  onStopAndLogStopwatch: () => number;
  onChangeStopwatchSubject: (subjectName: string, subjectId?: string) => void;
  autoFloatOnLeave: boolean;
  onToggleAutoFloat: (enabled: boolean) => void;
  floatingPipOpen: boolean;
  floatingPipKind: 'document-pip' | 'video-pip' | null;
  onOpenFloatingPip: () => Promise<'document-pip' | 'video-pip' | 'unsupported'>;
  onCloseFloatingPip: () => Promise<void>;
  completionNotice: string | null;
  onDismissNotice: () => void;
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function TimerView({
  workspace,
  onUpdateWorkspace,
  timerMode,
  onChangeTimerMode,
  liveTimer,
  timerRemainingSec,
  timerDurationMins,
  timerSubject,
  onChangeTimerSubject,
  onToggleTimer,
  onResetTimer,
  onAddCountdownMins,
  pomoFocusMins,
  pomoBreakMins,
  pomoPhase,
  pomoRound,
  onChangePomoFocusMins,
  onChangePomoBreakMins,
  onSkipPomoPhase,
  stopwatch,
  onToggleStopwatch,
  onLapStopwatch,
  onResetStopwatch,
  onStopAndLogStopwatch,
  onChangeStopwatchSubject,
  autoFloatOnLeave,
  onToggleAutoFloat,
  floatingPipOpen,
  floatingPipKind,
  onOpenFloatingPip,
  onCloseFloatingPip,
  completionNotice,
  onDismissNotice,
}: TimerViewProps) {
  const [customMins, setCustomMins] = useState(String(timerDurationMins));
  const [banner, setBanner] = useState<string | null>(null);
  const [pipNotice, setPipNotice] = useState<string | null>(null);

  const docPipAvail = isDocumentPipSupported();
  const videoPipAvail = isVideoPipSupported();
  const pipSupported = docPipAvail || videoPipAvail;

  const isRunning = timerMode === 'stopwatch' ? stopwatch.running : liveTimer.running;
  const activeSubject = timerMode === 'stopwatch' ? stopwatch.subjectName : timerSubject;
  const mmssMain = timerMode === 'stopwatch' ? stopwatch.text : formatClock(timerRemainingSec);

  const totalSec = Math.max(1, timerDurationMins * 60);
  const progressPct =
    timerMode === 'stopwatch'
      ? Math.min(100, Math.round(((stopwatch.elapsedSec % 3600) / 3600) * 100))
      : Math.max(0, Math.min(100, Math.round(((totalSec - timerRemainingSec) / totalSec) * 100)));

  const showTempBanner = (msg: string) => {
    setBanner(msg);
    window.setTimeout(() => setBanner(null), 3200);
  };

  const handleLogFocusMinutes = (mins: number) => {
    if (mins <= 0) return;
    onUpdateWorkspace((prev) => addLoggedStudyMinutes(prev, mins));
    showTempBanner(`Logged +${mins} minutes to your study streak.`);
  };

  const handleStopAndLog = () => {
    if (timerMode === 'stopwatch') {
      const loggedMins = onStopAndLogStopwatch();
      if (loggedMins > 0) {
        showTempBanner(`Logged +${loggedMins} minutes to your study streak.`);
      } else {
        showTempBanner('Stopwatch stopped (under 30s not logged).');
      }
      return;
    }

    const elapsedSec = timerDurationMins * 60 - timerRemainingSec;
    const mins = Math.max(1, Math.round(elapsedSec / 60));
    if (elapsedSec >= 30) {
      handleLogFocusMinutes(mins);
    }
    onResetTimer(timerMode === 'pomo' ? (pomoPhase === 'focus' ? pomoFocusMins : pomoBreakMins) : timerDurationMins);
  };

  const handleFloatClick = async () => {
    setPipNotice(null);
    if (floatingPipOpen) {
      await onCloseFloatingPip();
      return;
    }
    const result = await onOpenFloatingPip();
    if (result === 'unsupported') {
      setPipNotice(
        'Your current browser blocked or does not support Picture-in-Picture windows. Try Chrome or Edge for cross-tab floating.'
      );
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
        {/* Top Page Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-[var(--ink)] sm:text-3xl">
              Focus Timer
            </h1>
            <p className="mt-1 text-sm text-[var(--mute)]">
              Countdown, Pomodoro cycles, and stopwatch — with an optional floating mini-box when studying in other browser tabs.
            </p>
          </div>

          <div className="sd-seg" role="tablist" aria-label="Timer mode">
            {(
              [
                ['timer', 'Countdown'],
                ['pomo', 'Pomodoro'],
                ['stopwatch', 'Stopwatch'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={timerMode === m}
                aria-pressed={timerMode === m}
                onClick={() => onChangeTimerMode(m)}
                className="sd-seg-btn whitespace-nowrap"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {(completionNotice || banner) && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ok)] bg-[var(--card)] px-4 py-3 text-xs font-semibold text-[var(--ok)]"
          >
            <span className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{completionNotice || banner}</span>
            </span>
            {completionNotice && (
              <button
                type="button"
                onClick={onDismissNotice}
                aria-label="Dismiss timer notice"
                className="cursor-pointer rounded p-0.5 text-[var(--mute)] hover:text-[var(--ink)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Primary Focus Console */}
          <section className="sd-card space-y-6 p-6 sm:p-8 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold uppercase tracking-wider text-[var(--e3)]">
              <span className="inline-flex items-center gap-2">
                <Timer className="h-4 w-4" aria-hidden="true" />
                <span>
                  {timerMode === 'stopwatch'
                    ? stopwatch.topicName
                      ? `Stopwatch · ${stopwatch.topicName}`
                      : 'Stopwatch'
                    : timerMode === 'pomo'
                    ? `${pomoPhase === 'focus' ? 'Focus Phase' : 'Break Phase'} · Round ${pomoRound}`
                    : 'Countdown Session'}
                </span>
              </span>
              <span className="font-mono-num text-[var(--mute)]">
                {isRunning ? 'Active' : 'Ready'}
              </span>
            </div>

            <div className="text-center">
              <div className="font-mono-num text-6xl font-extrabold tracking-tight tabular-nums text-[var(--ink)] sm:text-7xl">
                {mmssMain}
              </div>
              <p className="mt-2 text-xs font-semibold text-[var(--mute)]">
                Subject: <span className="text-[var(--ink)]">{activeSubject}</span>
              </p>
              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[var(--line)]">
                <div
                  className="h-full rounded-full bg-[var(--e3)] transition-[width] duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Subject & Duration Setup */}
            <div className="space-y-4 border-t border-[var(--line)] pt-5">
              <label className="block text-xs font-semibold text-[var(--mute)]">
                Study Subject
                <select
                  value={activeSubject}
                  onChange={(e) => {
                    const val = e.target.value;
                    onChangeTimerSubject(val);
                    const matched = workspace.subjects.find((s) => s.name === val);
                    onChangeStopwatchSubject(val, matched?.id);
                  }}
                  className="sd-input mt-1.5 text-sm"
                >
                  <option value="General Study">General Study</option>
                  {workspace.subjects.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              {timerMode === 'timer' && (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-5 gap-2">
                    {[10, 25, 45, 60, 90].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setCustomMins(String(m));
                          onResetTimer(m);
                        }}
                        className={`font-mono-num cursor-pointer rounded-lg border py-2 text-xs font-bold transition-colors ${
                          timerDurationMins === m
                            ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]'
                            : 'border-[var(--line)] bg-[var(--bg)] text-[var(--ink)] hover:border-[var(--mute)]'
                        }`}
                      >
                        {m}m
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={customMins}
                      onChange={(e) => setCustomMins(e.target.value)}
                      aria-label="Custom countdown minutes"
                      className="sd-input font-mono-num w-28 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const mins = Math.max(1, Math.min(180, Math.round(Number(customMins) || 25)));
                        setCustomMins(String(mins));
                        onResetTimer(mins);
                      }}
                      className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                    >
                      Set custom mins
                    </button>
                    <button
                      type="button"
                      onClick={() => onAddCountdownMins(5)}
                      className="sd-btn font-mono-num ml-auto px-3 py-1.5 text-xs whitespace-nowrap"
                    >
                      +5m
                    </button>
                  </div>
                </div>
              )}

              {timerMode === 'pomo' && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-semibold text-[var(--mute)]">
                    Focus Duration (mins)
                    <input
                      type="number"
                      min={5}
                      max={90}
                      value={pomoFocusMins}
                      onChange={(e) => {
                        const v = Math.max(5, Math.min(90, Number(e.target.value) || 25));
                        onChangePomoFocusMins(v);
                      }}
                      className="sd-input font-mono-num mt-1 py-1.5 text-xs"
                    />
                  </label>
                  <label className="text-xs font-semibold text-[var(--mute)]">
                    Break Duration (mins)
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={pomoBreakMins}
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(30, Number(e.target.value) || 5));
                        onChangePomoBreakMins(v);
                      }}
                      className="sd-input font-mono-num mt-1 py-1.5 text-xs"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Primary Controls */}
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              {timerMode === 'stopwatch' ? (
                <>
                  <button
                    type="button"
                    onClick={onToggleStopwatch}
                    className="sd-btn-pri px-5 py-2.5 text-sm whitespace-nowrap shrink-0"
                  >
                    {stopwatch.running ? (
                      <>
                        <Pause className="h-4 w-4" aria-hidden="true" />
                        <span>Pause</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" aria-hidden="true" />
                        <span>{stopwatch.elapsedSec > 0 ? 'Resume' : 'Start'}</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={!stopwatch.running && stopwatch.elapsedSec === 0}
                    onClick={onLapStopwatch}
                    className="sd-btn px-4 py-2.5 text-sm whitespace-nowrap shrink-0"
                  >
                    <Flag className="h-4 w-4" aria-hidden="true" />
                    <span>Lap</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleStopAndLog}
                    className="sd-btn px-4 py-2.5 text-sm whitespace-nowrap shrink-0"
                  >
                    <Square className="h-4 w-4 text-[var(--ok)]" aria-hidden="true" />
                    <span>Stop &amp; Log</span>
                  </button>
                  <button
                    type="button"
                    disabled={!stopwatch.running && stopwatch.elapsedSec === 0}
                    onClick={onResetStopwatch}
                    className="sd-btn px-3.5 py-2.5 text-sm whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    <span>Reset</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onToggleTimer}
                    className="sd-btn-pri px-5 py-2.5 text-sm whitespace-nowrap shrink-0"
                  >
                    {liveTimer.running ? (
                      <>
                        <Pause className="h-4 w-4" aria-hidden="true" />
                        <span>Pause</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" aria-hidden="true" />
                        <span>{timerRemainingSec < timerDurationMins * 60 ? 'Resume' : 'Start Focus'}</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleStopAndLog}
                    className="sd-btn px-4 py-2.5 text-sm whitespace-nowrap shrink-0"
                  >
                    <Square className="h-4 w-4 text-[var(--ok)]" aria-hidden="true" />
                    <span>Stop &amp; Log</span>
                  </button>
                  {timerMode === 'pomo' && (
                    <button
                      type="button"
                      onClick={onSkipPomoPhase}
                      className="sd-btn px-3.5 py-2.5 text-xs whitespace-nowrap shrink-0"
                    >
                      <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{pomoPhase === 'focus' ? 'Skip to break' : 'Back to focus'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onResetTimer()}
                    className="sd-btn px-3.5 py-2.5 text-sm whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    <span>Reset</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => handleLogFocusMinutes(15)}
                className="sd-btn px-3.5 py-2.5 text-sm whitespace-nowrap shrink-0"
              >
                <CalendarDays className="h-4 w-4 text-[var(--ok)]" aria-hidden="true" />
                <span>+ Log 15m</span>
              </button>
            </div>

            {timerMode === 'stopwatch' && stopwatch.laps.length > 0 && (
              <div className="space-y-1.5 border-t border-[var(--line)] pt-4">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                  Recorded Laps ({stopwatch.laps.length})
                </div>
                <div className="max-h-40 space-y-1 overflow-y-auto text-xs">
                  {stopwatch.laps.map((sec, idx) => (
                    <div
                      key={`${sec}_${idx}`}
                      className="font-mono-num flex justify-between border-b border-[var(--line)] py-1.5 tabular-nums last:border-b-0"
                    >
                      <span className="text-[var(--mute)]">Lap {stopwatch.laps.length - idx}</span>
                      <span className="font-bold text-[var(--ink)]">{formatClock(sec)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Floating Cross-Tab Mini-Box & Quick Session Info */}
          <aside className="space-y-5 lg:col-span-5">
            <div className="sd-card space-y-4 p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display flex items-center gap-2 text-lg font-bold text-[var(--ink)]">
                    <PictureInPicture2 className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                    <span>Floating Mini-Timer</span>
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--mute)]">
                    Keep a compact always-on-top timer box visible while you read PDFs, papers, or videos in other browser tabs.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--mute)]">Mini-box preview</span>
                  <span className="font-mono-num font-bold text-[var(--e3)]">
                    {floatingPipOpen
                      ? floatingPipKind === 'document-pip'
                        ? 'Interactive Window Open'
                        : 'Picture-in-Picture Open'
                      : autoFloatOnLeave
                      ? 'Auto-float Armed'
                      : 'Off'}
                  </span>
                </div>
                <div className="mt-2.5 flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-bold uppercase tracking-wider text-[var(--e3)]">
                      {timerMode === 'pomo'
                        ? `Pomodoro · ${pomoPhase === 'focus' ? 'Focus' : 'Break'}`
                        : timerMode === 'stopwatch'
                        ? 'Stopwatch'
                        : 'Countdown'}
                    </div>
                    <div className="truncate text-xs font-medium text-[var(--mute)]">
                      {activeSubject}
                    </div>
                  </div>
                  <div className="font-mono-num text-xl font-extrabold tabular-nums text-[var(--ink)]">
                    {mmssMain}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  disabled={!pipSupported}
                  onClick={() => void handleFloatClick()}
                  className={`w-full justify-center px-4 py-2.5 text-xs whitespace-nowrap ${
                    floatingPipOpen ? 'sd-btn' : 'sd-btn-pri'
                  }`}
                >
                  <MonitorUp className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {floatingPipOpen ? 'Close Floating Mini-Box' : 'Float Mini-Box Now'}
                  </span>
                </button>

                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs">
                  <input
                    type="checkbox"
                    checked={autoFloatOnLeave}
                    disabled={!videoPipAvail}
                    onChange={(e) => onToggleAutoFloat(e.target.checked)}
                    className="mt-0.5 accent-[var(--e3)]"
                  />
                  <span>
                    <span className="block font-semibold text-[var(--ink)]">
                      Auto-float when switching browser tabs
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[var(--mute)]">
                      {videoPipAvail
                        ? 'Automatically pops out the mini timer box whenever the timer is running and you open another tab, then docks back when you return.'
                        : 'Automatic tab-switch Picture-in-Picture requires a Chromium browser (Chrome or Edge).'}
                    </span>
                  </span>
                </label>

                {pipNotice && (
                  <p className="text-xs font-medium text-[var(--bad)]" role="status">
                    {pipNotice}
                  </p>
                )}

                {!pipNotice && (
                  <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--mute)]">
                    <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      {docPipAvail
                        ? 'Interactive floating box supports live Play/Pause, +5m/Lap, and Reset controls directly above other tabs.'
                        : 'Picture-in-Picture mode mirrors your live clock above other tabs.'}
                    </span>
                  </p>
                )}
              </div>
            </div>

            <div className="sd-card space-y-2 p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                Today&apos;s Study Totals
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="text-[11px] text-[var(--mute)]">Total Logged</div>
                  <div className="font-mono-num mt-1 text-lg font-extrabold tabular-nums text-[var(--ink)]">
                    {workspace.studyMinutesLogged}m
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="text-[11px] text-[var(--mute)]">Study Streak</div>
                  <div className="font-mono-num mt-1 text-lg font-extrabold tabular-nums text-[var(--ink)]">
                    {workspace.studyStreakDays} day{workspace.studyStreakDays === 1 ? '' : 's'}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

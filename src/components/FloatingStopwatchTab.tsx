import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Flag,
  Pause,
  Play,
  RotateCcw,
  Square,
  Timer,
  X,
} from 'lucide-react';
import { StopwatchState } from '../types';

interface FloatingStopwatchTabProps {
  stopwatch: StopwatchState;
  hidden?: boolean;
  toastMessage?: string | null;
  onToggle: () => void;
  onLap: () => void;
  onReset: () => void;
  onStopAndLog: () => void;
  onDismiss: () => void;
  onOpenPlannerTimer: () => void;
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function FloatingStopwatchTab({
  stopwatch,
  hidden = false,
  toastMessage = null,
  onToggle,
  onLap,
  onReset,
  onStopAndLog,
  onDismiss,
  onOpenPlannerTimer,
}: FloatingStopwatchTabProps) {
  const [expanded, setExpanded] = useState(false);

  const isVisible =
    !hidden &&
    (Boolean(toastMessage) ||
      ((stopwatch.running || stopwatch.elapsedSec > 0) && !stopwatch.dismissed));

  if (!isVisible) return null;

  const contextLabel = stopwatch.topicName
    ? `${stopwatch.subjectName} · ${stopwatch.topicName}`
    : stopwatch.subjectName || 'General Study';

  // Brief confirmation chip after stopping & logging a session
  if (toastMessage && !stopwatch.running && stopwatch.elapsedSec === 0) {
    return (
      <div
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-xl border border-[var(--ok)] bg-[var(--card)] px-3.5 py-2 text-xs font-semibold text-[var(--ok)] shadow-lg"
        role="status"
      >
        <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="whitespace-nowrap">{toastMessage}</span>
      </div>
    );
  }

  return (
    <aside
      aria-label="Active study stopwatch"
      className="fixed bottom-4 right-4 z-40 max-w-[calc(100vw-2rem)]"
    >
      {expanded ? (
        <div
          className="w-72 rounded-xl border border-[var(--line)] bg-[var(--card)] p-4 sm:w-80"
          style={{ boxShadow: 'var(--sh)' }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--e3)]">
                <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{stopwatch.running ? 'Stopwatch Running' : 'Stopwatch Paused'}</span>
              </div>
              <p
                className="mt-0.5 truncate text-xs font-semibold text-[var(--ink)]"
                title={contextLabel}
              >
                {contextLabel}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setExpanded(false)}
                title="Minimize stopwatch"
                aria-label="Minimize stopwatch"
                className="sd-btn h-7 w-7 p-0"
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  onDismiss();
                }}
                title="Hide minimized tab"
                aria-label="Hide stopwatch tab"
                className="sd-btn h-7 w-7 p-0 text-[var(--mute)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="font-mono-num my-3 text-center text-4xl font-extrabold tracking-tight tabular-nums text-[var(--ink)]">
            {stopwatch.text}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <button
              type="button"
              onClick={onToggle}
              className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap shrink-0"
            >
              {stopwatch.running ? (
                <>
                  <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Resume</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onLap}
              disabled={!stopwatch.running && stopwatch.elapsedSec === 0}
              className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap shrink-0"
              title="Record lap"
            >
              <Flag className="h-3 w-3" aria-hidden="true" />
              <span>Lap</span>
            </button>

            <button
              type="button"
              onClick={onStopAndLog}
              className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap shrink-0"
              title="Stop & log study minutes"
            >
              <Square className="h-3 w-3 text-[var(--ok)]" aria-hidden="true" />
              <span>Stop &amp; Log</span>
            </button>

            <button
              type="button"
              onClick={onReset}
              title="Reset stopwatch"
              aria-label="Reset stopwatch"
              className="sd-btn h-8 w-8 p-0 shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {stopwatch.laps.length > 0 && (
            <div className="mt-3 max-h-24 space-y-1 overflow-y-auto border-t border-[var(--line)] pt-2 text-[11px] text-[var(--mute)]">
              {stopwatch.laps.map((sec, idx) => (
                <div key={`${sec}_${idx}`} className="font-mono-num flex justify-between tabular-nums">
                  <span>Lap {stopwatch.laps.length - idx}</span>
                  <span className="font-bold text-[var(--ink)]">{formatClock(sec)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-[var(--line)] pt-2.5">
            <button
              type="button"
              onClick={() => {
                setExpanded(false);
                onOpenPlannerTimer();
              }}
              className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
            >
              <span>Open Focus Timer</span>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </button>
            {toastMessage && (
              <span className="text-[11px] font-semibold text-[var(--ok)]">{toastMessage}</span>
            )}
          </div>
        </div>
      ) : (
        <div
          className={`flex items-center gap-1.5 rounded-xl border bg-[var(--card)] px-2.5 py-1.5 ${
            stopwatch.running ? 'border-[var(--e3)]' : 'border-[var(--line)]'
          }`}
          style={{ boxShadow: 'var(--sh)' }}
        >
          <button
            type="button"
            onClick={() => setExpanded(true)}
            title={`Stopwatch: ${contextLabel} — click to expand`}
            className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-[var(--bg)]"
          >
            <Timer
              className={`h-4 w-4 shrink-0 ${
                stopwatch.running ? 'text-[var(--e3)]' : 'text-[var(--mute)]'
              }`}
              aria-hidden="true"
            />
            <span className="font-mono-num shrink-0 text-sm font-extrabold tabular-nums text-[var(--ink)]">
              {stopwatch.text}
            </span>
            <span className="max-w-[120px] truncate text-xs font-medium text-[var(--mute)] sm:max-w-[175px]">
              {contextLabel}
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-1 border-l border-[var(--line)] pl-1.5">
            <button
              type="button"
              onClick={onToggle}
              title={stopwatch.running ? 'Pause stopwatch' : 'Resume stopwatch'}
              aria-label={stopwatch.running ? 'Pause stopwatch' : 'Resume stopwatch'}
              className="sd-btn-pri h-7 w-7 p-0 shrink-0"
            >
              {stopwatch.running ? (
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={onStopAndLog}
              title="Stop & log study time"
              aria-label="Stop and log study time"
              className="sd-btn h-7 w-7 p-0 shrink-0 text-[var(--ok)]"
            >
              <Square className="h-3 w-3" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setExpanded(true)}
              title="Expand stopwatch"
              aria-label="Expand stopwatch"
              className="sd-btn h-7 w-7 p-0 shrink-0 text-[var(--mute)]"
            >
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

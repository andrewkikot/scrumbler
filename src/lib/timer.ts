/**
 * The discussion timer's arithmetic, kept free of Prisma and React so the
 * server route and the countdown on screen run the exact same rules — and so
 * both can be tested without either.
 *
 * A timer is three columns on Room. Exactly one shape is valid at a time:
 *
 *   idle     durationMs null
 *   running  endsAt set,  pausedMs null
 *   paused   endsAt null, pausedMs set   (negative once into overtime)
 *
 * Running past zero is not a separate state: it is a running timer whose
 * `endsAt` is behind us, and the clock counts up from there.
 */

export const TIMER_MIN_MS = 10_000;
export const TIMER_MAX_MS = 60 * 60_000;
/** The +1 min button, and the most one extension may add. */
export const TIMER_STEP_MS = 60_000;
export const TIMER_LABEL_MAX = 80;

export type TimerColumns = {
  timerEndsAt: Date | null;
  timerPausedMs: number | null;
  timerDurationMs: number | null;
  timerLabel: string | null;
};

export type TimerView = {
  /** Epoch ms when a running timer hits zero; null while paused. */
  endsAt: number | null;
  /** Time left while paused; null while running. */
  pausedMs: number | null;
  durationMs: number;
  label: string | null;
};

export type TimerAction =
  | { action: 'start'; durationMs: number; label?: string | null }
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'add'; durationMs?: number }
  | { action: 'stop' };

export const IDLE_TIMER: TimerColumns = {
  timerEndsAt: null,
  timerPausedMs: null,
  timerDurationMs: null,
  timerLabel: null,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function timerView(columns: TimerColumns): TimerView | null {
  if (columns.timerDurationMs === null) return null;
  return {
    endsAt: columns.timerEndsAt?.getTime() ?? null,
    pausedMs: columns.timerEndsAt ? null : (columns.timerPausedMs ?? 0),
    durationMs: columns.timerDurationMs,
    label: columns.timerLabel,
  };
}

/** Milliseconds left at `now` — negative once the timer has run out. */
export function remainingMs(timer: TimerView, now: number): number {
  return timer.endsAt !== null ? timer.endsAt - now : (timer.pausedMs ?? 0);
}

/**
 * The next set of columns for an action, or an error message when the action
 * makes no sense for the timer as it stands (pausing a paused timer, say).
 */
export function applyTimerAction(
  current: TimerColumns,
  input: TimerAction,
  now: number,
): { ok: true; data: TimerColumns } | { ok: false; error: string } {
  const view = timerView(current);

  switch (input.action) {
    case 'start': {
      const duration = clamp(Math.round(input.durationMs), TIMER_MIN_MS, TIMER_MAX_MS);
      const label = input.label?.trim().slice(0, TIMER_LABEL_MAX) || null;
      return {
        ok: true,
        data: {
          timerEndsAt: new Date(now + duration),
          timerPausedMs: null,
          timerDurationMs: duration,
          timerLabel: label,
        },
      };
    }

    case 'stop':
      return { ok: true, data: IDLE_TIMER };

    case 'pause': {
      if (!view || view.endsAt === null) return { ok: false, error: 'The timer is not running' };
      return {
        ok: true,
        data: { ...current, timerEndsAt: null, timerPausedMs: view.endsAt - now },
      };
    }

    case 'resume': {
      if (!view || view.pausedMs === null) return { ok: false, error: 'The timer is not paused' };
      return {
        ok: true,
        data: { ...current, timerEndsAt: new Date(now + view.pausedMs), timerPausedMs: null },
      };
    }

    case 'add': {
      if (!view) return { ok: false, error: 'There is no timer to extend' };
      const step = clamp(Math.round(input.durationMs ?? TIMER_STEP_MS), TIMER_MIN_MS, TIMER_STEP_MS * 10);
      const left = remainingMs(view, now);
      // Extending a timer already in overtime gives you the step from now, not
      // the step minus however long the room has been running over — and the
      // bar starts again from full, because that is what just happened.
      const overtime = left <= 0;
      const nextLeft = Math.min((overtime ? 0 : left) + step, TIMER_MAX_MS);
      const nextDuration = overtime ? nextLeft : Math.max(view.durationMs + step, nextLeft);
      return {
        ok: true,
        data: {
          ...current,
          timerEndsAt: view.endsAt !== null ? new Date(now + nextLeft) : null,
          timerPausedMs: view.endsAt !== null ? null : nextLeft,
          timerDurationMs: Math.min(nextDuration, TIMER_MAX_MS),
        },
      };
    }
  }
}

/** "4:05", "0:09", "-1:30" for overtime, "62:00" past the hour. */
export function formatClock(ms: number): string {
  const negative = ms < 0;
  // Count down in whole seconds that change *at* the second — 4.2s left reads
  // 0:05 until it is really 4s, so the display hits 0:00 exactly at zero.
  const total = negative ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${negative && total > 0 ? '-' : ''}${minutes}:${String(seconds).padStart(2, '0')}`;
}

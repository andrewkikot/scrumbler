'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RoomController } from '@/hooks/useRoom';
import { useNow } from '@/hooks/useNow';
import { playChime, unlockChime } from '@/lib/chime';
import { getTimerMuted, setTimerMuted } from '@/lib/client';
import { snapshot, subscribe } from '@/lib/store';
import { formatClock, remainingMs, TIMER_LABEL_MAX, TIMER_MAX_MS, TIMER_STEP_MS } from '@/lib/timer';

const PRESET_MINUTES = [1, 2, 3, 5, 10];

/** Whether this viewer may run the timer — the timer route makes the same call. */
export function canRunTimer(room: RoomController): boolean {
  return !room.readOnly && (room.isAdmin || room.state.settings.allowAnyoneToTime);
}

type TimerBarProps = {
  room: RoomController;
  /** The setup row is open — only meaningful while no timer is running. */
  setupOpen: boolean;
  onCloseSetup: () => void;
};

/**
 * The room's one shared timebox. It sits above the tabs' content, so a
 * discussion timed on the poker table stays on screen at the wheel.
 */
export function TimerBar({ room, setupOpen, onCloseSetup }: TimerBarProps) {
  const timer = room.state.timer;

  // Sound needs a gesture to be allowed at all, and the timer usually runs out
  // long after anyone last clicked. Every press re-arms it, because browsers
  // can suspend audio again later — a one-time unlock does not survive that.
  useEffect(() => {
    const unlock = () => unlockChime();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  if (timer) return <RunningTimer room={room} />;
  if (setupOpen && canRunTimer(room)) return <TimerSetup room={room} onClose={onCloseSetup} />;
  return null;
}

function TimerSetup({ room, onClose }: { room: RoomController; onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [custom, setCustom] = useState('');
  const customMinutes = Number(custom);
  const customValid =
    custom.trim() !== '' && customMinutes > 0 && customMinutes * 60_000 <= TIMER_MAX_MS;

  // Closing on start, not on the timer appearing: otherwise the setup row would
  // spring back open the moment somebody stops the timer.
  const start = (minutes: number) => {
    onClose();
    void room.timer({
      action: 'start',
      durationMs: Math.round(minutes * 60_000),
      label: label.trim() || null,
    });
  };

  return (
    <section className="px-panel flex flex-col gap-4 p-4" aria-labelledby="timer-setup-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="timer-setup-heading" className="text-[16px]">
          Timebox a discussion
        </h2>
        <button type="button" className="px-btn px-btn-sm" onClick={onClose}>
          Cancel
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="px-label" htmlFor="timer-label">
          Topic (optional)
        </label>
        <input
          id="timer-label"
          className="px-input"
          placeholder={room.state.round.topic || 'What are we discussing?'}
          value={label}
          maxLength={TIMER_LABEL_MAX}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {PRESET_MINUTES.map((minutes) => (
          <button
            key={minutes}
            type="button"
            className="px-btn px-btn-gold px-figures"
            onClick={() => start(minutes)}
          >
            {minutes} min
          </button>
        ))}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (customValid) start(customMinutes);
          }}
        >
          <span className="flex flex-col gap-1">
            <label className="px-label" htmlFor="timer-custom">
              Other
            </label>
            <input
              id="timer-custom"
              className="px-input px-figures"
              style={{ width: 88 }}
              type="number"
              inputMode="decimal"
              min={0.5}
              max={TIMER_MAX_MS / 60_000}
              step={0.5}
              placeholder="min"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          </span>
          <button type="submit" className="px-btn" disabled={!customValid}>
            Start
          </button>
        </form>
      </div>
    </section>
  );
}

function RunningTimer({ room }: { room: RoomController }) {
  const timer = room.state.timer!;
  const running = timer.endsAt !== null;
  const canControl = canRunTimer(room);

  const now = useNow(running);
  const left = running ? (now === null ? null : remainingMs(timer, now + room.clockOffset)) : remainingMs(timer, 0);
  const overtime = left !== null && left <= 0;

  const muted = useSyncExternalStore(
    subscribe,
    () => snapshot('timerMuted', getTimerMuted),
    () => false,
  );

  // Chime on the tick that crosses zero — not on load into a timer that ran
  // out before you arrived, and not on a paused one being resumed in overtime.
  const previous = useRef<{ endsAt: number | null; left: number | null }>({ endsAt: null, left: null });
  useEffect(() => {
    const before = previous.current;
    previous.current = { endsAt: timer.endsAt, left };
    if (
      running &&
      !muted &&
      before.endsAt === timer.endsAt &&
      before.left !== null &&
      before.left > 0 &&
      left !== null &&
      left <= 0
    ) {
      void playChime();
    }
  }, [left, running, muted, timer.endsAt]);

  const fraction = left === null ? 1 : Math.min(1, Math.max(0, left / timer.durationMs));
  // Whole 5% steps: the bar moves in visible clicks, like everything else here.
  const filled = overtime ? 100 : Math.ceil(fraction * 20) * 5;
  const accent = overtime ? 'var(--color-rose)' : running ? 'var(--color-gold)' : 'var(--color-ink-dim)';

  return (
    <section
      className="px-panel flex flex-wrap items-center gap-x-6 gap-y-3 p-4"
      aria-labelledby="timer-heading"
      style={overtime ? { background: 'var(--color-rose-deep)' } : undefined}
    >
      <div className="flex min-w-0 flex-col">
        <h2 id="timer-heading" className="truncate text-[13px] font-medium text-[color:var(--color-ink-dim)]">
          {timer.label || 'Timebox'}
        </h2>
        {/* role=timer is not announced as it changes, which is right for a
            clock; the status line below says the two moments that matter.
            Set in Plex like every other number here — the bitmap face's
            5/6 and 8/B are a guess from across a meeting room — and steady
            while paused: a blinking clock is half the time unreadable. */}
        <p
          role="timer"
          aria-label={left === null ? 'Timer' : `${formatClock(left)} ${overtime ? 'over time' : 'left'}`}
          className="px-numeral text-[52px] leading-none"
          style={{ color: accent }}
        >
          {left === null ? '–:––' : formatClock(left)}
        </p>
      </div>

      <div className="flex min-w-[160px] flex-1 flex-col gap-2">
        <div
          aria-hidden
          className="px-panel-sunken h-3 w-full"
          style={{ padding: 0, overflow: 'hidden' }}
        >
          <div style={{ width: `${filled}%`, height: '100%', background: accent }} />
        </div>
        <p role="status" aria-live="polite" className="text-[13px] text-[color:var(--color-ink-dim)]">
          {overtime ? "Time's up — wrap it up or add a minute." : running ? '' : 'Paused'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canControl && (
          <>
            <button
              type="button"
              className="px-btn px-btn-sm"
              onClick={() => void room.timer({ action: running ? 'pause' : 'resume' })}
            >
              {running ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              className="px-btn px-btn-sm px-btn-teal"
              onClick={() => void room.timer({ action: 'add', durationMs: TIMER_STEP_MS })}
            >
              +1 min
            </button>
            <button
              type="button"
              className="px-btn px-btn-sm"
              onClick={() => void room.timer({ action: 'stop' })}
            >
              Stop
            </button>
          </>
        )}
        {/* A toggle keeps one label and lets aria-pressed say the state —
            "Sound off" that is pressed would read as a double negative. */}
        <button
          type="button"
          className={`px-btn px-btn-sm ${muted ? 'px-btn-gold' : ''}`}
          aria-pressed={muted}
          onClick={() => {
            setTimerMuted(!muted);
            // Unmuting plays it once, so you know it works before it matters.
            if (muted) void playChime();
          }}
          title="Silences the chime on this device only"
        >
          Mute
        </button>
      </div>
    </section>
  );
}

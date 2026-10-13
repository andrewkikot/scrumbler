import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyTimerAction,
  formatClock,
  IDLE_TIMER,
  remainingMs,
  TIMER_MAX_MS,
  TIMER_MIN_MS,
  timerView,
  type TimerAction,
  type TimerColumns,
} from '../src/lib/timer';

const NOW = 1_000_000;

function step(columns: TimerColumns, action: TimerAction, now = NOW): TimerColumns {
  const result = applyTimerAction(columns, action, now);
  assert.ok(result.ok, result.ok ? undefined : result.error);
  return result.data;
}

const left = (columns: TimerColumns, now: number) => remainingMs(timerView(columns)!, now);

describe('timer: start and stop', () => {
  it('starts running with the full duration left', () => {
    const t = step(IDLE_TIMER, { action: 'start', durationMs: 120_000, label: '  Auth spike ' });
    assert.equal(left(t, NOW), 120_000);
    assert.equal(t.timerDurationMs, 120_000);
    assert.equal(t.timerLabel, 'Auth spike');
  });

  it('clamps a duration into range', () => {
    assert.equal(step(IDLE_TIMER, { action: 'start', durationMs: 1 }).timerDurationMs, TIMER_MIN_MS);
    assert.equal(
      step(IDLE_TIMER, { action: 'start', durationMs: TIMER_MAX_MS * 3 }).timerDurationMs,
      TIMER_MAX_MS,
    );
  });

  it('stops back to idle', () => {
    const t = step(step(IDLE_TIMER, { action: 'start', durationMs: 60_000 }), { action: 'stop' });
    assert.deepEqual(t, IDLE_TIMER);
    assert.equal(timerView(t), null);
  });
});

describe('timer: pause and resume', () => {
  it('keeps the time left across a pause', () => {
    const running = step(IDLE_TIMER, { action: 'start', durationMs: 60_000 });
    const paused = step(running, { action: 'pause' }, NOW + 20_000);
    assert.equal(paused.timerEndsAt, null);
    assert.equal(left(paused, NOW + 999_999), 40_000);

    const resumed = step(paused, { action: 'resume' }, NOW + 300_000);
    assert.equal(left(resumed, NOW + 300_000), 40_000);
  });

  it('refuses to pause what is not running, or resume what is not paused', () => {
    assert.equal(applyTimerAction(IDLE_TIMER, { action: 'pause' }, NOW).ok, false);
    const running = step(IDLE_TIMER, { action: 'start', durationMs: 60_000 });
    assert.equal(applyTimerAction(running, { action: 'resume' }, NOW).ok, false);
  });
});

describe('timer: extending', () => {
  it('adds to a running timer and to what the bar is out of', () => {
    const running = step(IDLE_TIMER, { action: 'start', durationMs: 60_000 });
    const extended = step(running, { action: 'add', durationMs: 60_000 }, NOW + 30_000);
    assert.equal(left(extended, NOW + 30_000), 90_000);
    assert.equal(extended.timerDurationMs, 120_000);
  });

  it('gives a full step from now once in overtime, with a fresh bar', () => {
    const running = step(IDLE_TIMER, { action: 'start', durationMs: 60_000 });
    const extended = step(running, { action: 'add', durationMs: 60_000 }, NOW + 90_000);
    assert.equal(left(extended, NOW + 90_000), 60_000);
    assert.equal(extended.timerDurationMs, 60_000);
  });

  it('extends a paused timer without starting it', () => {
    const paused = step(step(IDLE_TIMER, { action: 'start', durationMs: 60_000 }), { action: 'pause' });
    const extended = step(paused, { action: 'add' });
    assert.equal(extended.timerEndsAt, null);
    assert.equal(extended.timerPausedMs, 120_000);
  });

  it('refuses to extend nothing', () => {
    assert.equal(applyTimerAction(IDLE_TIMER, { action: 'add' }, NOW).ok, false);
  });
});

describe('timer: clock face', () => {
  it('reads minutes and seconds, rounding a partial second up', () => {
    assert.equal(formatClock(245_000), '4:05');
    assert.equal(formatClock(4_200), '0:05');
    assert.equal(formatClock(0), '0:00');
  });

  it('counts overtime up with a minus sign', () => {
    assert.equal(formatClock(-500), '0:00');
    assert.equal(formatClock(-90_000), '-1:30');
  });

  it('keeps counting minutes past the hour', () => {
    assert.equal(formatClock(62 * 60_000), '62:00');
  });
});

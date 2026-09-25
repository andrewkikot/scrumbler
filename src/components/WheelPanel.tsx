'use client';

import { useCallback, useState } from 'react';
import { Wheel } from '@/components/Wheel';
import type { RoomController } from '@/hooks/useRoom';

/** Reads "3 minutes ago" without pulling in a date library. */
function ago(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function WheelPanel({ room }: { room: RoomController }) {
  const { state, isAdmin } = room;
  const [newName, setNewName] = useState('');
  const [avoidRepeat, setAvoidRepeat] = useState(true);
  // Which spin the wheel has finished animating. Comparing it to the spin the
  // server reports tells us whether the wheel is still turning — no timers, and
  // nothing impure read during render.
  const [settled, setSettled] = useState<{ id: string; winner: string } | null>(null);

  const activeCount = state.wheel.filter((e) => e.active).length;

  const spinning = state.spin !== null && settled?.id !== state.spin.id;
  const announced = state.spin && settled?.id === state.spin.id ? settled.winner : null;

  const handleSettled = useCallback(
    (id: string, winner: string) => setSettled({ id, winner }),
    [],
  );

  const addNames = async () => {
    const labels = newName
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    if (!labels.length) return;
    await room.addWheelNames(labels);
    setNewName('');
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="flex flex-col items-center gap-6" aria-labelledby="wheel-heading">
        <h2 id="wheel-heading" className="sr-only">
          Daily lead wheel
        </h2>

        <Wheel entries={state.wheel} spin={state.spin} onSpinSettled={handleSettled} />

        <div aria-live="polite" className="min-h-[76px] text-center">
          {spinning ? (
            <p className="font-display px-blink text-[18px] text-[color:var(--color-ink-dim)]">
              Spinning…
            </p>
          ) : announced ? (
            <div className="px-pop">
              <p className="text-[13px] text-[color:var(--color-ink-dim)]">Running the next daily</p>
              <p className="font-display text-[30px] leading-tight text-[color:var(--color-gold)]">
                {announced}
              </p>
            </div>
          ) : state.spin ? (
            <div>
              <p className="text-[13px] text-[color:var(--color-ink-dim)]">Last drawn</p>
              <p className="font-display text-[30px] leading-tight text-[color:var(--color-gold)]">
                {state.spin.winnerLabel}
              </p>
            </div>
          ) : (
            <p className="text-[color:var(--color-ink-dim)]">
              {isAdmin ? 'Spin to pick who leads.' : 'Waiting for the admin to spin.'}
            </p>
          )}
        </div>

        {isAdmin && (
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              className="px-btn px-btn-gold text-[18px]"
              style={{ padding: '14px 40px' }}
              disabled={activeCount === 0 || spinning}
              onClick={() => void room.spin(avoidRepeat)}
            >
              SPIN
            </button>
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[color:var(--color-ink-dim)]">
              <input
                type="checkbox"
                checked={avoidRepeat}
                onChange={(e) => setAvoidRepeat(e.target.checked)}
                className="h-4 w-4 accent-[color:var(--color-gold)]"
              />
              Skip whoever led last
            </label>
          </div>
        )}
      </section>

      <aside className="flex flex-col gap-5">
        <section className="px-panel p-4" aria-labelledby="roster-heading">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 id="roster-heading" className="text-[16px]">
              On the wheel
            </h3>
            <span className="text-[13px] text-[color:var(--color-ink-dim)]">
              {activeCount} of {state.wheel.length}
            </span>
          </div>

          {state.wheel.length === 0 ? (
            <p className="text-[13px] text-[color:var(--color-ink-dim)]">
              {isAdmin
                ? 'Add the people in your rotation. They do not need to be in the room.'
                : 'The admin has not set up the rotation yet.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {state.wheel.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-2 py-1"
                  style={{ opacity: entry.active ? 1 : 0.45 }}
                >
                  <span className="truncate text-[14px]">{entry.label}</span>
                  {isAdmin && (
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className="px-btn px-btn-sm"
                        onClick={() => void room.updateWheelEntry(entry.id, { active: !entry.active })}
                      >
                        {entry.active ? 'Bench' : 'Add back'}
                      </button>
                      <button
                        type="button"
                        className="px-btn px-btn-sm px-btn-danger"
                        onClick={() => void room.removeWheelEntry(entry.id)}
                        aria-label={`Remove ${entry.label} from the wheel`}
                      >
                        Remove
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {isAdmin && (
            <div className="mt-4 flex flex-col gap-2">
              <label className="px-label" htmlFor="wheel-add">
                Add names
              </label>
              <input
                id="wheel-add"
                className="px-input"
                placeholder="Ana, Bo, Kim"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addNames();
                }}
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" className="px-btn px-btn-sm" onClick={() => void addNames()}>
                  Add
                </button>
                <button
                  type="button"
                  className="px-btn px-btn-sm"
                  onClick={() => void room.syncWheelFromRoom()}
                >
                  Add everyone here
                </button>
              </div>
            </div>
          )}
        </section>

        {state.history.length > 0 && (
          <section className="px-panel p-4" aria-labelledby="history-heading">
            <h3 id="history-heading" className="mb-3 text-[16px]">
              Recent draws
            </h3>
            <ol className="flex flex-col gap-1">
              {state.history.map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-3 text-[14px]">
                  <span className="truncate">{entry.winnerLabel}</span>
                  <span className="shrink-0 text-[12px] text-[color:var(--color-ink-dim)]">
                    {ago(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </aside>
    </div>
  );
}

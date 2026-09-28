'use client';

import { useCallback, useState, type CSSProperties } from 'react';
import { Wheel, type SpinResult } from '@/components/Wheel';
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
  const [dropWinner, setDropWinner] = useState(false);
  // Which spin the wheel has finished animating. Comparing it to the spin the
  // server reports tells us whether the wheel is still turning — no timers, and
  // nothing impure read during render.
  const [settled, setSettled] = useState<{ id: string; winner: string } | null>(null);

  const activeCount = state.wheel.filter((e) => e.active).length;

  const spinning = state.spin !== null && settled?.id !== state.spin.id;
  const announced = state.spin && settled?.id === state.spin.id ? settled.winner : null;
  /**
   * The winner's entry, while they are still on the wheel — so the admin can
   * drop them by hand when the automatic drop is switched off, or put them
   * back and drop somebody else. It disappears of its own accord the moment
   * they leave the wheel, whichever way they went.
   */
  const announcedEntry = announced
    ? (state.wheel.find((e) => e.active && e.label === announced) ?? null)
    : null;

  /**
   * Recent draws, minus the one the wheel is still flying towards.
   *
   * The server writes a spin into the history the moment it is created, so the
   * sidebar was printing the winner's name while the wheel was still turning —
   * eight seconds of suspense given away by a list in the corner. A draw joins
   * the list when the wheel stops on it, which is also the first moment it is
   * history rather than a spoiler.
   */
  const history = spinning
    ? state.history.filter((entry) => entry.id !== state.spin?.id)
    : state.history;

  /**
   * Benching happens here rather than in the spin route: the winner has to stay
   * on the wheel for the whole animation, and only the client knows when the
   * show is over. Every other client then sees the same entry go inactive and
   * drops the wedge to match.
   */
  const handleSettled = useCallback(
    ({ spinId, winnerLabel, fresh }: SpinResult) => {
      setSettled({ id: spinId, winner: winnerLabel });
      // `fresh` is false for a spin restored on load — acting on that would
      // bench somebody every time the page was refreshed.
      if (!fresh || !isAdmin || !dropWinner) return;
      const entry = state.wheel.find((e) => e.active && e.label === winnerLabel);
      if (entry) void room.updateWheelEntry(entry.id, { active: false });
    },
    [isAdmin, dropWinner, state.wheel, room],
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_296px] lg:gap-8">
      {/*
        The wheel is the whole point of this tab, so it gets the stage: the wide
        column, the middle of it, and as much of the viewport's height as it can
        take while still leaving Spin and the result in view. The 52svh cap is
        what keeps that promise on a laptop — the wheel plus the result line plus
        the button have to fit without scrolling, or the draw happens off-screen.

        The wheel, the name it lands on and the Spin button are one group at
        16px; the roster beside them is another, 32px away. The roster is
        reference material, so it aligns to the top of the stage rather than
        stretching down it, and takes a width set by the longest name.
      */}
      <section
        className="flex flex-col items-center justify-center gap-4 lg:min-h-[64svh]"
        style={{ '--wheel-max': 'min(100%, 52svh, 560px)' } as CSSProperties}
        aria-labelledby="wheel-heading"
      >
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
              {isAdmin && announcedEntry && (
                <button
                  type="button"
                  className="px-btn px-btn-sm mt-2"
                  onClick={() => void room.updateWheelEntry(announcedEntry.id, { active: false })}
                  aria-label={`Drop ${announced} off the wheel`}
                >
                  Drop off the wheel
                </button>
              )}
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
            {/* Natural case in the string, shouted by CSS: a redesign that
                wants sentence case should not mean editing copy. */}
            <button
              type="button"
              className="px-btn px-btn-gold text-[18px] uppercase"
              style={{ padding: '14px 40px' }}
              disabled={activeCount === 0 || spinning}
              onClick={() => void room.spin(avoidRepeat)}
            >
              Spin
            </button>
            <div className="flex flex-col items-start gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[color:var(--color-ink-dim)]">
                <input
                  type="checkbox"
                  checked={avoidRepeat}
                  onChange={(e) => setAvoidRepeat(e.target.checked)}
                  className="h-4 w-4 accent-[color:var(--color-gold)]"
                />
                Skip whoever led last
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[color:var(--color-ink-dim)]">
                <input
                  type="checkbox"
                  checked={dropWinner}
                  onChange={(e) => setDropWinner(e.target.checked)}
                  className="h-4 w-4 accent-[color:var(--color-gold)]"
                />
                Drop the winner automatically
              </label>
            </div>
          </div>
        )}
      </section>

      <aside className="flex flex-col gap-5 lg:self-start">
        <section className="px-panel p-4" aria-labelledby="roster-heading">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 id="roster-heading" className="text-[16px]">
              On the wheel
            </h3>
            <span className="px-figures text-[13px] text-[color:var(--color-ink-dim)]">
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
                /*
                  Being off the wheel used to be 45% opacity and nothing else.
                  That measured 3.68:1 against the panel, under the 4.5:1 text
                  floor, and a player — who sees no Drop/Add back button — had
                  no cue but the fade. Now the name takes the secondary text
                  token at full strength and says so in words.
                */
                <li key={entry.id} className="flex items-center justify-between gap-2 py-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={`truncate text-[14px] ${
                        entry.active ? '' : 'text-[color:var(--color-ink-dim)]'
                      }`}
                    >
                      {entry.label}
                    </span>
                    {!entry.active && (
                      <span className="px-chip shrink-0 text-[color:var(--color-ink-dim)]">
                        off
                      </span>
                    )}
                  </span>
                  {isAdmin && (
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className="px-btn px-btn-sm"
                        onClick={() => void room.updateWheelEntry(entry.id, { active: !entry.active })}
                        aria-label={
                          entry.active
                            ? `Drop ${entry.label} off the wheel`
                            : `Put ${entry.label} back on the wheel`
                        }
                      >
                        {entry.active ? 'Drop' : 'Add back'}
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

        {history.length > 0 && (
          <section className="px-panel p-4" aria-labelledby="history-heading">
            <h3 id="history-heading" className="mb-3 text-[16px]">
              Recent draws
            </h3>
            <ol className="flex flex-col gap-1">
              {history.map((entry) => (
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

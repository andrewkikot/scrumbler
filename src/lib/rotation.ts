/**
 * What the roster should look like once the wheel has stopped, and who may
 * actually be drawn — the rotation's bookkeeping, kept out of the routes so it
 * can be checked without a database.
 *
 * A room with `dropWinnerAfterSpin` on has a shrinking wheel: each draw takes
 * the winner off, so over a sprint everybody leads exactly once. The question
 * this answers is what happens when the last name goes: an empty wheel means
 * the rotation is finished, and the room should not have to put twelve names
 * back by hand to start the next one.
 *
 * So the wheel refills itself, with everybody on it — including the name that
 * just closed the rotation, who is back on the wheel like anyone else. The one
 * catch is the seam: drawn again on the very next spin they would run two
 * dailies in a row, which is the thing a rotation exists to prevent. So that
 * one draw skips them. They are on the wheel throughout, and in the running
 * again from the draw after.
 */

export type RotationEntry = { id: string; label: string; active: boolean };

export type RotationSettlement = {
  /** Entry ids to put (back) on the wheel. */
  activate: string[];
  /** Entry ids to take off it. */
  deactivate: string[];
  /**
   * The name the next draw must skip, or null if there is none. Only a draw
   * that closes a rotation sets one; the spin that serves it clears it.
   */
  heldOver: string | null;
};

/**
 * Settle `roster` after the wheel landed on `winnerLabel`.
 *
 * Pure, and a function of the roster as it stands. It does not decide whether
 * to run — the settle route checks that against the spin it has already
 * settled, because once a rotation has closed and refilled there is nothing
 * left in the roster to tell a settled draw from an unsettled one.
 */
export function settleRotation(roster: RotationEntry[], winnerLabel: string): RotationSettlement {
  const winner = roster.find((e) => e.label === winnerLabel) ?? null;
  const on = new Set(roster.filter((e) => e.active).map((e) => e.id));

  // The wheel landed on them. Their turn is spent.
  if (winner) on.delete(winner.id);

  let heldOver: string | null = null;

  // Nothing left on the wheel: everybody has led, so the rotation starts over
  // with the whole roster back on — the name that just closed it included.
  if (on.size === 0) {
    for (const entry of roster) on.add(entry.id);
    // The next draw skips them instead. A one-name wheel has nobody to skip
    // to, so it holds nobody.
    if (winner && roster.length > 1) heldOver = winner.label;
  }

  return {
    activate: roster.filter((e) => !e.active && on.has(e.id)).map((e) => e.id),
    deactivate: roster.filter((e) => e.active && !on.has(e.id)).map((e) => e.id),
    heldOver,
  };
}

/**
 * Who is actually in a draw: everyone on the wheel, less whoever the last
 * rotation held over.
 *
 * The hold never empties the draw. On a wheel the held name has to itself —
 * everyone else removed since the refill — there is nobody to skip to, and a
 * wheel that cannot be spun is worse than a repeat.
 */
export function drawPool<T extends { label: string }>(
  active: T[],
  heldOverLabel: string | null,
): T[] {
  if (!heldOverLabel) return active;
  const pool = active.filter((e) => e.label !== heldOverLabel);
  return pool.length > 0 ? pool : active;
}

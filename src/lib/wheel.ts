/**
 * Wheel geometry, kept out of the component so every client derives the same
 * numbers from the same spin — and so it can be checked without a canvas.
 *
 * Angles are degrees measured clockwise from 12 o'clock, where the pointer is.
 */

/** How many full turns a spin takes. Derived from the id so clients agree. */
export function turnsFor(spinId: string): number {
  let hash = 0;
  for (let i = 0; i < spinId.length; i += 1) hash = (hash * 31 + spinId.charCodeAt(i)) >>> 0;
  return 8 + (hash % 5);
}

/** The angle a segment's centre sits at when the wheel is unrotated. */
export function segmentCenter(index: number, count: number): number {
  const segment = 360 / count;
  return index * segment + segment / 2;
}

/**
 * The rotation that leaves `index` under the pointer, after `turns` full
 * revolutions.
 */
export function restAngle(index: number, count: number, turns: number): number {
  return 360 * turns - segmentCenter(index, count);
}

/** Which segment is under the pointer at a given rotation. */
export function segmentUnderPointer(rotation: number, count: number): number {
  const segment = 360 / count;
  const normalised = (((-rotation % 360) + 360) % 360) % 360;
  return Math.min(count - 1, Math.floor(normalised / segment));
}

/**
 * Which wedge of `layout` is the winner being dropped off the wheel, or -1 if
 * this roster change is something else entirely (a name added, someone else
 * benched, two changes at once).
 *
 * It is the one case where the drawn wheel has to lag behind the roster: the
 * wedge must fall out before the remaining names close the gap.
 */
export function droppedWinnerIndex(
  layout: { id: string; label: string }[],
  active: { id: string }[],
  winnerLabel: string | null,
): number {
  if (!winnerLabel || active.length !== layout.length - 1) return -1;
  const gone = layout.filter((entry) => !active.some((a) => a.id === entry.id));
  if (gone.length !== 1 || gone[0].label !== winnerLabel) return -1;
  return layout.indexOf(gone[0]);
}

/** Fraction of the spin spent loading the spring before anything launches. */
export const SPIN_WINDUP = 0.07;

/** How far the wheel rocks backwards during that wind-up, in degrees. */
export const SPIN_WINDUP_DEG = 11;

/**
 * Fraction of the total travel covered at `t` (0…1).
 *
 * A quintic tail: the wheel throws most of its distance away in the first
 * second and then spends the rest of the spin crawling through single clacks —
 * which is what makes the last two names feel like a contest.
 */
export function spinProgress(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped <= SPIN_WINDUP) return 0;
  const u = (clamped - SPIN_WINDUP) / (1 - SPIN_WINDUP);
  return 1 - (1 - u) ** 5;
}

/**
 * Degrees to pull *back* at `t` — a short anticipation rock that returns to
 * zero exactly as `spinProgress` starts moving, so the two never fight.
 */
export function windupDeg(t: number): number {
  if (t <= 0 || t >= SPIN_WINDUP) return 0;
  return SPIN_WINDUP_DEG * Math.sin((t / SPIN_WINDUP) * Math.PI);
}

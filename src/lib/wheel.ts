/**
 * Wheel geometry, kept out of the component so every client derives the same
 * numbers from the same spin — and so it can be checked without a canvas.
 *
 * Angles are degrees measured clockwise from 12 o'clock, where the pointer is.
 */

/**
 * How many full turns a spin takes. Derived from the id so clients agree.
 *
 * Enough travel that the wheel is still turning a good two revolutions a
 * second half way through the spin, which is what a flicked wheel actually
 * does — but not so many that the launch is a blur of colour.
 */
export function turnsFor(spinId: string): number {
  let hash = 0;
  for (let i = 0; i < spinId.length; i += 1) hash = (hash * 31 + spinId.charCodeAt(i)) >>> 0;
  return 9 + (hash % 4);
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
 * Which wedge of `layout` has just left the wheel, or -1 if this roster
 * change is something else (a name added, a rename, two changes at once).
 *
 * Whoever took them off and for whatever reason — the winner benched after a
 * spin, or the admin dropping somebody by hand — one name leaving is the one
 * case where the drawn wheel has to lag behind the roster: the wedge must fall
 * out before the remaining names close the gap.
 */
export function droppedIndex(
  layout: { id: string; label: string }[],
  active: { id: string; label: string }[],
): number {
  if (active.length !== layout.length - 1) return -1;

  // Walk the two lists in step. Anything but a single clean omission — a
  // rename riding along, a reorder, a swap — is not a drop, and the wheel is
  // better off simply redrawing.
  let missing = -1;
  for (let i = 0, j = 0; i < layout.length; i += 1) {
    const here = layout[i];
    const there = active[j];
    if (there && there.id === here.id && there.label === here.label) {
      j += 1;
      continue;
    }
    if (missing >= 0) return -1;
    missing = i;
  }
  return missing;
}

/** Fraction of the spin spent loading the spring before anything launches. */
export const SPIN_WINDUP = 0.04;

/** How far the wheel rocks backwards during that wind-up, in degrees. */
export const SPIN_WINDUP_DEG = 11;

/**
 * How sharply the wheel sheds speed. 2 is a wheel braked by constant friction;
 * a little above that keeps the launch snappy without freezing the tail.
 *
 * Anything much higher (the quintic this used to be) dumps the whole travel in
 * the first second and leaves the rest of the spin visually stopped — the wheel
 * reads as broken rather than as slowing down.
 */
export const SPIN_DECAY = 2.2;

/**
 * Fraction of the total travel covered at `t` (0…1).
 *
 * Hard off the line, then a long, *visible* deceleration — near enough to the
 * constant-friction curve of a real wheel that it reads as one. Speed bleeds
 * away for the whole eight seconds, with a segment still passing under the
 * pointer in the final second, so the last clacks are the contest rather than
 * a wheel that has already secretly finished.
 */
export function spinProgress(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped <= SPIN_WINDUP) return 0;
  const u = (clamped - SPIN_WINDUP) / (1 - SPIN_WINDUP);
  return 1 - (1 - u) ** SPIN_DECAY;
}

/**
 * Degrees to pull *back* at `t` — a short anticipation rock that returns to
 * zero exactly as `spinProgress` starts moving, so the two never fight.
 */
export function windupDeg(t: number): number {
  if (t <= 0 || t >= SPIN_WINDUP) return 0;
  return SPIN_WINDUP_DEG * Math.sin((t / SPIN_WINDUP) * Math.PI);
}

/**
 * Where to spin *to* from wherever the wheel is currently sitting.
 *
 * `restAngle` is an absolute angle, and a wheel that has already spun is not
 * sitting at zero — landing on the raw value can mean a short hop, or even a
 * run backwards into the result. This slides the landing forward by whole
 * turns until the wheel has at least `turns` revolutions left to travel.
 */
export function spinTarget(from: number, index: number, count: number, turns: number): number {
  const rest = restAngle(index, count, turns);
  // Whole turns first, then the shortest forward hop onto an angle that puts
  // the winner under the pointer. Every spin is then `turns` revolutions plus
  // at most one more, whatever the wheel was left sitting at.
  const base = from + 360 * turns;
  const hop = (((rest - base) % 360) + 360) % 360;
  return base + hop;
}

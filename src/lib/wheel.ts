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
  return 5 + (hash % 4);
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

/** Decelerating spin curve — fast out of the gate, a long slow settle. */
export const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

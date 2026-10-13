'use client';

import { useSyncExternalStore } from 'react';

/**
 * A shared clock for countdowns: one interval for the whole page however many
 * components read it, running only while something is subscribed.
 */
const TICK_MS = 200;

type Listener = () => void;
const listeners = new Set<Listener>();
let now: number | null = null;
let interval: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  interval ??= setInterval(() => {
    now = Date.now();
    for (const l of listeners) l();
  }, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && interval) {
      clearInterval(interval);
      interval = null;
      now = null;
    }
  };
}

const neverChanges = () => () => {};
// Cached between ticks: useSyncExternalStore must see the same value until the
// store says it changed.
const read = () => (now ??= Date.now());

/**
 * `Date.now()`, re-rendering five times a second while `ticking` — and null
 * during server rendering, which cannot know what time the viewer will see.
 */
export function useNow(ticking: boolean): number | null {
  return useSyncExternalStore(ticking ? subscribe : neverChanges, read, () => null);
}

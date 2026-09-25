'use client';

/**
 * A subscribable view over localStorage, so components can read browser state
 * with `useSyncExternalStore` instead of copying it into React state from an
 * effect.
 *
 * The useful side effect: because `storage` events are part of the
 * subscription, opening the same room in a second tab picks up the admin token
 * and seat the moment the first tab writes them.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * `useSyncExternalStore` re-renders whenever `getSnapshot` returns a new
 * reference, so anything that builds an object or array must be memoised here
 * and invalidated only when something actually changed.
 */
const snapshots = new Map<string, unknown>();

function handleStorageEvent() {
  invalidate();
}

export function subscribe(listener: Listener): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorageEvent);
  }
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorageEvent);
    }
  };
}

/** Drop cached snapshots and tell every subscriber to re-read. */
export function invalidate(): void {
  snapshots.clear();
  for (const listener of listeners) listener();
}

/** Memoise a derived value until the next `invalidate()`. */
export function snapshot<T>(key: string, compute: () => T): T {
  if (!snapshots.has(key)) snapshots.set(key, compute());
  return snapshots.get(key) as T;
}

/** `true` once React is running in the browser; `false` during SSR. */
export const onClient = () => true;
export const onServer = () => false;

/**
 * A tiny in-process pub/sub so SSE streams served by the *same* serverless
 * instance react instantly instead of waiting for the next poll tick.
 *
 * It is deliberately best-effort: Vercel may spread connections across
 * instances, so `waitForChange` always resolves on a timeout too and the caller
 * re-checks `Room.version` in the database. The bus is a latency optimisation,
 * never the source of truth.
 */
type Waiter = () => void;

const globalForBus = globalThis as unknown as { __scrumblerBus?: Map<string, Set<Waiter>> };
const channels: Map<string, Set<Waiter>> = (globalForBus.__scrumblerBus ??= new Map());

/** Wake every stream currently parked on this room. */
export function publish(slug: string): void {
  const waiters = channels.get(slug);
  if (!waiters?.size) return;
  // Copy first: each waiter removes itself as it resolves.
  for (const waiter of [...waiters]) waiter();
}

/**
 * Resolve as soon as someone publishes to `slug`, or after `timeoutMs`,
 * or when the request is aborted — whichever happens first.
 */
export function waitForChange(slug: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();

    const waiters = channels.get(slug) ?? new Set<Waiter>();
    if (!channels.has(slug)) channels.set(slug, waiters);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      waiters.delete(waiter);
      if (waiters.size === 0) channels.delete(slug);
      signal.removeEventListener('abort', finish);
      resolve();
    };

    const waiter: Waiter = finish;
    const timer = setTimeout(finish, timeoutMs);

    waiters.add(waiter);
    signal.addEventListener('abort', finish, { once: true });
  });
}

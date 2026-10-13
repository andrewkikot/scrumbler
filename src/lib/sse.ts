import { waitForChange } from './bus';
import type { RoomState } from './types';

/** How long a connection lives before we hand it back for a clean reconnect. */
const CONNECTION_TTL_MS = 50_000;
/** Upper bound on how stale a cross-instance change can be. */
const POLL_MS = 1_000;
/** Comment frames keep proxies from closing an idle connection. */
const PING_EVERY_MS = 15_000;

type StreamSource = {
  /** The bus channel to park on — always the room's slug, even for watchers. */
  channel: string;
  /** One tiny read per tick; null means the room (or this link to it) is gone. */
  readVersion: () => Promise<number | null>;
  readState: () => Promise<RoomState | null>;
};

/**
 * A Server-Sent Events response that pushes `state` frames as a room changes.
 *
 * Vercel's serverless functions cannot hold a WebSocket, so this is the push
 * channel: one long-lived GET per client, with POST routes carrying the writes.
 * Server-to-client latency is what matters for planning poker, and SSE gives us
 * that with native browser reconnects and zero extra infrastructure.
 *
 * Change detection is two-tier:
 *   1. `waitForChange` — an in-process signal, so clients on the same instance
 *      see a vote land essentially immediately.
 *   2. a `Room.version` poll — one tiny indexed read, which catches writes that
 *      landed on a *different* instance.
 *
 * Shared by the player stream and the watch stream, which differ only in how
 * they find the room and how much of it they may see.
 */
export function roomStream(request: Request, initial: RoomState, source: StreamSource): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;

      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };
      const send = (event: string, data: unknown) =>
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      // Tell EventSource how fast to come back after we close.
      write('retry: 2000\n\n');
      send('state', initial);

      let lastVersion = initial.version;
      let lastPing = Date.now();
      const expiresAt = Date.now() + CONNECTION_TTL_MS;

      try {
        while (open && !request.signal.aborted && Date.now() < expiresAt) {
          await waitForChange(source.channel, POLL_MS, request.signal);
          if (request.signal.aborted) break;

          const version = await source.readVersion();

          if (version === null) {
            send('gone', {});
            break;
          }

          if (version !== lastVersion) {
            const state = await source.readState();
            if (state) {
              lastVersion = state.version;
              send('state', state);
              lastPing = Date.now();
            }
          } else if (Date.now() - lastPing > PING_EVERY_MS) {
            write(': ping\n\n');
            lastPing = Date.now();
          }
        }
      } catch (error) {
        console.error('[scrumbler] stream error', error);
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed by the client disconnecting */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform, must-revalidate',
      Connection: 'keep-alive',
      // Disable proxy buffering, which would otherwise hold our frames back.
      'X-Accel-Buffering': 'no',
    },
  });
}

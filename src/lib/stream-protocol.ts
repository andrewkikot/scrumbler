/**
 * Which client is asking, read from the stream URL and the heartbeat body.
 *
 *   (none)  Tabs loaded before the stream learned to close itself. They
 *           reconnect forever, so the stream answers 204, which tells
 *           EventSource to stop for good, and their heartbeat gets 204 before
 *           any database work. They pick up new code on the next reload.
 *   2       Closes its stream when hidden or idle, but knows nothing about
 *           being disconnected by the super admin: a disconnected room answers
 *           its stream with 204, because it would ignore a `kicked` frame and
 *           reconnect. It does not mark its heartbeat, so that gets 204 too.
 *   3       Current. Sends `since`, the server time its session began, and
 *           stops on a `kicked` frame or heartbeat reply.
 *
 * Bump it only for another change older clients must not keep running.
 */
export const STREAM_PROTOCOL_PARAM = 'v';
export const STREAM_PROTOCOL = '3';
export const SINCE_PARAM = 'since';

export type StreamClient = {
  /** Understands a `kicked` frame. */
  kickAware: boolean;
  /** Server time this tab's session began; 0 when it doesn't say. */
  since: number;
};

const noContent = () => new Response(null, { status: 204 });

const readSince = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The stream's caller, or the 204 that sends a too-old tab away. */
export function readStreamClient(request: Request): StreamClient | Response {
  const params = new URL(request.url).searchParams;
  const version = params.get(STREAM_PROTOCOL_PARAM);
  if (version !== '2' && version !== STREAM_PROTOCOL) return noContent();
  return { kickAware: version === STREAM_PROTOCOL, since: readSince(params.get(SINCE_PARAM)) };
}

/** The 204 for a heartbeat from a tab that cannot be told to stop. */
export function rejectOutdatedHeartbeat(body: { v?: string }): Response | null {
  return body.v === STREAM_PROTOCOL ? null : noContent();
}

/** Was this session disconnected? Returns when, or null. */
export function kickedAt(disconnectedAt: number | null, since: number): number | null {
  return disconnectedAt !== null && since < disconnectedAt ? disconnectedAt : null;
}

export { readSince };

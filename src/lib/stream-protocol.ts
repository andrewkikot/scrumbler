/**
 * Marks a stream request as coming from a client that closes its stream when
 * the tab is hidden or the room goes idle.
 *
 * Tabs loaded before that change reconnect forever, keeping a function running
 * around the clock. They don't send this marker, so the stream routes answer
 * them with 204, which tells EventSource to stop reconnecting for good. The tab
 * picks up the new code, and its live updates, on the next reload.
 *
 * Bump it only for another change old clients must not keep running.
 */
export const STREAM_PROTOCOL_PARAM = 'v';
export const STREAM_PROTOCOL = '2';

/** 204 for a client too old to stream, or null to carry on. */
export function rejectOutdatedClient(request: Request): Response | null {
  const version = new URL(request.url).searchParams.get(STREAM_PROTOCOL_PARAM);
  return version === STREAM_PROTOCOL ? null : new Response(null, { status: 204 });
}

import { findWatchedRoom, getWatchState, getWatchVersion } from '@/lib/room';
import { roomStream } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/watch/:token/stream — the player stream, seen through the watch link.
 *
 * The version is polled by token rather than by slug, so resetting the link
 * ends every stream on the old one within a second: they get `gone`, the same
 * as if the room had been deleted.
 */
export async function GET(request: Request, { params }: Ctx) {
  const { token } = await params;
  const room = await findWatchedRoom(token);
  const initial = room && (await getWatchState(token));
  if (!room || !initial) return new Response('Watch link not found', { status: 404 });

  return roomStream(request, initial, {
    channel: room.slug,
    readVersion: () => getWatchVersion(token),
    readState: () => getWatchState(token),
  });
}

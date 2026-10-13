import { json, notFound, route } from '@/lib/api';
import { getWatchState } from '@/lib/room';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/watch/:token — the room, read-only.
 *
 * There is no other verb under /api/watch, and that is the whole guarantee:
 * every write lives under /api/rooms/:slug, and this snapshot leaves the slug
 * out. Holding a watch link gets you the table and nothing to act on it with.
 */
export const GET = route(async (_request: Request, { params }: Ctx) => {
  const { token } = await params;
  const state = await getWatchState(token);
  if (!state) return notFound('This watch link is not valid any more');
  return json(state);
});

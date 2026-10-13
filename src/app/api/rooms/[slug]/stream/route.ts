import { getRoomState, getRoomVersion } from '@/lib/room';
import { roomStream } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Vercel caps a Hobby function at 60s; the stream closes just under it, on purpose. */
export const maxDuration = 60;

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/rooms/:slug/stream — Server-Sent Events. See `roomStream`. */
export async function GET(request: Request, { params }: Ctx) {
  const { slug } = await params;
  // EventSource cannot set headers, so the viewer identifies itself in the URL.
  // It only unlocks seeing your own card early — it grants nothing else.
  const viewer = new URL(request.url).searchParams.get('clientId');

  const initial = await getRoomState(slug, viewer);
  if (!initial) return new Response('Room not found', { status: 404 });

  return roomStream(request, initial, {
    channel: slug,
    readVersion: () => getRoomVersion(slug),
    readState: () => getRoomState(slug, viewer),
  });
}

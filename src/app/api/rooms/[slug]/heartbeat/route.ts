import { z } from 'zod';
import { json, notFound, readBody, route } from '@/lib/api';
import { prisma } from '@/lib/db';
import { bumpAndPublish, dropAbsent, findRoom } from '@/lib/room';
import { ONLINE_WINDOW_MS } from '@/lib/types';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ slug: string }> };

const Heartbeat = z.object({ clientId: z.string().min(8).max(64) });

/**
 * POST /api/rooms/:slug/heartbeat — presence ping.
 *
 * Deliberately does NOT bump the room version: a heartbeat every ~20s per user
 * would otherwise push a snapshot to everyone constantly. Instead we only bump
 * when presence actually changes (someone was away and is back, or somebody
 * has been gone long enough to leave), which is what other clients need to see.
 *
 * The sweep runs before the lookup on purpose: a laptop waking after an hour
 * has already left, and its own ping must not pull it back into the
 * room. It gets `known: false` and the join form, with its name filled in.
 */
export const POST = route(async (request: Request, { params }: Ctx) => {
  const { slug } = await params;
  const room = await findRoom(slug);
  if (!room) return notFound();

  const body = await readBody(request, Heartbeat);
  if (!body.ok) return body.response;

  const dropped = await dropAbsent(room.id);

  const participant = await prisma.participant.findUnique({
    where: { roomId_clientId: { roomId: room.id, clientId: body.data.clientId } },
    select: { id: true, lastSeenAt: true },
  });
  if (!participant) {
    if (dropped > 0) await bumpAndPublish(room.id, slug);
    return json({ known: false, participantId: null });
  }

  const wasAway = Date.now() - participant.lastSeenAt.getTime() >= ONLINE_WINDOW_MS;
  await prisma.participant.update({ where: { id: participant.id }, data: { lastSeenAt: new Date() } });

  if (wasAway || dropped > 0) await bumpAndPublish(room.id, slug);

  return json({ known: true, participantId: participant.id, version: room.version });
});

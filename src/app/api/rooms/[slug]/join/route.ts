import { z } from 'zod';
import { fail, json, notFound, readBody, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
import { DAY_MS, MAX_PARTICIPANTS_PER_ROOM, rateLimit, STALE_PARTICIPANT_DAYS } from '@/lib/limits';
import { bumpAndPublish, findRoom, getRoomState } from '@/lib/room';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ slug: string }> };

const Join = z.object({
  clientId: z.string().min(8).max(64),
  name: z.string().trim().min(1).max(32),
  isSpectator: z.boolean().optional(),
});

/**
 * POST /api/rooms/:slug/join — idempotent. The browser owns `clientId`, so a
 * refresh re-attaches to the same participant instead of creating a duplicate.
 */
export const POST = route(async (request: Request, { params }: Ctx) => {
  const { slug } = await params;
  const room = await findRoom(slug);
  if (!room) return notFound();

  const limited = await rateLimit(request, 'join');
  if (limited) return limited;

  const body = await readBody(request, Join);
  if (!body.ok) return body.response;
  const { clientId, name, isSpectator } = body.data;

  // Any clientId mints a seat, so a room needs a ceiling. Re-joining (a rename,
  // a refresh) never counts against it. A soft cap — two joins racing for the
  // last seat may both get in — which is fine: it bounds a flood, not a guest.
  const seated = await prisma.participant.findUnique({
    where: { roomId_clientId: { roomId: room.id, clientId } },
    select: { id: true },
  });
  if (!seated) {
    let seats = await prisma.participant.count({ where: { roomId: room.id } });
    if (seats >= MAX_PARTICIPANTS_PER_ROOM) {
      // A permanent room fills up with people who closed the tab months ago.
      // Clear those before turning away somebody who is actually here.
      await prisma.participant.deleteMany({
        where: {
          roomId: room.id,
          lastSeenAt: { lt: new Date(Date.now() - STALE_PARTICIPANT_DAYS * DAY_MS) },
        },
      });
      seats = await prisma.participant.count({ where: { roomId: room.id } });
    }
    if (seats >= MAX_PARTICIPANTS_PER_ROOM) {
      return fail(409, `This room is full — it seats ${MAX_PARTICIPANTS_PER_ROOM}. Ask the admin to remove someone.`);
    }
  }

  const participant = await prisma.participant.upsert({
    where: { roomId_clientId: { roomId: room.id, clientId } },
    create: { roomId: room.id, clientId, name, isSpectator: isSpectator ?? false },
    update: { name, lastSeenAt: new Date(), ...(isSpectator === undefined ? {} : { isSpectator }) },
  });

  await bumpAndPublish(room.id, slug);

  return json({ participantId: participant.id, state: await getRoomState(slug, viewerId(request)) });
});

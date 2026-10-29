import { z } from 'zod';
import { fail, json, notFound, readBody, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
import { MAX_PARTICIPANTS_PER_ROOM, rateLimit } from '@/lib/limits';
import { bumpAndPublish, dropAbsent, findRoom, getRoomState } from '@/lib/room';

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

  // Whoever has been gone long enough leaves first, so the seats counted below
  // belong to people who are here (or whose card is still on a revealed table).
  await dropAbsent(room.id);

  // Any clientId mints a seat, so a room needs a ceiling. Re-joining (a rename,
  // a refresh) never counts against it. A soft cap — two joins racing for the
  // last seat may both get in — which is fine: it bounds a flood, not a guest.
  const seated = await prisma.participant.findUnique({
    where: { roomId_clientId: { roomId: room.id, clientId } },
    select: { id: true },
  });
  if (!seated) {
    const seats = await prisma.participant.count({ where: { roomId: room.id } });
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

import { z } from 'zod';
import { json, notFound, readBody, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
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

  const body = await readBody(request, Join);
  if (!body.ok) return body.response;
  const { clientId, name, isSpectator } = body.data;

  const participant = await prisma.participant.upsert({
    where: { roomId_clientId: { roomId: room.id, clientId } },
    create: { roomId: room.id, clientId, name, isSpectator: isSpectator ?? false },
    update: { name, lastSeenAt: new Date(), ...(isSpectator === undefined ? {} : { isSpectator }) },
  });

  await bumpAndPublish(room.id, slug);

  return json({ participantId: participant.id, state: await getRoomState(slug, viewerId(request)) });
});

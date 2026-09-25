import { z } from 'zod';
import { forbidden, json, notFound, readBody, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
import { bumpAndPublish, currentRound, findRoom, getRoomState, isAdmin } from '@/lib/room';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ slug: string }> };

const RoundAction = z.object({
  action: z.enum(['reveal', 'hide', 'clear', 'next', 'topic']),
  topic: z.string().trim().max(120).nullable().optional(),
});

/** POST /api/rooms/:slug/round — admin-only round control. */
export const POST = route(async (request: Request, { params }: Ctx) => {
  const { slug } = await params;
  const room = await findRoom(slug);
  if (!room) return notFound();
  if (!isAdmin(request, room.adminToken)) return forbidden();

  const body = await readBody(request, RoundAction);
  if (!body.ok) return body.response;
  const { action, topic } = body.data;

  const round = await currentRound(room.id);

  switch (action) {
    case 'reveal':
      await prisma.round.update({
        where: { id: round.id },
        data: { revealed: true, revealedAt: new Date() },
      });
      break;

    case 'hide':
      await prisma.round.update({
        where: { id: round.id },
        data: { revealed: false, revealedAt: null },
      });
      break;

    // Wipe the votes but stay on the same topic — "let's re-estimate this one".
    case 'clear':
      await prisma.vote.deleteMany({ where: { roundId: round.id } });
      await prisma.round.update({
        where: { id: round.id },
        data: { revealed: false, revealedAt: null },
      });
      break;

    // Move on to the next story, keeping the finished round as history.
    case 'next':
      await prisma.round.create({
        data: { roomId: room.id, number: round.number + 1, topic: topic ?? null },
      });
      break;

    case 'topic':
      await prisma.round.update({ where: { id: round.id }, data: { topic: topic ?? null } });
      break;
  }

  await bumpAndPublish(room.id, slug);
  return json(await getRoomState(slug, viewerId(request)));
});

import { z } from 'zod';
import { fail, json, notFound, readBody, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
import { resolveDeck } from '@/lib/decks';
import { bumpAndPublish, currentRound, findRoom, getRoomState, maybeAutoReveal } from '@/lib/room';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ slug: string }> };

const CastVote = z.object({
  clientId: z.string().min(8).max(64),
  /** `null` retracts the vote. */
  value: z.string().max(16).nullable(),
});

/** POST /api/rooms/:slug/vote — players need no auth beyond their clientId. */
export const POST = route(async (request: Request, { params }: Ctx) => {
  const { slug } = await params;
  const room = await findRoom(slug);
  if (!room) return notFound();

  const body = await readBody(request, CastVote);
  if (!body.ok) return body.response;
  const { clientId, value } = body.data;

  const participant = await prisma.participant.findUnique({
    where: { roomId_clientId: { roomId: room.id, clientId } },
  });
  if (!participant) return fail(409, 'Join the room before voting');
  if (participant.isSpectator && !room.allowSpectatorVote) {
    return fail(403, 'Spectators cannot vote in this room');
  }

  const round = await currentRound(room.id);
  if (round.revealed) return fail(409, 'This round is already revealed');

  if (value !== null && !resolveDeck(room.deckKey, room.customDeck).includes(value)) {
    return fail(400, 'That card is not in this room’s deck');
  }

  const existing = await prisma.vote.findUnique({
    where: { roundId_participantId: { roundId: round.id, participantId: participant.id } },
    select: { id: true },
  });
  if (existing && !room.allowRevote) return fail(403, 'Votes are locked once cast in this room');

  if (value === null) {
    if (existing) await prisma.vote.delete({ where: { id: existing.id } });
  } else {
    await prisma.vote.upsert({
      where: { roundId_participantId: { roundId: round.id, participantId: participant.id } },
      create: { roundId: round.id, participantId: participant.id, value },
      update: { value },
    });
    await maybeAutoReveal(room.id, round.id);
  }

  await bumpAndPublish(room.id, slug);
  return json(await getRoomState(slug, viewerId(request)));
});

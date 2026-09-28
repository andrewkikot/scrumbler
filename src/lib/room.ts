import { publish } from './bus';
import { prisma } from './db';
import { resolveDeck, type DeckKey } from './decks';
import { secretEquals } from './secret';
import { computeStats } from './stats';
import { ONLINE_WINDOW_MS, type RoomState } from './types';

/** Cheap single-column read used by the SSE loop on every poll tick. */
export async function getRoomVersion(slug: string): Promise<number | null> {
  const row = await prisma.room.findUnique({ where: { slug }, select: { version: true } });
  return row?.version ?? null;
}

export async function findRoom(slug: string) {
  return prisma.room.findUnique({ where: { slug } });
}

/** Does this request carry the room's admin capability token? */
export function isAdmin(request: Request, adminToken: string): boolean {
  return secretEquals(request.headers.get('x-admin-token'), adminToken);
}

/**
 * Bump the room's version counter and wake any local SSE streams.
 * Every mutating route must end with this — it is what makes clients update.
 */
export async function bumpAndPublish(roomId: string, slug: string): Promise<void> {
  await prisma.room.update({ where: { id: roomId }, data: { version: { increment: 1 } } });
  publish(slug);
}

/** The current round is simply the highest-numbered one; created on demand. */
export async function currentRound(roomId: string) {
  const existing = await prisma.round.findFirst({ where: { roomId }, orderBy: { number: 'desc' } });
  if (existing) return existing;
  return prisma.round.create({ data: { roomId, number: 1 } });
}

/**
 * Everything a client needs to render the room, in one round-trip.
 *
 * `viewerClientId` is how you get to see your own card before the reveal while
 * everyone else still sees a face-down back. Nobody else’s value is included
 * until the round is revealed, and clientIds never leave the server.
 */
export async function getRoomState(
  slug: string,
  viewerClientId?: string | null,
): Promise<RoomState | null> {
  const room = await prisma.room.findUnique({
    where: { slug },
    include: {
      participants: { orderBy: { createdAt: 'asc' } },
      rounds: { orderBy: { number: 'desc' }, take: 1, include: { votes: true } },
      wheelEntries: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
      spins: { orderBy: { createdAt: 'desc' }, take: 8 },
    },
  });
  if (!room) return null;

  const round = room.rounds[0];
  const deck = resolveDeck(room.deckKey, room.customDeck);
  const now = Date.now();
  const voteByParticipant = new Map((round?.votes ?? []).map((v) => [v.participantId, v]));

  const participants = room.participants.map((p) => ({
    id: p.id,
    name: p.name,
    isSpectator: p.isSpectator,
    online: now - p.lastSeenAt.getTime() < ONLINE_WINDOW_MS,
    hasVoted: voteByParticipant.has(p.id),
    value: round?.revealed ? (voteByParticipant.get(p.id)?.value ?? null) : null,
  }));

  const eligible = participants.filter(
    (p) => p.online && (!p.isSpectator || room.allowSpectatorVote),
  ).length;

  const viewer = viewerClientId
    ? room.participants.find((p) => p.clientId === viewerClientId)
    : undefined;

  const [latestSpin] = room.spins;

  return {
    slug: room.slug,
    name: room.name,
    version: room.version,
    createdAt: room.createdAt.toISOString(),
    settings: {
      deckKey: room.deckKey as DeckKey,
      customDeck: room.customDeck,
      deck,
      autoReveal: room.autoReveal,
      allowRevote: room.allowRevote,
      showAverage: room.showAverage,
      allowSpectatorVote: room.allowSpectatorVote,
      allowAnyoneToSpin: room.allowAnyoneToSpin,
      dropWinnerAfterSpin: room.dropWinnerAfterSpin,
    },
    round: {
      id: round?.id ?? '',
      number: round?.number ?? 1,
      topic: round?.topic ?? null,
      revealed: round?.revealed ?? false,
    },
    participants,
    myVote: viewer ? (voteByParticipant.get(viewer.id)?.value ?? null) : null,
    stats: round?.revealed ? computeStats(round.votes, eligible, deck) : null,
    wheel: room.wheelEntries.map((w) => ({ id: w.id, label: w.label, active: w.active })),
    spin: latestSpin
      ? { id: latestSpin.id, winnerLabel: latestSpin.winnerLabel, startedAt: latestSpin.createdAt.getTime() }
      : null,
    history: room.spins.map((s) => ({
      id: s.id,
      winnerLabel: s.winnerLabel,
      createdAt: s.createdAt.toISOString(),
    })),
  };
}

/**
 * Reveal the round when every eligible, currently-online participant has voted.
 * Returns true when it flipped the round, so the caller knows to re-read state.
 */
export async function maybeAutoReveal(roomId: string, roundId: string): Promise<boolean> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { autoReveal: true, allowSpectatorVote: true },
  });
  if (!room?.autoReveal) return false;

  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  const eligible = await prisma.participant.count({
    where: {
      roomId,
      lastSeenAt: { gte: cutoff },
      ...(room.allowSpectatorVote ? {} : { isSpectator: false }),
    },
  });
  if (eligible === 0) return false;

  const voted = await prisma.vote.count({ where: { roundId } });
  if (voted < eligible) return false;

  await prisma.round.update({
    where: { id: roundId },
    data: { revealed: true, revealedAt: new Date() },
  });
  return true;
}

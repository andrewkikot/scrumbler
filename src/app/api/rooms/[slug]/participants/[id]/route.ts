import { z } from 'zod';
import { fail, forbidden, json, notFound, readBody, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
import { bumpAndPublish, findRoom, getRoomState, isAdmin } from '@/lib/room';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ slug: string; id: string }> };

const UpdateParticipant = z.object({
  /** Proves "this is me" for a non-admin editing their own row. */
  clientId: z.string().min(8).max(64).optional(),
  name: z.string().trim().min(1).max(32).optional(),
  isSpectator: z.boolean().optional(),
});

/** PATCH — rename yourself / toggle spectator. Admins may edit anyone. */
export const PATCH = route(async (request: Request, { params }: Ctx) => {
  const { slug, id } = await params;
  const room = await findRoom(slug);
  if (!room) return notFound();

  const body = await readBody(request, UpdateParticipant);
  if (!body.ok) return body.response;
  const { clientId, ...data } = body.data;

  const participant = await prisma.participant.findFirst({ where: { id, roomId: room.id } });
  if (!participant) return fail(404, 'Participant not found');

  const allowed = isAdmin(request, room.adminToken) || participant.clientId === clientId;
  if (!allowed) return forbidden('You can only change your own seat');

  // Dropping the spectator flag mid-round must not strand a stale vote.
  if (data.isSpectator === true && !room.allowSpectatorVote) {
    await prisma.vote.deleteMany({ where: { participantId: participant.id } });
  }

  await prisma.participant.update({ where: { id: participant.id }, data });
  await bumpAndPublish(room.id, slug);
  return json(await getRoomState(slug, viewerId(request)));
});

/** DELETE — admin kicks someone, or a player leaves (tab close / Leave button). */
export const DELETE = route(async (request: Request, { params }: Ctx) => {
  const { slug, id } = await params;
  const room = await findRoom(slug);
  if (!room) return notFound();

  const participant = await prisma.participant.findFirst({ where: { id, roomId: room.id } });
  if (!participant) return json({ deleted: true });

  const url = new URL(request.url);
  const clientId = url.searchParams.get('clientId');
  const allowed = isAdmin(request, room.adminToken) || participant.clientId === clientId;
  if (!allowed) return forbidden('You can only remove yourself');

  await prisma.participant.delete({ where: { id: participant.id } });
  await bumpAndPublish(room.id, slug);
  return json({ deleted: true, state: await getRoomState(slug, viewerId(request)) });
});

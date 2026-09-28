import { z } from 'zod';
import { forbidden, json, notFound, readBody, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
import { DECK_KEYS } from '@/lib/decks';
import { bumpAndPublish, findRoom, getRoomState, isAdmin } from '@/lib/room';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/rooms/:slug — full snapshot (also the SSE fallback for clients). */
export const GET = route(async (request: Request, { params }: Ctx) => {
  const { slug } = await params;
  const state = await getRoomState(slug, viewerId(request));
  if (!state) return notFound();
  return json(state);
});

const UpdateRoom = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  deckKey: z.enum(DECK_KEYS as [string, ...string[]]).optional(),
  customDeck: z.string().max(200).nullable().optional(),
  autoReveal: z.boolean().optional(),
  allowRevote: z.boolean().optional(),
  showAverage: z.boolean().optional(),
  allowSpectatorVote: z.boolean().optional(),
  allowAnyoneToSpin: z.boolean().optional(),
  dropWinnerAfterSpin: z.boolean().optional(),
});

/** PATCH /api/rooms/:slug — admin-only rename + poker and wheel settings. */
export const PATCH = route(async (request: Request, { params }: Ctx) => {
  const { slug } = await params;
  const room = await findRoom(slug);
  if (!room) return notFound();
  if (!isAdmin(request, room.adminToken)) return forbidden();

  const body = await readBody(request, UpdateRoom);
  if (!body.ok) return body.response;

  await prisma.room.update({ where: { id: room.id }, data: body.data });
  await bumpAndPublish(room.id, slug);

  return json(await getRoomState(slug, viewerId(request)));
});

/** DELETE /api/rooms/:slug — admin-only. Cascades to everything in the room. */
export const DELETE = route(async (request: Request, { params }: Ctx) => {
  const { slug } = await params;
  const room = await findRoom(slug);
  if (!room) return notFound();
  if (!isAdmin(request, room.adminToken)) return forbidden();

  await prisma.room.delete({ where: { id: room.id } });
  return json({ deleted: true });
});

import { z } from 'zod';
import { fail, forbidden, json, notFound, readBody, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
import { bumpAndPublish, findRoom, getRoomState, isAdmin } from '@/lib/room';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ slug: string; id: string }> };

const UpdateEntry = z.object({
  label: z.string().trim().min(1).max(40).optional(),
  /** Benched instead of deleted — keeps the name around for tomorrow. */
  active: z.boolean().optional(),
});

/** PATCH /api/rooms/:slug/wheel/:id — admin renames or benches an entry. */
export const PATCH = route(async (request: Request, { params }: Ctx) => {
  const { slug, id } = await params;
  const room = await findRoom(slug);
  if (!room) return notFound();
  if (!isAdmin(request, room.adminToken)) return forbidden();

  const body = await readBody(request, UpdateEntry);
  if (!body.ok) return body.response;

  const entry = await prisma.wheelEntry.findFirst({ where: { id, roomId: room.id } });
  if (!entry) return fail(404, 'Wheel entry not found');

  if (body.data.label && body.data.label !== entry.label) {
    const clash = await prisma.wheelEntry.findFirst({
      where: { roomId: room.id, label: body.data.label },
      select: { id: true },
    });
    if (clash) return fail(409, 'That name is already on the wheel');
  }

  await prisma.wheelEntry.update({ where: { id: entry.id }, data: body.data });
  await bumpAndPublish(room.id, slug);
  return json(await getRoomState(slug, viewerId(request)));
});

/** DELETE /api/rooms/:slug/wheel/:id — admin removes a name entirely. */
export const DELETE = route(async (request: Request, { params }: Ctx) => {
  const { slug, id } = await params;
  const room = await findRoom(slug);
  if (!room) return notFound();
  if (!isAdmin(request, room.adminToken)) return forbidden();

  await prisma.wheelEntry.deleteMany({ where: { id, roomId: room.id } });
  await bumpAndPublish(room.id, slug);
  return json(await getRoomState(slug, viewerId(request)));
});

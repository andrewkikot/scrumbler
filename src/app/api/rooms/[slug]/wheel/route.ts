import { z } from 'zod';
import { forbidden, json, notFound, readBody, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
import { bumpAndPublish, findRoom, getRoomState, isAdmin } from '@/lib/room';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ slug: string }> };

const AddEntries = z.object({
  /** Explicit names to add. */
  labels: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
  /** Pull everyone currently in the room onto the wheel. */
  syncFromParticipants: z.boolean().optional(),
});

/**
 * POST /api/rooms/:slug/wheel — admin adds names.
 *
 * Wheel entries are intentionally decoupled from Participant: a teammate who is
 * on holiday, or who never opens the room, can still be in (or out of) the
 * rotation.
 */
export const POST = route(async (request: Request, { params }: Ctx) => {
  const { slug } = await params;
  const room = await findRoom(slug);
  if (!room) return notFound();
  if (!isAdmin(request, room.adminToken)) return forbidden();

  const body = await readBody(request, AddEntries);
  if (!body.ok) return body.response;

  const labels = [...(body.data.labels ?? [])];
  if (body.data.syncFromParticipants) {
    const people = await prisma.participant.findMany({
      where: { roomId: room.id, isSpectator: false },
      select: { name: true },
    });
    labels.push(...people.map((p) => p.name));
  }

  const existing = await prisma.wheelEntry.findMany({
    where: { roomId: room.id },
    select: { label: true, position: true },
  });
  const taken = new Set(existing.map((e) => e.label));
  let position = existing.reduce((max, e) => Math.max(max, e.position), -1) + 1;

  const fresh = [...new Set(labels.map((l) => l.trim()).filter(Boolean))].filter((l) => !taken.has(l));

  if (fresh.length) {
    await prisma.wheelEntry.createMany({
      data: fresh.map((label) => ({ roomId: room.id, label, position: position++ })),
    });
    await bumpAndPublish(room.id, slug);
  }

  return json({ added: fresh.length, state: await getRoomState(slug, viewerId(request)) });
});

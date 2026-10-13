import { z } from 'zod';
import { fail, forbidden, json, notFound, readBody, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
import { MAX_WHEEL_ENTRIES_PER_ROOM } from '@/lib/limits';
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

  // Fifty names a request, but requests repeat. Past this the wedges are
  // slivers anyway — no rotation is a hundred people long.
  if (existing.length + fresh.length > MAX_WHEEL_ENTRIES_PER_ROOM) {
    return fail(
      409,
      `The wheel holds ${MAX_WHEEL_ENTRIES_PER_ROOM} names at most — it has ${existing.length}. Remove some first.`,
    );
  }

  if (fresh.length) {
    await prisma.wheelEntry.createMany({
      data: fresh.map((label) => ({ roomId: room.id, label, position: position++ })),
    });
    await bumpAndPublish(room.id, slug);
  }

  return json({ added: fresh.length, state: await getRoomState(slug, viewerId(request)) });
});

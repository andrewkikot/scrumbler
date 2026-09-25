import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { fail, forbidden, json, notFound, readBody, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
import { bumpAndPublish, findRoom, getRoomState, isAdmin } from '@/lib/room';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ slug: string }> };

const SpinRequest = z.object({
  /** Skip whoever led last time, when there is someone else to pick. */
  avoidRepeat: z.boolean().optional(),
});

/**
 * POST /api/rooms/:slug/spin — the draw happens *here*, not in the browser.
 *
 * The server picks the winner and records the spin; every client then animates
 * toward the same stored label from the same `createdAt` timestamp, so nobody
 * can see a different result (or a different landing frame) than anyone else.
 */
export const POST = route(async (request: Request, { params }: Ctx) => {
  const { slug } = await params;
  const room = await findRoom(slug);
  if (!room) return notFound();
  if (!isAdmin(request, room.adminToken)) return forbidden();

  const body = await readBody(request, SpinRequest.optional().default({}));
  if (!body.ok) return body.response;

  const entries = await prisma.wheelEntry.findMany({
    where: { roomId: room.id, active: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
  if (entries.length === 0) return fail(409, 'Add at least one name to the wheel first');

  let pool = entries;
  if (body.data?.avoidRepeat && entries.length > 1) {
    const last = await prisma.spin.findFirst({
      where: { roomId: room.id },
      orderBy: { createdAt: 'desc' },
      select: { winnerLabel: true },
    });
    const filtered = entries.filter((e) => e.label !== last?.winnerLabel);
    if (filtered.length) pool = filtered;
  }

  // crypto.randomInt is uniform — Math.random() is not, and this decides who
  // runs the meeting.
  const winner = pool[randomInt(pool.length)];

  await prisma.spin.create({ data: { roomId: room.id, winnerLabel: winner.label } });
  await bumpAndPublish(room.id, slug);

  return json(await getRoomState(slug, viewerId(request)));
});

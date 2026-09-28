import { randomInt } from 'node:crypto';
import { fail, forbidden, json, notFound, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
import { bumpAndPublish, findRoom, getRoomState, isAdmin } from '@/lib/room';
import { SPIN_DURATION_MS } from '@/lib/types';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * POST /api/rooms/:slug/spin — the draw happens *here*, not in the browser.
 *
 * The server picks the winner and records the spin; every client then animates
 * toward the same stored label from the same `createdAt` timestamp, so nobody
 * can see a different result (or a different landing frame) than anyone else.
 *
 * Who may press it is the room's `allowAnyoneToSpin` setting. Opening the wheel
 * to the room does not open the rest of it: adding and dropping names stays
 * with the admin, and so does the setting itself.
 */
export const POST = route(async (request: Request, { params }: Ctx) => {
  const { slug } = await params;
  const room = await findRoom(slug);
  if (!room) return notFound();
  if (!room.allowAnyoneToSpin && !isAdmin(request, room.adminToken)) return forbidden();

  const last = await prisma.spin.findFirst({
    where: { roomId: room.id },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  /*
    A spin already in flight is not one you may interrupt. The button is
    disabled client-side while the wheel turns, but with a whole room able to
    press it that has to be enforced somewhere real: two spins seconds apart
    would send every wheel jumping mid-flight to a second winner, and the first
    result would be gone with no way back to it.
  */
  if (last && Date.now() - last.createdAt.getTime() < SPIN_DURATION_MS) {
    return fail(409, 'The wheel is still turning');
  }

  const entries = await prisma.wheelEntry.findMany({
    where: { roomId: room.id, active: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
  if (entries.length === 0) return fail(409, 'Add at least one name to the wheel first');

  // crypto.randomInt is uniform — Math.random() is not, and this decides who
  // runs the meeting.
  //
  // Every active name is in the draw, every time. Skipping the last winner used
  // to be an option here; `dropWinnerAfterSpin` does that job properly, by
  // taking them off the wheel rather than quietly weighting one roll.
  const winner = entries[randomInt(entries.length)];

  await prisma.spin.create({ data: { roomId: room.id, winnerLabel: winner.label } });
  await bumpAndPublish(room.id, slug);

  return json(await getRoomState(slug, viewerId(request)));
});

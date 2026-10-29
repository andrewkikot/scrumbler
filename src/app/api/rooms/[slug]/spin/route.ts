import { randomInt } from 'node:crypto';
import { fail, forbidden, json, notFound, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
import { bumpAndPublish, findRoom, getRoomState, isAdmin } from '@/lib/room';
import { drawPool } from '@/lib/rotation';
import { SPIN_DURATION_MS, SPIN_HISTORY_LIMIT } from '@/lib/types';

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

  /*
    Every active name is in the draw, with one exception, and it lasts exactly
    one spin: the name that closed the last rotation. The refill puts everybody
    back on the wheel including them, so without this they could be drawn again
    immediately and run two dailies in a row — which is the whole thing a
    rotation is for. The roster says so out loud rather than leaving it a quiet
    weighting nobody can see: that name is marked in the panel as skipped for
    this draw, and is in the running again for the next.

    Skipping a *standing* last winner is still not on offer. This applies only
    across the seam of a rotation, never draw to draw.
  */
  const pool = drawPool(entries, room.wheelHeldOverLabel);

  // crypto.randomInt is uniform — Math.random() is not, and this decides who
  // runs the meeting.
  const winner = pool[randomInt(pool.length)];

  await prisma.spin.create({ data: { roomId: room.id, winnerLabel: winner.label } });

  // Trim the history to what "Recent draws" can show. Spins are only ever
  // added here, so pruning here keeps every room bounded — a daily wheel
  // would otherwise grow a row a day for as long as the room lives.
  const stale = await prisma.spin.findMany({
    where: { roomId: room.id },
    orderBy: { createdAt: 'desc' },
    skip: SPIN_HISTORY_LIMIT,
    select: { id: true },
  });
  if (stale.length) {
    await prisma.spin.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }

  // A hold is one draw long, and this was the draw — whether or not it had
  // anyone to skip. Clearing it unconditionally is what keeps it to one.
  if (room.wheelHeldOverLabel !== null) {
    await prisma.room.update({ where: { id: room.id }, data: { wheelHeldOverLabel: null } });
  }

  await bumpAndPublish(room.id, slug);

  return json(await getRoomState(slug, viewerId(request)));
});

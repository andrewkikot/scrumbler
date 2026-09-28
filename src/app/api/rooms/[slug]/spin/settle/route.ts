import { json, notFound, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
import { bumpAndPublish, findRoom, getRoomState } from '@/lib/room';
import { SPIN_DURATION_MS } from '@/lib/types';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * POST /api/rooms/:slug/spin/settle — take the winner off the wheel, once the
 * wheel has actually stopped on them.
 *
 * Why this is not part of the spin route: the winner has to stay on the wheel
 * for the whole animation. Deactivating the entry at spin time publishes a
 * roster without them, and the client's layout effect — which runs before the
 * one that starts the animation — would drop the wedge out before the wheel
 * ever began turning. Only a client knows when the show is over, so a client
 * has to ask for this.
 *
 * Why it needs no admin token, when every other wheel route does: it takes no
 * arguments. It cannot name a victim, only agree with a draw the server itself
 * made, and only after that draw has finished playing. `dropWinnerAfterSpin`
 * is the room's standing instruction to do it, and the admin owns that setting;
 * this route is the hand that carries it out, not a second decision.
 *
 * Idempotent, and deliberately so: every client watching the wheel calls it
 * when the wheel stops, and all but the first find the work already done.
 */
export const POST = route(async (request: Request, { params }: Ctx) => {
  const { slug } = await params;
  const room = await findRoom(slug);
  if (!room) return notFound();

  const state = () => getRoomState(slug, viewerId(request));

  // Not an error: a client that was mid-animation when the admin turned the
  // setting off should quietly do nothing, not shout about it.
  if (!room.dropWinnerAfterSpin) return json(await state());

  const spin = await prisma.spin.findFirst({
    where: { roomId: room.id },
    orderBy: { createdAt: 'desc' },
    select: { winnerLabel: true, createdAt: true },
  });
  if (!spin) return json(await state());

  // The clock is the whole authorisation. Without it, this route would bench
  // whoever the wheel is *currently* flying towards, on demand.
  if (Date.now() - spin.createdAt.getTime() < SPIN_DURATION_MS) return json(await state());

  const entry = await prisma.wheelEntry.findFirst({
    where: { roomId: room.id, label: spin.winnerLabel, active: true },
    select: { id: true },
  });
  // Already benched — by the first client to get here, or by the admin's hand.
  if (!entry) return json(await state());

  await prisma.wheelEntry.update({ where: { id: entry.id }, data: { active: false } });
  await bumpAndPublish(room.id, slug);
  return json(await state());
});

import { json, notFound, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
import { bumpAndPublish, findRoom, getRoomState } from '@/lib/room';
import { settleRotation } from '@/lib/rotation';
import { SPIN_DURATION_MS } from '@/lib/types';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * POST /api/rooms/:slug/spin/settle — settle the rotation, once the wheel has
 * actually stopped: the winner comes off, and if that was the last name on the
 * wheel the whole roster goes back on for the next rotation — that winner
 * included. Who the next draw skips is recorded for the spin route to serve.
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
    select: { id: true, winnerLabel: true, createdAt: true },
  });
  if (!spin) return json(await state());

  // The clock is the whole authorisation. Without it, this route would bench
  // whoever the wheel is *currently* flying towards, on demand.
  if (Date.now() - spin.createdAt.getTime() < SPIN_DURATION_MS) return json(await state());

  /*
    Already settled — by the first client to get here, and every other one is
    this. It has to be recorded rather than read off the roster: a draw that
    closed a rotation put its winner straight back on the wheel, so "is the
    winner still on?" — which used to be the whole check — now says yes to a
    draw that has been settled and a draw that has not alike, and the second
    client through would drop that winner off the fresh wheel.
  */
  if (room.wheelSettledSpinId === spin.id) return json(await state());

  const roster = await prisma.wheelEntry.findMany({
    where: { roomId: room.id },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, label: true, active: true },
  });

  const { activate, deactivate, heldOver } = settleRotation(roster, spin.winnerLabel);

  /*
    One transaction, because a half-applied rotation is a wheel the room cannot
    reason about: the winner off but nobody put back is a dead wheel, and a
    roster back without the hold recorded loses the one guarantee the refill
    exists to make.

    Note what the client sees when a rotation closes: the roster goes from one
    name straight to a full wheel, which is not a single name leaving, so the
    wheel redraws rather than playing the wedge-drop. That is the right picture
    anyway — the wheel does not empty, it fills.
  */
  await prisma.$transaction([
    ...(deactivate.length
      ? [
          prisma.wheelEntry.updateMany({
            where: { id: { in: deactivate }, roomId: room.id },
            data: { active: false },
          }),
        ]
      : []),
    ...(activate.length
      ? [
          prisma.wheelEntry.updateMany({
            where: { id: { in: activate }, roomId: room.id },
            data: { active: true },
          }),
        ]
      : []),
    prisma.room.update({
      where: { id: room.id },
      data: { wheelHeldOverLabel: heldOver, wheelSettledSpinId: spin.id },
    }),
  ]);

  await bumpAndPublish(room.id, slug);
  return json(await state());
});

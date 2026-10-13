import { z } from 'zod';
import { fail, forbidden, json, notFound, readBody, route, viewerId } from '@/lib/api';
import { prisma } from '@/lib/db';
import { bumpAndPublish, findRoom, getRoomState, isAdmin } from '@/lib/room';
import { applyTimerAction, TIMER_LABEL_MAX, TIMER_MAX_MS } from '@/lib/timer';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ slug: string }> };

const Duration = z.number().int().positive().max(TIMER_MAX_MS);

const TimerBody = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    durationMs: Duration,
    label: z.string().max(TIMER_LABEL_MAX).nullable().optional(),
  }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('add'), durationMs: Duration.optional() }),
  z.object({ action: z.literal('stop') }),
]);

/**
 * POST /api/rooms/:slug/timer — the room's one shared discussion timer.
 *
 * The server only records when the timer ends (or what was left when it was
 * paused); every client counts down locally from that, so a running timer
 * costs nothing — no ticks are written or pushed. Who may touch it is the
 * room's `allowAnyoneToTime`, mirroring `allowAnyoneToSpin`.
 */
export const POST = route(async (request: Request, { params }: Ctx) => {
  const { slug } = await params;
  const room = await findRoom(slug);
  if (!room) return notFound();
  if (!room.allowAnyoneToTime && !isAdmin(request, room.adminToken)) return forbidden();

  const body = await readBody(request, TimerBody);
  if (!body.ok) return body.response;

  const next = applyTimerAction(room, body.data, Date.now());
  if (!next.ok) return fail(409, next.error);

  await prisma.room.update({ where: { id: room.id }, data: next.data });
  await bumpAndPublish(room.id, slug);

  return json(await getRoomState(slug, viewerId(request)));
});

import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { badRequest, json, readBody, route } from '@/lib/api';
import { publish } from '@/lib/bus';
import { prisma } from '@/lib/db';
import { requireSuperAdmin } from '@/lib/superadmin';
import { ADMIN_DELETE_LIMIT, type AdminRoomList, type AdminRoomRow } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 200;
const DAY_MS = 86_400_000;

const ListQuery = z.object({
  /** Substring match on name or slug. */
  q: z.string().trim().max(60).optional(),
  /** Only rooms untouched for at least this many days. */
  idleDays: z.coerce.number().int().min(0).max(3650).optional(),
  sort: z.enum(['activity', 'created', 'name']).default('activity'),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const ORDER_BY: Record<z.infer<typeof ListQuery>['sort'], (dir: 'asc' | 'desc') => Prisma.RoomOrderByWithRelationInput> = {
  activity: (dir) => ({ updatedAt: dir }),
  created: (dir) => ({ createdAt: dir }),
  name: (dir) => ({ name: dir }),
};

/**
 * GET /api/admin/rooms — every room on this deployment, newest activity first.
 *
 * `updatedAt` is the useful column here: `Room.version` is bumped by every
 * mutation and `@updatedAt` rides along with it, so a room's `updatedAt` is the
 * last time anyone actually did something in it. Heartbeats deliberately do not
 * bump the version (see the heartbeat route), which is why `lastSeenAt` is
 * reported separately — a room can have been watched more recently than it was
 * used.
 */
export const GET = route(async (request: Request) => {
  const denied = requireSuperAdmin(request);
  if (denied) return denied;

  const parsed = ListQuery.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return badRequest(first ? `${first.path.join('.')}: ${first.message}` : 'Invalid query');
  }
  const { q, idleDays, sort, order, limit, offset } = parsed.data;

  const where: Prisma.RoomWhereInput = {
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(idleDays !== undefined
      ? { updatedAt: { lt: new Date(Date.now() - idleDays * DAY_MS) } }
      : {}),
  };

  const [total, rooms] = await Promise.all([
    prisma.room.count({ where }),
    prisma.room.findMany({
      where,
      orderBy: ORDER_BY[sort](order),
      take: limit,
      skip: offset,
      select: {
        id: true,
        slug: true,
        name: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { participants: true, rounds: true, wheelEntries: true, spins: true } },
      },
    }),
  ]);

  // One grouped read for the whole page rather than a per-room query.
  const seen = rooms.length
    ? await prisma.participant.groupBy({
        by: ['roomId'],
        where: { roomId: { in: rooms.map((room) => room.id) } },
        _max: { lastSeenAt: true },
      })
    : [];
  const lastSeen = new Map(seen.map((row) => [row.roomId, row._max.lastSeenAt]));

  const payload: AdminRoomList = {
    rooms: rooms.map(
      (room): AdminRoomRow => ({
        slug: room.slug,
        name: room.name,
        version: room.version,
        createdAt: room.createdAt.toISOString(),
        updatedAt: room.updatedAt.toISOString(),
        lastSeenAt: lastSeen.get(room.id)?.toISOString() ?? null,
        counts: {
          participants: room._count.participants,
          rounds: room._count.rounds,
          wheelEntries: room._count.wheelEntries,
          spins: room._count.spins,
        },
      }),
    ),
    total,
    limit,
    offset,
    now: new Date().toISOString(),
  };

  return json(payload);
});

const DeleteRooms = z.object({
  slugs: z.array(z.string().trim().min(1).max(64)).min(1).max(ADMIN_DELETE_LIMIT),
});

/**
 * DELETE /api/admin/rooms — delete the named rooms and everything inside them.
 *
 * Takes explicit slugs rather than "everything older than N days" on purpose:
 * the age filter belongs to the list you looked at, so the operator deletes the
 * rooms they actually read, not whatever the cutoff happens to catch now.
 */
export const DELETE = route(async (request: Request) => {
  const denied = requireSuperAdmin(request);
  if (denied) return denied;

  const body = await readBody(request, DeleteRooms);
  if (!body.ok) return body.response;

  const slugs = [...new Set(body.data.slugs)];
  const { count } = await prisma.room.deleteMany({ where: { slug: { in: slugs } } });

  // Any tab still watching one of these gets a `gone` frame on its next tick
  // instead of hanging on a room that no longer exists.
  for (const slug of slugs) publish(slug);

  console.warn(`[scrumbler] super-admin deleted ${count} room(s): ${slugs.join(', ')}`);
  return json({ deleted: count, slugs });
});

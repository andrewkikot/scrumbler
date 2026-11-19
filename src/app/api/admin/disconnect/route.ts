import { z } from 'zod';
import { json, readBody, route } from '@/lib/api';
import { disconnectRooms } from '@/lib/room';
import { requireSuperAdmin } from '@/lib/superadmin';
import { ADMIN_DELETE_LIMIT } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Disconnect = z.object({
  /** The rooms to disconnect; leave it out to disconnect every room. */
  slugs: z.array(z.string().trim().min(1).max(64)).min(1).max(ADMIN_DELETE_LIMIT).optional(),
});

/**
 * POST /api/admin/disconnect — stop every open tab in the named rooms, or in
 * all rooms.
 *
 * An open tab costs server time whether or not anyone is looking at it: the
 * stream holds a function open and the heartbeat wakes the database. This
 * closes both. Nothing is deleted — seats, votes and settings stay — and anyone
 * actually in the room clicks Reconnect and carries on. Tabs opened afterwards
 * are not affected.
 */
export const POST = route(async (request: Request) => {
  const denied = requireSuperAdmin(request);
  if (denied) return denied;

  const body = await readBody(request, Disconnect);
  if (!body.ok) return body.response;

  const slugs = body.data.slugs ? [...new Set(body.data.slugs)] : null;
  const touched = await disconnectRooms(slugs);

  console.warn(
    `[scrumbler] super-admin disconnected ${touched.length} room(s)` +
      (slugs ? `: ${touched.join(', ')}` : ' (all rooms)'),
  );
  return json({ disconnected: touched.length });
});

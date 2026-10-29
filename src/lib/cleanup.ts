import { prisma } from './db';
import { DAY_MS, UNUSED_ROOM_DAYS } from './limits';
import { dropAbsent } from './room';

/** The idle-room sweep is opt-in, and never shorter than this. */
export const MIN_IDLE_ROOM_DAYS = 30;

/**
 * How long a room may sit untouched before the cleanup deletes it, or null to
 * keep rooms forever — the default, because permanent URLs are the premise.
 * Set SCRUMBLER_ROOM_IDLE_DAYS (or ROOM_IDLE_DAYS) to opt in.
 */
export function idleRoomDays(env: Record<string, string | undefined> = process.env): number | null {
  const raw = (env.SCRUMBLER_ROOM_IDLE_DAYS ?? env.ROOM_IDLE_DAYS)?.trim();
  if (!raw) return null;
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0) return null;
  return Math.max(MIN_IDLE_ROOM_DAYS, Math.floor(days));
}

export type CleanupReport = {
  unusedRooms: number;
  idleRooms: number;
  staleParticipants: number;
  rateLimitRows: number;
  idleRoomDays: number | null;
};

/**
 * Delete what nobody will miss. Run daily by Vercel Cron; safe to run any time
 * and as often as you like — every step is a bounded, idempotent deleteMany.
 *
 *   - rooms never used (version 0) after a week — where a flood ends up;
 *   - seats nobody has heartbeated from in ABSENT_DROP_MS, by the same rule
 *     a room in use sweeps its own with (`dropAbsent`) — this catches the
 *     rooms everybody has left;
 *   - rooms idle past SCRUMBLER_ROOM_IDLE_DAYS, only if that is set;
 *   - rate-limit windows that closed more than a day ago.
 */
export async function runCleanup(now = Date.now()): Promise<CleanupReport> {
  const ago = (days: number) => new Date(now - days * DAY_MS);
  const idleDays = idleRoomDays();

  const unused = await prisma.room.deleteMany({
    where: { version: 0, createdAt: { lt: ago(UNUSED_ROOM_DAYS) } },
  });

  const idle = idleDays
    ? await prisma.room.deleteMany({ where: { updatedAt: { lt: ago(idleDays) } } })
    : { count: 0 };

  const staleParticipants = await dropAbsent(undefined, now);

  const windows = await prisma.rateLimit.deleteMany({ where: { windowStart: { lt: ago(1) } } });

  return {
    unusedRooms: unused.count,
    idleRooms: idle.count,
    staleParticipants,
    rateLimitRows: windows.count,
    idleRoomDays: idleDays,
  };
}

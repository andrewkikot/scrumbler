import { createHash } from 'node:crypto';
import { prisma } from './db';

/**
 * Everything that stops a script from filling the database.
 *
 * Nobody signs up, so the public write routes that create rows — a room, a
 * seat — are open to anyone with curl. Each limit below is set well above what
 * a real team does and far below what a loop can, so a team never sees one:
 *
 *   1. a global brake on new rooms per hour, whoever is asking;
 *   2. per-IP rate limits on creating rooms and taking seats;
 *   3. per-room caps, so one room cannot be stuffed even slowly — and a seat
 *      nobody heartbeats from leaves after ABSENT_DROP_MS (see `dropAbsent`);
 *   4. a daily cleanup (see /api/cron/cleanup) for what gets through anyway.
 */

/** Rooms the whole deployment will create in an hour before refusing more. */
export const ROOMS_PER_HOUR_GLOBAL = 200;

/** Per-IP windows. Generous: an office shares one address at standup time. */
export const RATE_LIMITS = {
  createRoom: { max: 20, windowMs: 60 * 60_000 },
  join: { max: 120, windowMs: 10 * 60_000 },
} as const;

export const MAX_PARTICIPANTS_PER_ROOM = 50;
export const MAX_WHEEL_ENTRIES_PER_ROOM = 100;

/**
 * A room nobody has done anything in (version 0) since it was created. A week,
 * not a day: a room made on Friday for Monday's standup is not spam.
 */
export const UNUSED_ROOM_DAYS = 7;

export const DAY_MS = 86_400_000;

/**
 * Who is asking, as far as rate limiting goes. On Vercel the platform sets
 * `x-forwarded-for` itself (a client-sent value is overwritten), so the first
 * entry is the real address. Locally there is no proxy and everyone is "local".
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'local';
}

/** The start of the fixed window `now` falls in. */
export const windowStartFor = (now: number, windowMs: number) => Math.floor(now / windowMs) * windowMs;

function tooMany(message: string, retryAfterMs: number): Response {
  return Response.json(
    { error: message },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) } },
  );
}

/**
 * Count this request against `bucket` for the caller's address. Returns null
 * when it may proceed, or the 429 to send back.
 *
 * One statement, so concurrent requests cannot both read "9" and both pass: the
 * upsert increments in place and hands back the new count. A row from an older
 * window is reset rather than added to.
 */
export async function rateLimit(
  request: Request,
  bucket: keyof typeof RATE_LIMITS,
): Promise<Response | null> {
  const { max, windowMs } = RATE_LIMITS[bucket];
  const now = Date.now();
  const windowStart = new Date(windowStartFor(now, windowMs));
  const ip = createHash('sha256').update(clientAddress(request)).digest('hex').slice(0, 32);
  const key = `${bucket}:${ip}`;

  const [row] = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" = EXCLUDED."windowStart"
                     THEN "RateLimit"."count" + 1 ELSE 1 END,
      "windowStart" = EXCLUDED."windowStart"
    RETURNING "count"`;

  if ((row?.count ?? 0) <= max) return null;
  return tooMany(
    'Too many requests from your network. Wait a little and try again.',
    windowStart.getTime() + windowMs - now,
  );
}

/**
 * The global brake: refuse a new room once the deployment has made
 * `ROOMS_PER_HOUR_GLOBAL` in the last hour, from anyone. Per-IP limits do not
 * stop a script with many addresses; this does, and real use never comes near.
 */
export async function roomCreationBrake(): Promise<Response | null> {
  const since = new Date(Date.now() - 60 * 60_000);
  const recent = await prisma.room.count({ where: { createdAt: { gte: since } } });
  if (recent < ROOMS_PER_HOUR_GLOBAL) return null;
  return tooMany('Scrumbler is creating a lot of rooms right now. Try again in a few minutes.', 5 * 60_000);
}

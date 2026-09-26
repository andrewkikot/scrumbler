/**
 * Resolves the database connection strings from whichever names the host
 * happens to use.
 *
 * Vercel's Neon integration prefixes its variables when the plain names are
 * already claimed — by another project, or by a team-wide shared variable — so
 * this deployment gets `SCRUMBLER_DATABASE_URL` rather than `DATABASE_URL`.
 *
 * The prefixed names are checked FIRST, deliberately. A team-level
 * `DATABASE_URL` belonging to a different project can be visible here too, and
 * silently connecting to the wrong database is far worse than failing to start.
 *
 * Dependency-free on purpose: both the app (src/lib/db.ts) and the Prisma CLI
 * config (prisma.config.ts) import it.
 */

/** Pooled connection, in priority order. Used by the running application. */
const POOLED_KEYS = [
  'SCRUMBLER_DATABASE_URL',
  'DATABASE_URL',
  'SCRUMBLER_POSTGRES_URL',
  'POSTGRES_URL',
  'SCRUMBLER_POSTGRES_PRISMA_URL',
  'POSTGRES_PRISMA_URL',
] as const;

/** Direct connection, in priority order. Used by Prisma Migrate. */
const DIRECT_KEYS = [
  'SCRUMBLER_DATABASE_URL_UNPOOLED',
  'DATABASE_URL_UNPOOLED',
  'SCRUMBLER_POSTGRES_URL_NON_POOLING',
  'POSTGRES_URL_NON_POOLING',
] as const;

function firstPresent(keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) return { key, value: value.trim() };
  }
  return null;
}

/** Which variable a value came from — handy in logs and error messages. */
export function databaseUrlSource(): string | null {
  return firstPresent(POOLED_KEYS)?.key ?? null;
}

/**
 * The connection the app runs on. Throws with the list of names it looked for,
 * because "DATABASE_URL is not set" is unhelpful when the real name is
 * prefixed.
 */
export function databaseUrl(): string {
  const found = firstPresent(POOLED_KEYS);
  if (found) return found.value;

  throw new Error(
    `No database connection string found. Set one of: ${POOLED_KEYS.join(', ')}. ` +
      'Locally, copy .env.example to .env and paste your Neon pooled connection string.',
  );
}

/**
 * The connection Prisma Migrate uses. Migrations take advisory locks, which
 * cannot travel through PgBouncer, so a direct (non-pooler) URL is strongly
 * preferred — but fall back to the pooled one rather than breaking
 * `prisma generate`, which needs no database at all.
 */
export function directDatabaseUrl(): string {
  return firstPresent(DIRECT_KEYS)?.value ?? firstPresent(POOLED_KEYS)?.value ?? '';
}

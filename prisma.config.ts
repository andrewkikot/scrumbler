import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { directDatabaseUrl } from './src/lib/env';

/**
 * Prisma 7 moved the connection URL out of schema.prisma.
 *
 * Migrations and introspection need a *direct* (unpooled) connection — Neon's
 * PgBouncer endpoint cannot run the advisory locks Prisma Migrate relies on.
 * The application itself uses the pooled `DATABASE_URL` through the Neon driver
 * adapter (see src/lib/db.ts).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Accepts prefixed names too (SCRUMBLER_DATABASE_URL_UNPOOLED), and falls
    // back to the pooled URL so `prisma generate` works with no database at all.
    url: directDatabaseUrl(),
  },
});

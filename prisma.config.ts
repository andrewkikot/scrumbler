import 'dotenv/config';
import { defineConfig } from 'prisma/config';

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
    // Fall back to the pooled URL so `prisma generate`/`validate` work without
    // a direct URL configured; migrations should still use the unpooled one.
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '',
  },
});

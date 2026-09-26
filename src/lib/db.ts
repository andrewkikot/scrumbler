import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';
import { databaseUrl } from './env';

// The Neon serverless driver talks WebSocket for pooled, transactional access.
// Node 22+ (Vercel's runtime) and Node 24 (local) both ship a global WebSocket,
// so we hand it over explicitly rather than depending on the `ws` package.
const globalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
if (globalWebSocket) {
  neonConfig.webSocketConstructor = globalWebSocket as typeof neonConfig.webSocketConstructor;
}

function createClient(): PrismaClient {
  // databaseUrl() throws a message naming every variable it checked, since the
  // deployed name may be prefixed (SCRUMBLER_DATABASE_URL).
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: databaseUrl() }) });
}

// Cached on globalThis so Next.js hot reloads (dev) and warm serverless
// instances (production) reuse one pool instead of opening a new one each time.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function client(): PrismaClient {
  globalForPrisma.prisma ??= createClient();
  return globalForPrisma.prisma;
}

/**
 * Connects on first use, not on import.
 *
 * `next build` imports every route module to analyse it, and there is no
 * database reachable at build time on Vercel — eager construction here would
 * fail the deploy before a single query ran.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const value = Reflect.get(client(), property) as unknown;
    return typeof value === 'function' ? value.bind(client()) : value;
  },
});

import { json, route } from '@/lib/api';
import { runCleanup } from '@/lib/cleanup';
import { secretEquals } from '@/lib/secret';
import { requireSuperAdmin } from '@/lib/superadmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/cleanup — the daily sweep (see `runCleanup`).
 *
 * Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET` — Vercel only
 * sends that header when a variable named exactly CRON_SECRET exists, so no
 * prefixed spelling here. The super-admin key also works, for running it by
 * hand (in its usual x-super-admin-key header). With neither configured,
 * nobody can trigger it.
 */
export const GET = route(async (request: Request) => {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const viaCron = Boolean(cronSecret) && secretEquals(bearer, cronSecret!);

  if (!viaCron) {
    const denied = requireSuperAdmin(request);
    if (denied) return denied;
  }

  const report = await runCleanup();
  console.log('[scrumbler] cleanup', report);
  return json(report);
});

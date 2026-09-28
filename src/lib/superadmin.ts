/**
 * The deployment-wide super-admin key.
 *
 * Every other privilege in Scrumbler is scoped to one room: whoever holds a
 * room's `adminToken` controls that room and nothing else. Housekeeping across
 * rooms — listing what exists, deleting what has gone quiet — needs something
 * wider, and there are no accounts to hang it on. So it is a single secret read
 * from the environment and checked on the server only; it never reaches a
 * bundle, and the console at /admin asks the operator to paste it.
 *
 * Prefixed names are checked FIRST for the same reason src/lib/env.ts does it:
 * on Vercel a plain, team-wide variable can belong to an entirely different
 * project.
 */

import { secretEquals } from './secret';

/** Header the key travels in. Deliberately not the per-room `x-admin-token`. */
export const SUPER_ADMIN_HEADER = 'x-super-admin-key';

const KEYS = ['SCRUMBLER_SUPER_ADMIN_KEY', 'SUPER_ADMIN_KEY'] as const;

/**
 * A short key is a guessable key, and these routes delete data irreversibly.
 * 32 characters of `openssl rand -hex 16` is the documented recipe; anything
 * shorter than this is refused outright rather than quietly accepted, because a
 * weak master key that appears to work is the worse failure.
 */
export const MIN_KEY_LENGTH = 24;

export type KeyStatus =
  | { ok: true; key: string }
  | { ok: false; status: number; message: string };

/** Resolve the configured key, or explain precisely what is wrong with it. */
export function superAdminKey(): KeyStatus {
  for (const name of KEYS) {
    const value = process.env[name]?.trim();
    if (!value) continue;
    if (value.length < MIN_KEY_LENGTH) {
      return {
        ok: false,
        status: 503,
        message: `${name} is too short: the super-admin key must be at least ${MIN_KEY_LENGTH} characters.`,
      };
    }
    return { ok: true, key: value };
  }

  return {
    ok: false,
    status: 503,
    message:
      `No super-admin key configured. Set ${KEYS[0]} (or ${KEYS[1]}) to a long random ` +
      'string — for example the output of `openssl rand -hex 16` — and redeploy.',
  };
}

export const isSuperAdminConfigured = (): boolean => superAdminKey().ok;

/**
 * Gate for every route under /api/admin.
 *
 * Returns `null` when the caller may proceed, or the Response to send back —
 * which reads as `const denied = requireSuperAdmin(request); if (denied) return denied;`
 * at the top of a handler.
 *
 * An unconfigured deployment answers 503 rather than 403: "you got the key
 * wrong" and "nobody set a key" are different problems, and the operator
 * staring at this page is the only one who ever sees either.
 */
export function requireSuperAdmin(request: Request): Response | null {
  const resolved = superAdminKey();
  if (!resolved.ok) {
    return Response.json({ error: resolved.message }, { status: resolved.status });
  }
  if (!secretEquals(request.headers.get(SUPER_ADMIN_HEADER), resolved.key)) {
    return Response.json({ error: 'Super-admin key required' }, { status: 403 });
  }
  return null;
}

/**
 * Comparing capability tokens.
 *
 * Dependency-free on purpose: both the per-room admin token (src/lib/room.ts)
 * and the deployment-wide super-admin key (src/lib/superadmin.ts) are checked
 * with it, and it is exercised directly by the tests.
 */

/**
 * Constant-time string comparison.
 *
 * A plain `===` returns as soon as two bytes differ, so the time it takes to
 * reject a guess reveals how much of the secret that guess got right. This
 * always walks the whole string instead.
 *
 * Length is compared up front and non-secretly: both secrets here are minted at
 * a fixed length by code we control, so their length is not a secret.
 */
export function secretEquals(provided: string | null | undefined, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

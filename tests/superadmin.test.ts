import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { secretEquals } from '../src/lib/secret';
import { MIN_KEY_LENGTH, requireSuperAdmin, superAdminKey } from '../src/lib/superadmin';

const KEYS = ['SCRUMBLER_SUPER_ADMIN_KEY', 'SUPER_ADMIN_KEY'];
const saved = new Map(KEYS.map((key) => [key, process.env[key]]));

/** A key that clears MIN_KEY_LENGTH, so length is never the thing under test. */
const GOOD = 'a'.repeat(MIN_KEY_LENGTH + 8);

function only(values: Record<string, string>) {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

const withKey = (key: string | null) =>
  new Request('http://localhost/api/admin/rooms', {
    headers: key === null ? {} : { 'x-super-admin-key': key },
  });

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('secretEquals', () => {
  it('accepts an exact match', () => {
    assert.equal(secretEquals('abc123', 'abc123'), true);
  });

  it('rejects a different value of the same length', () => {
    assert.equal(secretEquals('abc124', 'abc123'), false);
  });

  it('rejects a prefix, a longer guess, and nothing at all', () => {
    assert.equal(secretEquals('abc12', 'abc123'), false);
    assert.equal(secretEquals('abc1234', 'abc123'), false);
    assert.equal(secretEquals(null, 'abc123'), false);
    assert.equal(secretEquals('', 'abc123'), false);
  });

  it('never matches an empty expected secret', () => {
    // An unset token must not turn into "any request is admin".
    assert.equal(secretEquals('', ''), false);
  });
});

describe('super-admin key resolution', () => {
  it('prefers the prefixed name over the plain one', () => {
    only({ SUPER_ADMIN_KEY: `plain-${GOOD}`, SCRUMBLER_SUPER_ADMIN_KEY: `prefixed-${GOOD}` });
    assert.deepEqual(superAdminKey(), { ok: true, key: `prefixed-${GOOD}` });
  });

  it('falls back to the plain name', () => {
    only({ SUPER_ADMIN_KEY: GOOD });
    assert.deepEqual(superAdminKey(), { ok: true, key: GOOD });
  });

  it('trims surrounding whitespace', () => {
    only({ SCRUMBLER_SUPER_ADMIN_KEY: `  ${GOOD}  ` });
    assert.deepEqual(superAdminKey(), { ok: true, key: GOOD });
  });

  it('refuses a key that is too short to be worth guarding', () => {
    only({ SCRUMBLER_SUPER_ADMIN_KEY: 'hunter2' });
    const resolved = superAdminKey();
    assert.equal(resolved.ok, false);
    assert.match(resolved.ok ? '' : resolved.message, /at least 24 characters/);
  });

  it('reports nothing configured when nothing is set', () => {
    only({});
    assert.equal(superAdminKey().ok, false);
  });
});

describe('requireSuperAdmin', () => {
  it('lets the right key through', () => {
    only({ SCRUMBLER_SUPER_ADMIN_KEY: GOOD });
    assert.equal(requireSuperAdmin(withKey(GOOD)), null);
  });

  it('answers 403 for a wrong or missing key', () => {
    only({ SCRUMBLER_SUPER_ADMIN_KEY: GOOD });
    assert.equal(requireSuperAdmin(withKey('b'.repeat(GOOD.length)))?.status, 403);
    assert.equal(requireSuperAdmin(withKey(null))?.status, 403);
  });

  it('answers 503 when the deployment has no key, whatever is sent', () => {
    only({});
    // Not 403: an operator who never configured the key needs to know that,
    // and an empty expected secret must never authorise anyone.
    assert.equal(requireSuperAdmin(withKey(GOOD))?.status, 503);
    assert.equal(requireSuperAdmin(withKey(''))?.status, 503);
  });

  it('answers 503 rather than accepting a too-short key', () => {
    only({ SCRUMBLER_SUPER_ADMIN_KEY: 'short' });
    assert.equal(requireSuperAdmin(withKey('short'))?.status, 503);
  });
});

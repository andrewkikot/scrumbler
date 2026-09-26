import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { databaseUrl, databaseUrlSource, directDatabaseUrl } from '../src/lib/env';

/** Every variable the resolver looks at, so each test starts from nothing. */
const KEYS = [
  'SCRUMBLER_DATABASE_URL',
  'DATABASE_URL',
  'SCRUMBLER_POSTGRES_URL',
  'POSTGRES_URL',
  'SCRUMBLER_POSTGRES_PRISMA_URL',
  'POSTGRES_PRISMA_URL',
  'SCRUMBLER_DATABASE_URL_UNPOOLED',
  'DATABASE_URL_UNPOOLED',
  'SCRUMBLER_POSTGRES_URL_NON_POOLING',
  'POSTGRES_URL_NON_POOLING',
];

const saved = new Map(KEYS.map((key) => [key, process.env[key]]));

function only(values: Record<string, string>) {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('database url resolution', () => {
  it('uses DATABASE_URL when that is all there is', () => {
    only({ DATABASE_URL: 'postgres://plain' });
    assert.equal(databaseUrl(), 'postgres://plain');
  });

  it('uses the prefixed name when that is all there is', () => {
    only({ SCRUMBLER_DATABASE_URL: 'postgres://prefixed' });
    assert.equal(databaseUrl(), 'postgres://prefixed');
  });

  /**
   * The case this exists for: a team-wide DATABASE_URL belonging to another
   * project is visible here too. Connecting to it would be silent and wrong.
   */
  it('prefers the prefixed name over an inherited plain one', () => {
    only({
      SCRUMBLER_DATABASE_URL: 'postgres://this-project',
      DATABASE_URL: 'postgres://some-other-project',
    });
    assert.equal(databaseUrl(), 'postgres://this-project');
    assert.equal(databaseUrlSource(), 'SCRUMBLER_DATABASE_URL');
  });

  it('falls back to the Vercel POSTGRES_URL names', () => {
    only({ POSTGRES_URL: 'postgres://vercel' });
    assert.equal(databaseUrl(), 'postgres://vercel');
  });

  it('ignores a variable that is set but blank', () => {
    only({ SCRUMBLER_DATABASE_URL: '   ', DATABASE_URL: 'postgres://real' });
    assert.equal(databaseUrl(), 'postgres://real');
  });

  it('trims surrounding whitespace from a pasted value', () => {
    only({ DATABASE_URL: '  postgres://padded  ' });
    assert.equal(databaseUrl(), 'postgres://padded');
  });

  it('names every variable it checked when none is set', () => {
    only({});
    assert.throws(() => databaseUrl(), (error: unknown) => {
      const message = (error as Error).message;
      assert.match(message, /SCRUMBLER_DATABASE_URL/);
      assert.match(message, /POSTGRES_URL/);
      return true;
    });
    assert.equal(databaseUrlSource(), null);
  });
});

describe('direct url resolution', () => {
  it('prefers the prefixed unpooled name', () => {
    only({
      SCRUMBLER_DATABASE_URL_UNPOOLED: 'postgres://direct-prefixed',
      DATABASE_URL_UNPOOLED: 'postgres://direct-plain',
    });
    assert.equal(directDatabaseUrl(), 'postgres://direct-prefixed');
  });

  it('accepts the Vercel non-pooling name', () => {
    only({ POSTGRES_URL_NON_POOLING: 'postgres://direct-vercel' });
    assert.equal(directDatabaseUrl(), 'postgres://direct-vercel');
  });

  it('falls back to the pooled url so prisma generate still runs', () => {
    only({ SCRUMBLER_DATABASE_URL: 'postgres://pooled-only' });
    assert.equal(directDatabaseUrl(), 'postgres://pooled-only');
  });

  it('returns empty rather than throwing when nothing is configured', () => {
    only({});
    assert.equal(directDatabaseUrl(), '');
  });
});

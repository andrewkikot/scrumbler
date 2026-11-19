import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  kickedAt,
  readStreamClient,
  rejectOutdatedHeartbeat,
  STREAM_PROTOCOL,
} from '../src/lib/stream-protocol';

const stream = (query: string) => new Request(`https://scrumbler.test/api/rooms/abc/stream${query}`);

describe('readStreamClient', () => {
  it('reads a current client and when its session began', () => {
    assert.deepEqual(readStreamClient(stream(`?v=${STREAM_PROTOCOL}&since=1700&clientId=x`)), {
      kickAware: true,
      since: 1700,
    });
  });

  it('still streams to a v2 tab, which cannot read a kick', () => {
    assert.deepEqual(readStreamClient(stream('?v=2&clientId=x')), { kickAware: false, since: 0 });
  });

  it('turns away a tab with no marker, with 204 so EventSource stops', () => {
    for (const query of ['', '?clientId=x', '?v=1']) {
      const result = readStreamClient(stream(query));
      assert.ok(result instanceof Response, query);
      assert.equal(result.status, 204, query);
    }
  });

  it('treats a junk since as 0', () => {
    for (const since of ['abc', '-5', '']) {
      const result = readStreamClient(stream(`?v=${STREAM_PROTOCOL}&since=${since}`));
      assert.ok(!(result instanceof Response));
      assert.equal(result.since, 0, since);
    }
  });
});

describe('rejectOutdatedHeartbeat', () => {
  it('answers 204 to any heartbeat without the current marker', () => {
    assert.equal(rejectOutdatedHeartbeat({})?.status, 204);
    assert.equal(rejectOutdatedHeartbeat({ v: '2' })?.status, 204);
    assert.equal(rejectOutdatedHeartbeat({ v: STREAM_PROTOCOL }), null);
  });
});

describe('kickedAt', () => {
  it('kicks a session that began before the disconnect', () => {
    assert.equal(kickedAt(2000, 1000), 2000);
    assert.equal(kickedAt(2000, 0), 2000);
  });

  it('leaves a session that began at or after it, or a room never disconnected', () => {
    assert.equal(kickedAt(2000, 2000), null);
    assert.equal(kickedAt(2000, 3000), null);
    assert.equal(kickedAt(null, 0), null);
  });
});

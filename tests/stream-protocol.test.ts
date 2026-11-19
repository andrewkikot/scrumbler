import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rejectOutdatedClient, STREAM_PROTOCOL } from '../src/lib/stream-protocol';

const stream = (query: string) => new Request(`https://scrumbler.test/api/rooms/abc/stream${query}`);

describe('rejectOutdatedClient', () => {
  it('lets a current client through', () => {
    assert.equal(rejectOutdatedClient(stream(`?v=${STREAM_PROTOCOL}&clientId=x`)), null);
  });

  it('turns away a tab loaded before the marker, with 204 so EventSource stops', () => {
    for (const query of ['', '?clientId=x', '?v=1']) {
      assert.equal(rejectOutdatedClient(stream(query))?.status, 204, query);
    }
  });
});

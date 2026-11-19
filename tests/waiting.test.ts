import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ParticipantView } from '../src/lib/types';
import { describeMissing, waitingFor } from '../src/lib/waiting';

const seat = (name: string, over: Partial<ParticipantView> = {}): ParticipantView => ({
  id: name,
  name,
  isSpectator: false,
  online: true,
  hasVoted: false,
  value: null,
  ...over,
});

describe('waitingFor', () => {
  it('counts an away player as still to vote', () => {
    const result = waitingFor(
      [seat('Ana', { hasVoted: true }), seat('Bo', { hasVoted: true }), seat('Owner', { online: false })],
      false,
    );
    assert.equal(result.players, 3);
    assert.equal(result.voted, 2);
    assert.deepEqual(result.missing, [{ name: 'Owner', online: false }]);
    assert.equal(result.onlyAway, true);
  });

  it('is not "only away" while someone online is still thinking', () => {
    const result = waitingFor([seat('Ana'), seat('Bo', { online: false })], false);
    assert.equal(result.onlyAway, false);
  });

  it('leaves spectators out unless they may vote', () => {
    const people = [seat('Ana', { hasVoted: true }), seat('Watcher', { isSpectator: true })];
    assert.equal(waitingFor(people, false).missing.length, 0);
    assert.equal(waitingFor(people, true).missing.length, 1);
  });
});

describe('describeMissing', () => {
  it('marks who is away and folds a long tail', () => {
    const missing = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ name, online: i !== 1 }));
    assert.equal(describeMissing(missing), 'A, B (away), C and 2 more');
    assert.equal(describeMissing(missing.slice(0, 2)), 'A, B (away)');
  });
});

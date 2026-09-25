import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DECKS, numericValue, resolveDeck } from '../src/lib/decks';
import { slugifyName } from '../src/lib/ids';
import { computeStats } from '../src/lib/stats';
import { restAngle, segmentCenter, segmentUnderPointer, turnsFor } from '../src/lib/wheel';

const votes = (...values: string[]) => values.map((value) => ({ value }));

describe('card values', () => {
  it('reads the half card as 0.5', () => {
    assert.equal(numericValue('½'), 0.5);
  });

  it('treats unknown and coffee as non-numeric', () => {
    assert.equal(numericValue('?'), null);
    assert.equal(numericValue('☕'), null);
  });

  it('treats t-shirt sizes as non-numeric', () => {
    assert.equal(numericValue('M'), null);
    assert.equal(numericValue('XL'), null);
  });
});

describe('deck resolution', () => {
  it('falls back to Fibonacci for an unknown deck key', () => {
    assert.deepEqual(resolveDeck('nonsense', null), DECKS.fibonacci.cards);
  });

  it('splits and trims a custom deck', () => {
    assert.deepEqual(resolveDeck('custom', ' 1 , 2 ,3 , '), ['1', '2', '3']);
  });

  it('falls back when a custom deck is empty', () => {
    assert.deepEqual(resolveDeck('custom', '   ,  '), DECKS.fibonacci.cards);
  });

  it('caps a custom deck so the hand stays playable', () => {
    const many = Array.from({ length: 40 }, (_, i) => String(i)).join(',');
    assert.equal(resolveDeck('custom', many).length, 20);
  });
});

describe('round stats', () => {
  const deck = DECKS.fibonacci.cards;

  it('averages only the numeric cards', () => {
    const stats = computeStats(votes('2', '4', '?', '☕'), 4, deck);
    assert.equal(stats.average, 3);
    assert.equal(stats.voted, 4, 'non-numeric cards still count as votes cast');
  });

  it('takes the midpoint of an even number of votes', () => {
    assert.equal(computeStats(votes('1', '2', '3', '8'), 4, deck).median, 2.5);
  });

  it('takes the middle of an odd number of votes', () => {
    assert.equal(computeStats(votes('1', '5', '13'), 3, deck).median, 5);
  });

  it('reports no average when nobody played a number', () => {
    const stats = computeStats(votes('?', '☕'), 2, deck);
    assert.equal(stats.average, null);
    assert.equal(stats.median, null);
  });

  it('calls consensus only when everyone matched', () => {
    assert.equal(computeStats(votes('5', '5', '5'), 3, deck).consensus, true);
    assert.equal(computeStats(votes('5', '8'), 2, deck).consensus, false);
  });

  it('does not call a single vote consensus', () => {
    assert.equal(computeStats(votes('5'), 3, deck).consensus, false);
  });

  it('orders the distribution by deck order, not by count', () => {
    const stats = computeStats(votes('8', '8', '2', '5'), 4, deck);
    assert.deepEqual(
      stats.distribution.map((d) => d.value),
      ['2', '5', '8'],
    );
    assert.deepEqual(
      stats.distribution.map((d) => d.count),
      [1, 1, 2],
    );
  });

  it('keeps votes cast on a deck the admin has since changed', () => {
    const stats = computeStats(votes('3', 'XXL'), 2, deck);
    assert.deepEqual(
      stats.distribution.map((d) => d.value),
      ['3', 'XXL'],
      'off-deck cards are appended rather than dropped',
    );
  });
});

describe('room slugs', () => {
  it('builds a readable slug from a room name', () => {
    assert.equal(slugifyName('Platform Squad #2'), 'platform-squad-2');
  });

  it('strips accents', () => {
    assert.equal(slugifyName('Équipe Café'), 'equipe-cafe');
  });

  it('returns empty for names with nothing usable, so a random slug is used', () => {
    assert.equal(slugifyName('!!'), '');
    assert.equal(slugifyName('日本語'), '');
  });

  it('never leaves a trailing dash after truncation', () => {
    const slug = slugifyName('a'.repeat(30) + ' ' + 'b'.repeat(30));
    assert.ok(!slug.endsWith('-'), `got ${slug}`);
    assert.ok(slug.length <= 32);
  });
});

describe('wheel geometry', () => {
  it('derives the same turn count for the same spin id', () => {
    assert.equal(turnsFor('spin-abc'), turnsFor('spin-abc'));
  });

  it('always spins between 5 and 8 whole turns', () => {
    for (const id of ['a', 'bb', 'ccc', 'spin_123', 'clx9f2k4', '']) {
      const turns = turnsFor(id);
      assert.ok(turns >= 5 && turns <= 8, `${id} gave ${turns}`);
    }
  });

  it('puts the first segment centre just clockwise of the pointer', () => {
    assert.equal(segmentCenter(0, 4), 45);
    assert.equal(segmentCenter(3, 4), 315);
  });

  /**
   * The contract the whole wheel rests on: whatever the server picked must end
   * up under the pointer on every client.
   */
  it('lands the chosen segment under the pointer', () => {
    for (const count of [1, 2, 3, 5, 7, 12]) {
      for (let index = 0; index < count; index += 1) {
        const angle = restAngle(index, count, turnsFor(`s${index}-${count}`));
        assert.equal(
          segmentUnderPointer(angle, count),
          index,
          `count=${count} index=${index} angle=${angle}`,
        );
      }
    }
  });

  it('rotates by a whole number of turns plus the segment offset', () => {
    assert.equal(restAngle(0, 4, 5), 360 * 5 - 45);
  });
});

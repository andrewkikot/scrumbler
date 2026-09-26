import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cardFontSize, DECKS, numericValue, resolveDeck } from '../src/lib/decks';
import { slugifyName } from '../src/lib/ids';
import { computeStats } from '../src/lib/stats';
import {
  droppedWinnerIndex,
  restAngle,
  segmentCenter,
  segmentUnderPointer,
  SPIN_WINDUP,
  spinProgress,
  spinTarget,
  turnsFor,
  windupDeg,
} from '../src/lib/wheel';

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

describe('card face sizing', () => {
  it('gives the everyday one and two character faces the full size', () => {
    for (const card of ['0', '8', '13', '89', '?', '☕', '½', 'XL']) {
      assert.equal(cardFontSize(card), 26, `${card} was sized differently`);
    }
  });

  it('steps down the faces that would not otherwise fit', () => {
    assert.ok(cardFontSize('100') < cardFontSize('13'));
    assert.ok(cardFontSize('XXL') < cardFontSize('XL'));
    assert.ok(cardFontSize('break') < cardFontSize('100'));
  });

  /**
   * The card is 64×88 with 3px borders and 2px of side padding, and `WIDEST` is
   * a generous upper bound on a semibold Plex advance in ems — so if the sums
   * here fit, the real text does.
   */
  it('keeps every stock face on a single line inside the card', () => {
    const INNER = 64 - 3 * 2 - 2 * 2;
    const WIDEST = 0.72;
    for (const card of Object.values(DECKS).flatMap((d) => d.cards)) {
      const width = [...card].length * WIDEST * cardFontSize(card);
      assert.ok(width <= INNER, `${card} needs ~${Math.round(width)}px of ${INNER}px`);
    }
  });

  it('wraps a custom deck’s long face into the card rather than over it', () => {
    const INNER = 64 - 3 * 2 - 2 * 2;
    const INNER_HEIGHT = 88 - 3 * 2;
    const WIDEST = 0.72;
    for (const card of ['break', 'no idea', 'needs a spike']) {
      const size = cardFontSize(card);
      const perLine = Math.floor(INNER / (WIDEST * size));
      assert.ok(perLine >= 1, `${card} cannot fit a single character`);
      const height = Math.ceil([...card].length / perLine) * size * 1.15;
      assert.ok(height <= INNER_HEIGHT, `${card} needs ~${Math.round(height)}px of ${INNER_HEIGHT}px`);
    }
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

  /**
   * A wheel that has already spun is not sitting at zero, and a wheel must
   * never wind *backwards* into its result.
   */
  it('always spins forwards, from wherever the wheel is resting', () => {
    for (const count of [1, 2, 3, 5, 7, 12]) {
      for (let index = 0; index < count; index += 1) {
        for (const from of [0, 17.5, 359, 1234.5, 360 * 9 - 45, -500]) {
          const turns = turnsFor(`s${index}-${count}`);
          const target = spinTarget(from, index, count, turns);
          const travel = target - from;
          assert.ok(
            travel >= 360 * turns && travel < 360 * (turns + 1),
            `from=${from} count=${count} index=${index} travelled ${travel}`,
          );
          assert.equal(
            segmentUnderPointer(target, count),
            index,
            `from=${from} count=${count} index=${index} landed wrong`,
          );
        }
      }
    }
  });
});

describe('dropping the winner off the wheel', () => {
  const wheel = [
    { id: 'a', label: 'Ana' },
    { id: 'b', label: 'Bo' },
    { id: 'c', label: 'Kim' },
  ];
  const without = (id: string) => wheel.filter((e) => e.id !== id);

  it('finds the wedge when the winner is the one benched', () => {
    assert.equal(droppedWinnerIndex(wheel, without('b'), 'Bo'), 1);
    assert.equal(droppedWinnerIndex(wheel, without('a'), 'Ana'), 0);
  });

  it('ignores anybody else leaving the wheel', () => {
    assert.equal(droppedWinnerIndex(wheel, without('c'), 'Bo'), -1);
  });

  it('ignores names arriving, and two changes at once', () => {
    assert.equal(droppedWinnerIndex(wheel, [...wheel, { id: 'd' }], 'Bo'), -1);
    assert.equal(droppedWinnerIndex(wheel, [{ id: 'a' }], 'Bo'), -1);
  });

  it('needs a spin to have happened at all', () => {
    assert.equal(droppedWinnerIndex(wheel, without('b'), null), -1);
  });

  /** A rename that also benches must not be mistaken for the winner's wedge. */
  it('matches on the label, not just the count', () => {
    assert.equal(droppedWinnerIndex(wheel, without('b'), 'Kim'), -1);
  });
});

describe('spin easing', () => {
  it('starts at nothing and finishes on the target exactly', () => {
    assert.equal(spinProgress(0), 0);
    assert.equal(spinProgress(1), 1);
    // Overshooting time must not overshoot the landing.
    assert.equal(spinProgress(1.4), 1);
    assert.equal(spinProgress(-2), 0);
  });

  it('only ever moves forwards', () => {
    let last = -1;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const p = spinProgress(t);
      assert.ok(p >= last, `progress went backwards at t=${t}`);
      last = p;
    }
  });

  /**
   * Fast away, slow home — but never *stopped*. A curve that has spent 99% of
   * its travel by half time leaves a wheel that looks frozen for seconds.
   */
  it('throws most of the travel early and still creeps at the end', () => {
    const half = spinProgress(0.5);
    assert.ok(half > 0.7, `half way through it had only ${half}`);
    assert.ok(half < 0.9, `half way through it had already done ${half}`);

    // Something is still visibly moving in the last fifth of the spin.
    const left = 1 - spinProgress(0.8);
    assert.ok(left > 0.005, `only ${left} of the travel was left at t=0.8`);
  });

  it('rocks backwards only during the wind-up, and returns to zero', () => {
    assert.equal(windupDeg(0), 0);
    assert.ok(windupDeg(SPIN_WINDUP / 2) > 0);
    assert.equal(windupDeg(SPIN_WINDUP), 0);
    assert.equal(windupDeg(0.5), 0);
    // Nothing is pulled back once the wheel is actually travelling.
    assert.equal(spinProgress(SPIN_WINDUP), 0);
  });
});

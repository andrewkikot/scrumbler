import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cardFontSize, DECKS, numericValue, resolveDeck } from '../src/lib/decks';
import {
  burstAt,
  createShow,
  RING_MS,
  ringAt,
  shellAt,
  SHOW_MS,
  sparksAt,
} from '../src/lib/fireworks';
import { slugifyName } from '../src/lib/ids';
import { drawPool, settleRotation, type RotationEntry } from '../src/lib/rotation';
import { computeStats } from '../src/lib/stats';
import {
  droppedIndex,
  edgeGuard,
  landingOffset,
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

  it('always spins between 9 and 12 whole turns', () => {
    for (const id of ['a', 'bb', 'ccc', 'spin_123', 'clx9f2k4', '']) {
      const turns = turnsFor(id);
      assert.ok(turns >= 9 && turns <= 12, `${id} gave ${turns}`);
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

describe('dropping a name off the wheel', () => {
  const wheel = [
    { id: 'a', label: 'Ana' },
    { id: 'b', label: 'Bo' },
    { id: 'c', label: 'Kim' },
  ];
  const without = (id: string) => wheel.filter((e) => e.id !== id);

  /** Whoever took them off: the spin's winner, or the admin by hand. */
  it('finds the wedge whoever has left, wherever they sat', () => {
    assert.equal(droppedIndex(wheel, without('a')), 0);
    assert.equal(droppedIndex(wheel, without('b')), 1);
    assert.equal(droppedIndex(wheel, without('c')), 2);
  });

  it('ignores names arriving, and two changes at once', () => {
    assert.equal(droppedIndex(wheel, [...wheel, { id: 'd', label: 'Dee' }]), -1);
    assert.equal(droppedIndex(wheel, [{ id: 'a', label: 'Ana' }]), -1);
    assert.equal(droppedIndex(wheel, wheel), -1);
  });

  /** A rename riding along with the bench is not a clean drop. */
  it('will not call a rename a drop', () => {
    const renamed = [
      { id: 'a', label: 'Anastasia' },
      { id: 'c', label: 'Kim' },
    ];
    assert.equal(droppedIndex(wheel, renamed), -1);
  });

  /** A reorder changes which wedge is which, so the wheel must just redraw. */
  it('will not call a reorder a drop', () => {
    assert.equal(droppedIndex(wheel, [without('b')[1], without('b')[0]]), -1);
  });

  it('drops the last name on the wheel', () => {
    assert.equal(droppedIndex([{ id: 'a', label: 'Ana' }], []), 0);
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

describe('winner fireworks', () => {
  const aspect = 1.4;

  /** The result is shared, so the celebration of it should be shared too. */
  it('lets off the same show for the same spin, and a different one for another', () => {
    assert.deepEqual(createShow('spin-abc'), createShow('spin-abc'));
    assert.notDeepEqual(createShow('spin-abc'), createShow('spin-xyz'));
  });

  it('keeps every shell inside the box it is drawn in', () => {
    for (const burst of createShow('spin-abc')) {
      assert.ok(burst.burstX > 0 && burst.burstX < 1, `burst at ${burst.burstX}`);
      assert.ok(burst.fromX > 0 && burst.fromX < 1, `fired from ${burst.fromX}`);
      assert.ok(burst.burstY > 0 && burst.burstY < 1, `burst ${burst.burstY} high`);
    }
  });

  /**
   * The overlay is torn down at SHOW_MS, so anything still burning then would
   * be cut off mid-flight — which reads as a dropped frame, not an ending.
   */
  it('has every ember out before the show ends', () => {
    for (const seed of ['a', 'spin-abc', 'clx9f2k4', '']) {
      for (const burst of createShow(seed)) {
        assert.ok(burst.life > 0, `${seed} gave a burst with no life`);
        assert.ok(burstAt(burst) + burst.life <= SHOW_MS, `${seed} burns past the show`);
        assert.equal(sparksAt(burst, SHOW_MS, aspect).length, 0);
      }
    }
  });

  it('climbs from the floor to the point it goes off at', () => {
    const [burst] = createShow('spin-abc');
    assert.equal(shellAt(burst, burst.launchAt - 1, aspect), null);
    assert.equal(shellAt(burst, burstAt(burst), aspect), null);

    const launch = shellAt(burst, burst.launchAt, aspect);
    const apex = shellAt(burst, burstAt(burst) - 1, aspect);
    assert.ok(launch && apex);
    assert.ok(launch.y < 0.01, `left the floor at ${launch.y}`);
    assert.ok(Math.abs(apex.y - burst.burstY) < 0.01, `stopped short at ${apex.y}`);
    // A shell slows as it climbs, so it covers less ground in the last half.
    const middle = shellAt(burst, (burst.launchAt + burstAt(burst)) / 2, aspect);
    assert.ok(middle && middle.y > burst.burstY / 2, `only ${middle?.y} up at half time`);
  });

  /** A display ends on everything left in the mortars going up together. */
  it('saves its heaviest shells for a finale', () => {
    const show = createShow('spin-abc');
    assert.ok(show.length >= 12, `only ${show.length} shells`);

    // Shells are built in launch order, so the finale is the tail of the list.
    const finale = show.slice(-3);
    assert.ok(
      finale.every((b) => b.heavy),
      'the show does not end on its heavy shells',
    );
    const spread = finale[finale.length - 1].launchAt - finale[0].launchAt;
    assert.ok(spread <= 400, `the finale took ${spread}ms to go up`);
    for (const burst of finale) {
      assert.ok(burst.sparks > 30, `a finale shell with ${burst.sparks} stars`);
    }
  });

  it('runs a shockwave out of each flash and stops it there', () => {
    const burst = createShow('spin-abc')[0];
    assert.equal(ringAt(burst, burstAt(burst) - 1), null);
    assert.equal(ringAt(burst, burstAt(burst) + RING_MS), null);

    let previous = -1;
    for (let since = 0; since < RING_MS; since += 20) {
      const ring = ringAt(burst, burstAt(burst) + since);
      assert.ok(ring, `no ring ${since}ms in`);
      assert.ok(ring.radius > previous, `ring shrank at ${since}ms`);
      previous = ring.radius;
    }

    // The ring is a shockwave, not a wall the stars sit inside: it has to run
    // out ahead of them and be gone before they have spread that far.
    const ahead = sparksAt(burst, burstAt(burst) + RING_MS / 2, aspect);
    const origin = burst.burstX * aspect;
    const reach = Math.max(...ahead.map((s) => Math.abs(s.x - origin)));
    assert.ok(previous > reach, `stars at ${reach} overtook a ring at ${previous}`);
  });

  it('throws sparks out of the burst and then lets them fall', () => {
    const burst = createShow('spin-abc')[0];
    const flash = sparksAt(burst, burstAt(burst), aspect);
    assert.equal(flash.length, burst.sparks);

    const origin = burst.burstX * aspect;
    for (const spark of flash) {
      assert.ok(Math.abs(spark.x - origin) < 0.01, `spark started at ${spark.x}`);
      assert.ok(Math.abs(spark.y - burst.burstY) < 0.01, `spark started at ${spark.y}`);
    }

    const open = sparksAt(burst, burstAt(burst) + 150, aspect);
    const spread = Math.max(...open.map((s) => Math.abs(s.x - origin)));
    assert.ok(spread > 0.02, `sparks only reached ${spread}`);

    // Gravity has the last word: by the end the cloud's centre is below the
    // height it went off at.
    const dying = sparksAt(burst, burstAt(burst) + burst.life - 1, aspect);
    const mean = dying.reduce((sum, s) => sum + s.y, 0) / dying.length;
    assert.ok(mean < burst.burstY, `cloud sat at ${mean}, burst at ${burst.burstY}`);
    assert.ok(dying.every((s) => s.age > 0.98), 'the last sparks are not spent');
  });
});

describe('where a spin comes to rest', () => {
  const ids = Array.from({ length: 200 }, (_, i) => `spin-${i}`);
  const counts = [1, 2, 3, 5, 6, 8, 12, 20];

  it('offsets the same spin the same way everywhere', () => {
    assert.equal(landingOffset('spin-abc', 6), landingOffset('spin-abc', 6));
    assert.notEqual(landingOffset('spin-abc', 6), landingOffset('spin-xyz', 6));
  });

  /**
   * The whole point of landing near a cut is that it is still obvious which
   * side of it the wheel came down on.
   */
  it('always leaves the pointer clear of the cut by the guard', () => {
    for (const count of counts) {
      const half = 180 / count;
      for (const id of ids) {
        const gap = half - Math.abs(landingOffset(id, count));
        assert.ok(
          gap >= edgeGuard(count) - 1e-9,
          `${id} on ${count} stopped ${gap.toFixed(2)}° from the cut`,
        );
      }
    }
  });

  it('still parks the winner under the pointer, offset and all', () => {
    for (const count of counts) {
      for (let index = 0; index < count; index += 1) {
        for (const from of [0, 17.5, 359, 1234.5, -500]) {
          const id = `s${index}-${count}`;
          const turns = turnsFor(id);
          const target = spinTarget(from, index, count, turns, landingOffset(id, count));
          assert.equal(
            segmentUnderPointer(target, count),
            index,
            `${id} from ${from} landed on the wrong name`,
          );
          const travel = target - from;
          assert.ok(
            travel >= 360 * turns && travel < 360 * (turns + 1),
            `${id} from ${from} travelled ${travel}`,
          );
        }
      }
    }
  });

  /**
   * A near-edge landing is the point of the exercise, so most spins have to
   * actually be near an edge — and both edges have to see traffic, or every
   * draw would creep over the line from the same side.
   */
  it('lands out near the cuts far more often than in the middle', () => {
    const room = 180 / 6 - edgeGuard(6);
    const offsets = ids.map((id) => landingOffset(id, 6));
    const outer = offsets.filter((o) => Math.abs(o) > room * 0.6).length;
    assert.ok(outer > ids.length * 0.5, `only ${outer} of ${ids.length} landed wide`);

    const middling = offsets.filter((o) => Math.abs(o) < room * 0.2).length;
    assert.ok(middling > 0, 'no spin ever stops near the middle of its wedge');

    const over = offsets.filter((o) => o > 0).length;
    assert.ok(over > 60 && over < 140, `${over} of ${ids.length} went to the same side`);
  });
});

describe('a rotation settling after a draw', () => {
  const roster = (...on: string[]): RotationEntry[] =>
    ['Ana', 'Bo', 'Kim'].map((label) => ({
      id: label.toLowerCase(),
      label,
      active: on.includes(label),
    }));

  /** Mid-rotation there is nothing clever to do: the winner has had a turn. */
  it('takes the winner off a wheel that still has names on it', () => {
    assert.deepEqual(settleRotation(roster('Ana', 'Bo', 'Kim'), 'Bo'), {
      activate: [],
      deactivate: ['bo'],
      heldOver: null,
    });
  });

  /**
   * The whole point: the wheel does not end up empty, it ends up full. The name
   * that closed the rotation goes back on with everybody else — it is the next
   * draw that skips them, not the wheel that benches them.
   */
  it('refills the wheel with everyone when the last name goes', () => {
    assert.deepEqual(settleRotation(roster('Kim'), 'Kim'), {
      activate: ['ana', 'bo'],
      deactivate: [],
      heldOver: 'Kim',
    });
  });

  /** Everybody already off, and a draw settles: same thing, nobody to drop. */
  it('refills a wheel that was already empty', () => {
    assert.deepEqual(settleRotation(roster(), 'Kim'), {
      activate: ['ana', 'bo', 'kim'],
      deactivate: [],
      heldOver: 'Kim',
    });
  });

  /** A wheel of one has nobody to skip to, so it holds nobody and never dies. */
  it('refills a one-name wheel with that name, and holds nobody', () => {
    const solo = [{ id: 'a', label: 'Ana', active: true }];
    assert.deepEqual(settleRotation(solo, 'Ana'), {
      activate: [],
      deactivate: [],
      heldOver: null,
    });
  });

  /** The winner removed between the draw and the settle: refill, hold nobody. */
  it('refills when the winner is no longer on the roster at all', () => {
    const gone: RotationEntry[] = [
      { id: 'ana', label: 'Ana', active: false },
      { id: 'bo', label: 'Bo', active: false },
    ];
    assert.deepEqual(settleRotation(gone, 'Kim'), {
      activate: ['ana', 'bo'],
      deactivate: [],
      heldOver: null,
    });
  });
});

describe('who is in a draw', () => {
  const wheel = [{ label: 'Ana' }, { label: 'Bo' }, { label: 'Kim' }];

  it('is everyone on the wheel when nobody is held over', () => {
    assert.deepEqual(drawPool(wheel, null), wheel);
  });

  it('skips the name the last rotation held over', () => {
    assert.deepEqual(drawPool(wheel, 'Bo'), [{ label: 'Ana' }, { label: 'Kim' }]);
  });

  /** A name dropped since the refill is not on the wheel to be skipped. */
  it('ignores a hold on a name that is not in the draw', () => {
    assert.deepEqual(drawPool(wheel, 'Dev'), wheel);
  });

  /**
   * The hold must never empty the draw. Everyone else dropped since the refill
   * leaves nobody to skip to, and a wheel that cannot be spun is worse than a
   * repeat.
   */
  it('gives way rather than leave a wheel that cannot be spun', () => {
    assert.deepEqual(drawPool([{ label: 'Bo' }], 'Bo'), [{ label: 'Bo' }]);
  });
});

describe('a rotation run end to end', () => {
  /*
    The two things the rotation actually promises, played out rather than
    reasoned about: run a wheel for hundreds of draws and nobody leads two
    dailies running, everybody gets about the same number of turns, and the
    wheel is never left empty or unspinnable. Both halves are in the loop —
    the draw skips who it must, the settle refills — and every draw is settled
    twice, as two clients watching the same wheel would.
  */
  it('keeps its promises over hundreds of draws', () => {
    for (const size of [1, 2, 3, 5, 8]) {
      const names = Array.from({ length: size }, (_, i) => String.fromCharCode(65 + i));

      for (let seed = 1; seed <= 8; seed += 1) {
        let rng = seed;
        const pick = (n: number) => {
          rng = (rng * 1103515245 + 12345) % 2147483648;
          return rng % n;
        };

        let wheel: RotationEntry[] = names.map((label) => ({ id: label, label, active: true }));
        let held: string | null = null;
        let settledDraw = -1;
        const drawn: string[] = [];

        for (let draw = 0; draw < 200; draw += 1) {
          // ---- the spin route ----
          const on = wheel.filter((e) => e.active);
          assert.ok(on.length > 0, `size ${size} seed ${seed}: the wheel ran dry`);
          const pool = drawPool(on, held);
          assert.ok(pool.length > 0, `size ${size} seed ${seed}: the hold emptied the draw`);
          const winner = pool[pick(pool.length)];
          drawn.push(winner.label);
          held = null; // a hold is one draw long, and this was it

          // ---- the settle route, twice, as two clients would ----
          for (let client = 0; client < 2; client += 1) {
            if (settledDraw === draw) continue;
            const settled = settleRotation(wheel, winner.label);
            wheel = wheel.map((e) => ({
              ...e,
              active: settled.activate.includes(e.id)
                ? true
                : settled.deactivate.includes(e.id)
                  ? false
                  : e.active,
            }));
            held = settled.heldOver;
            settledDraw = draw;
          }

          // The refill is all-in: a rotation never closes onto a part-full wheel.
          if (held !== null) {
            assert.ok(
              wheel.every((e) => e.active),
              `size ${size} seed ${seed}: the refill left somebody off`,
            );
          }
        }

        // A wheel of one has nobody to alternate with; any more does.
        if (size > 1) {
          const repeat = drawn.findIndex((label, i) => i > 0 && label === drawn[i - 1]);
          assert.equal(repeat, -1, `size ${size} seed ${seed}: a repeat at draw ${repeat}`);
        }

        const turns = names.map((name) => drawn.filter((d) => d === name).length);
        // One rotation of slack: a wheel caught mid-rotation is not yet even.
        assert.ok(
          Math.max(...turns) - Math.min(...turns) <= 2,
          `size ${size} seed ${seed}: uneven turns ${turns.join(',')}`,
        );
      }
    }
  });
});

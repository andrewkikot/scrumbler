import { numericValue } from './decks';
import type { RoundStats } from './types';

/**
 * Summarise a revealed round.
 *
 * Non-numeric cards (`?`, coffee, infinity) count as votes and appear in the
 * distribution, but never drag the average around — someone saying "I don't
 * know" is not an estimate of zero.
 */
export function computeStats(
  votes: { value: string }[],
  eligible: number,
  deck: string[],
): RoundStats {
  const numbers = votes
    .map((vote) => numericValue(vote.value))
    .filter((n): n is number => n !== null);

  const sorted = [...numbers].sort((a, b) => a - b);
  const median = sorted.length
    ? sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : null;

  const counts = new Map<string, number>();
  for (const vote of votes) counts.set(vote.value, (counts.get(vote.value) ?? 0) + 1);

  // Order the distribution the way the deck is laid out, then append any
  // stragglers — cards from a deck the admin has since switched away from.
  const inDeck = deck
    .filter((card) => counts.has(card))
    .map((card) => ({ value: card, count: counts.get(card)! }));
  const offDeck = [...counts.keys()]
    .filter((card) => !deck.includes(card))
    .map((card) => ({ value: card, count: counts.get(card)! }));

  return {
    voted: votes.length,
    eligible,
    average: numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null,
    median,
    // One person agreeing with themselves is not consensus.
    consensus: votes.length > 1 && counts.size === 1,
    distribution: [...inDeck, ...offDeck],
  };
}

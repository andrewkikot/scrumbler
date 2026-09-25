/** Card values that carry no numeric meaning and are excluded from averages. */
export const NON_NUMERIC = ['?', '☕', '∞'] as const;

export type DeckKey = 'fibonacci' | 'modified' | 'tshirt' | 'powers' | 'sequential' | 'custom';

export const DECKS: Record<Exclude<DeckKey, 'custom'>, { label: string; cards: string[] }> = {
  fibonacci: {
    label: 'Fibonacci',
    cards: ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?', '☕'],
  },
  modified: {
    label: 'Mod. Fibonacci',
    cards: ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?', '☕'],
  },
  tshirt: {
    label: 'T-Shirt',
    cards: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?', '☕'],
  },
  powers: {
    label: 'Powers of 2',
    cards: ['0', '1', '2', '4', '8', '16', '32', '64', '128', '?', '☕'],
  },
  sequential: {
    label: 'Sequential',
    cards: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '?', '☕'],
  },
};

export const DECK_KEYS: DeckKey[] = ['fibonacci', 'modified', 'tshirt', 'powers', 'sequential', 'custom'];

export function deckLabel(key: DeckKey): string {
  return key === 'custom' ? 'Custom' : DECKS[key].label;
}

/** Resolve a room's configured deck into the actual list of card faces. */
export function resolveDeck(deckKey: string, customDeck: string | null): string[] {
  if (deckKey === 'custom') {
    const cards = (customDeck ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    return cards.length ? cards.slice(0, 20) : DECKS.fibonacci.cards;
  }
  return DECKS[(deckKey as Exclude<DeckKey, 'custom'>) in DECKS ? (deckKey as Exclude<DeckKey, 'custom'>) : 'fibonacci']
    .cards;
}

/** `½` and friends need a parser that is not just Number(). */
export function numericValue(card: string): number | null {
  if ((NON_NUMERIC as readonly string[]).includes(card)) return null;
  if (card === '½') return 0.5;
  const n = Number(card);
  return Number.isFinite(n) ? n : null;
}

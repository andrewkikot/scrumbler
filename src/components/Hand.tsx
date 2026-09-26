'use client';

import { cardFontSize } from '@/lib/decks';

type HandProps = {
  deck: string[];
  selected: string | null;
  disabled: boolean;
  disabledReason: string | null;
  onPick: (value: string | null) => void;
};

/** Your own cards. Clicking the card you already played takes it back. */
export function Hand({ deck, selected, disabled, disabledReason, onPick }: HandProps) {
  return (
    <section aria-labelledby="hand-heading">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="hand-heading" className="text-[18px]">
          Your hand
        </h2>
        <p className="text-[13px] text-[color:var(--color-ink-dim)]">
          {disabledReason ?? (selected ? 'Click your card again to take it back.' : 'Pick a card.')}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {deck.map((card) => {
          const isSelected = selected === card;
          return (
            <button
              key={card}
              type="button"
              className="px-card"
              style={{ fontSize: cardFontSize(card) }}
              aria-pressed={isSelected}
              aria-label={`Estimate ${card}`}
              disabled={disabled}
              onClick={() => onPick(isSelected ? null : card)}
            >
              {card}
            </button>
          );
        })}
      </div>
    </section>
  );
}

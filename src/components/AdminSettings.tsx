'use client';

import { useEffect, useState } from 'react';
import type { RoomController } from '@/hooks/useRoom';
import { getAdminToken } from '@/lib/client';
import { DECK_KEYS, DECKS, deckLabel, type DeckKey } from '@/lib/decks';

type ToggleProps = {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
};

function Toggle({ label, hint, checked, onChange }: ToggleProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--color-gold)]"
      />
      <span className="flex flex-col">
        <span className="text-[14px] font-medium">{label}</span>
        <span className="text-[13px] text-[color:var(--color-ink-dim)]">{hint}</span>
      </span>
    </label>
  );
}

export function AdminSettings({ room, onDeleted }: { room: RoomController; onDeleted: () => void }) {
  const { state } = room;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copied, setCopied] = useState<'link' | 'admin' | null>(null);

  // A draft is null until you type in the field, so the server's value shows
  // through whenever you are not actively editing — including when another
  // admin changes it from their own browser.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [customDraft, setCustomDraft] = useState<string | null>(null);
  const name = nameDraft ?? state.name;
  const custom = customDraft ?? state.settings.customDeck ?? '';

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (which: 'link' | 'admin') => {
    const origin = window.location.origin;
    const token = getAdminToken(state.slug);
    const url =
      which === 'admin' && token
        ? `${origin}/r/${state.slug}?admin=${encodeURIComponent(token)}`
        : `${origin}/r/${state.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(which);
    } catch {
      window.prompt('Copy this link', url);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="px-panel p-5" aria-labelledby="links-heading">
        <h2 id="links-heading" className="mb-1 text-[16px]">
          Links
        </h2>
        <p className="mb-4 text-[13px] text-[color:var(--color-ink-dim)]">
          The player link is safe to paste anywhere. The admin link carries your control token —
          anyone who opens it can change this room.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="px-btn px-btn-sm" onClick={() => void copy('link')}>
            {copied === 'link' ? 'Copied' : 'Copy player link'}
          </button>
          <button
            type="button"
            className="px-btn px-btn-sm px-btn-gold"
            onClick={() => void copy('admin')}
          >
            {copied === 'admin' ? 'Copied' : 'Copy admin link'}
          </button>
        </div>
      </section>

      <section className="px-panel p-5" aria-labelledby="room-heading">
        <h2 id="room-heading" className="mb-4 text-[16px]">
          Room
        </h2>

        <label className="px-label" htmlFor="room-name">
          Name
        </label>
        <input
          id="room-name"
          className="px-input mb-5"
          value={name}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            const next = name.trim();
            if (next && next !== state.name) void room.updateRoom({ name: next });
            setNameDraft(null);
          }}
        />

        <span className="px-label">Deck</span>
        <div className="mb-4 flex flex-wrap gap-2">
          {DECK_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={`px-btn px-btn-sm ${state.settings.deckKey === key ? 'px-btn-gold' : ''}`}
              aria-pressed={state.settings.deckKey === key}
              onClick={() => void room.updateRoom({ deckKey: key })}
            >
              {deckLabel(key as DeckKey)}
            </button>
          ))}
        </div>

        {state.settings.deckKey === 'custom' ? (
          <>
            <label className="px-label" htmlFor="custom-deck">
              Custom cards, comma separated
            </label>
            <input
              id="custom-deck"
              className="px-input"
              placeholder="1, 2, 3, 5, 8, ?, break"
              value={custom}
              onChange={(e) => setCustomDraft(e.target.value)}
              onBlur={() => {
                void room.updateRoom({ customDeck: custom.trim() || null });
                setCustomDraft(null);
              }}
            />
          </>
        ) : (
          <p className="text-[13px] text-[color:var(--color-ink-dim)]">
            {DECKS[state.settings.deckKey as Exclude<DeckKey, 'custom'>]?.cards.join('  ')}
          </p>
        )}
      </section>

      <section className="px-panel p-5" aria-labelledby="rules-heading">
        <h2 id="rules-heading" className="mb-2 text-[16px]">
          Rules
        </h2>
        <Toggle
          label="Reveal automatically"
          hint="Flip the cards the moment everyone present has voted."
          checked={state.settings.autoReveal}
          onChange={(v) => void room.updateRoom({ autoReveal: v })}
        />
        <Toggle
          label="Let players change their card"
          hint="Off means the first card you play is final for that round."
          checked={state.settings.allowRevote}
          onChange={(v) => void room.updateRoom({ allowRevote: v })}
        />
        <Toggle
          label="Show average and median"
          hint="Turn off for teams that estimate in t-shirt sizes."
          checked={state.settings.showAverage}
          onChange={(v) => void room.updateRoom({ showAverage: v })}
        />
        <Toggle
          label="Spectators can vote"
          hint="Normally spectators only watch the table."
          checked={state.settings.allowSpectatorVote}
          onChange={(v) => void room.updateRoom({ allowSpectatorVote: v })}
        />
      </section>

      {/* The wheel keeps its own section: everything under Rules is a poker
          rule, and the two halves of the room do not share settings. */}
      <section className="px-panel p-5" aria-labelledby="wheel-rules-heading">
        <h2 id="wheel-rules-heading" className="mb-2 text-[16px]">
          Wheel
        </h2>
        <Toggle
          label="Anyone can spin"
          hint="Off means only you draw the next daily lead. Adding and dropping names stays with you either way."
          checked={state.settings.allowAnyoneToSpin}
          onChange={(v) => void room.updateRoom({ allowAnyoneToSpin: v })}
        />
        <Toggle
          label="Drop the winner automatically"
          hint="The name the wheel lands on leaves it once the wheel stops, so the rotation works its way round. Off means you drop people by hand."
          checked={state.settings.dropWinnerAfterSpin}
          onChange={(v) => void room.updateRoom({ dropWinnerAfterSpin: v })}
        />
      </section>

      <section className="px-panel p-5" aria-labelledby="danger-heading">
        <h2 id="danger-heading" className="mb-1 text-[16px] text-[color:var(--color-rose)]">
          Delete room
        </h2>
        <p className="mb-4 text-[13px] text-[color:var(--color-ink-dim)]">
          Removes the room, its history and its wheel. The URL stops working for everyone.
        </p>
        {confirmingDelete ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-btn px-btn-sm px-btn-danger"
              onClick={async () => {
                await room.deleteRoom();
                onDeleted();
              }}
            >
              Yes, delete {state.name}
            </button>
            <button
              type="button"
              className="px-btn px-btn-sm"
              onClick={() => setConfirmingDelete(false)}
            >
              Keep it
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="px-btn px-btn-sm px-btn-danger"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete this room
          </button>
        )}
      </section>
    </div>
  );
}

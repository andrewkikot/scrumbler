'use client';

import { useState, useSyncExternalStore } from 'react';
import { getDisplayName, setDisplayName } from '@/lib/client';
import { snapshot, subscribe } from '@/lib/store';

type JoinGateProps = {
  roomName: string;
  onJoin: (name: string, isSpectator: boolean) => Promise<void>;
};

/** The only thing standing between a link and playing: what to call you. */
export function JoinGate({ roomName, onJoin }: JoinGateProps) {
  const [isSpectator, setIsSpectator] = useState(false);
  const [busy, setBusy] = useState(false);

  // The name you used last time, straight from storage. `draft` stays null
  // until you actually type, so the remembered name fills in on hydration
  // without an effect copying it into state.
  const remembered = useSyncExternalStore(
    subscribe,
    () => snapshot('displayName', getDisplayName),
    () => '',
  );
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? remembered;
  const setName = setDraft;

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setDisplayName(trimmed);
    try {
      await onJoin(trimmed, isSpectator);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="px-panel w-full max-w-[460px] p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2 className="mb-1 text-[22px]">Take a seat</h2>
      <p className="mb-5 text-[14px] text-[color:var(--color-ink-dim)]">
        You are joining {roomName}. No account needed — just a name your team will recognise.
      </p>

      <label className="px-label" htmlFor="join-name">
        Your name
      </label>
      <input
        id="join-name"
        className="px-input mb-4"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ana"
        maxLength={32}
        required
      />

      <label className="mb-5 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={isSpectator}
          onChange={(e) => setIsSpectator(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--color-gold)]"
        />
        <span className="flex flex-col">
          <span className="font-display text-[14px]">Watch only</span>
          <span className="text-[13px] text-[color:var(--color-ink-dim)]">
            Sit at the table without being counted in the estimate.
          </span>
        </span>
      </label>

      <button type="submit" className="px-btn px-btn-gold w-full" disabled={!name.trim() || busy}>
        {busy ? 'Joining…' : 'Join room'}
      </button>
    </form>
  );
}

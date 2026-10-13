'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Mark } from '@/components/Mark';
import { PokerPanel } from '@/components/PokerPanel';
import { TimerBar } from '@/components/TimerBar';
import { WheelPanel } from '@/components/WheelPanel';
import { useWatchedRoom, type Connection } from '@/hooks/useRoom';
import type { RoomState } from '@/lib/types';

type Tab = 'poker' | 'wheel';

const CONNECTION_COPY: Record<Connection, { text: string; color: string }> = {
  connecting: { text: 'Connecting', color: 'var(--color-ink-dim)' },
  live: { text: 'Live', color: 'var(--color-lime)' },
  dropped: { text: 'Reconnecting', color: 'var(--color-gold)' },
  gone: { text: 'Link closed', color: 'var(--color-rose)' },
};

/**
 * The room through a watch link: the same table, wheel and timer the players
 * see, with every control taken away. There is no join form — a watcher is not
 * at the table, and does not show up in anyone's count of who is.
 */
export function WatchClient({ token, initialState }: { token: string; initialState: RoomState }) {
  const room = useWatchedRoom(token, initialState);
  const [tab, setTab] = useState<Tab>('poker');

  if (room.connection === 'gone') {
    return (
      <main className="grid min-h-dvh place-items-center px-4 text-center">
        <div className="px-panel max-w-[420px] p-8">
          <h1 className="mb-2 text-[22px]">This link is closed</h1>
          <p className="mb-6 text-[color:var(--color-ink-dim)]">
            The room&apos;s admin reset the watch link, or deleted the room. Ask them for a new one.
          </p>
          <Link href="/" className="px-btn px-btn-gold">
            Go to Scrumbler
          </Link>
        </div>
      </main>
    );
  }

  const status = CONNECTION_COPY[room.connection];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1120px] flex-col gap-6 px-4 py-6 md:px-6">
      <a href="#room-main" className="px-skip px-btn px-btn-gold">
        Skip to the room
      </a>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" aria-label="Scrumbler home" className="shrink-0">
            <Mark size={40} />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-[22px] leading-tight">{room.state.name}</h1>
            <p className="truncate text-[13px] text-[color:var(--color-ink-dim)]">
              Watching — you can see the room, not change it
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-chip" style={{ color: status.color }}>
            <span
              aria-hidden
              className={room.connection === 'live' ? '' : 'px-blink'}
              style={{ width: 8, height: 8, background: status.color, display: 'inline-block' }}
            />
            {status.text}
          </span>
          <span className="px-chip" style={{ color: 'var(--color-teal)' }}>
            Watching
          </span>
        </div>
      </header>

      <nav className="flex gap-2" aria-label="Room sections">
        {(['poker', 'wheel'] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={`px-btn ${tab === id ? 'px-btn-gold' : ''}`}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {id === 'poker' ? 'Poker' : 'Wheel'}
          </button>
        ))}
      </nav>

      <TimerBar room={room} setupOpen={false} onCloseSetup={() => {}} />

      <main id="room-main" className="flex flex-1 flex-col gap-6">
        {tab === 'poker' ? <PokerPanel room={room} /> : <WheelPanel room={room} />}
      </main>
    </div>
  );
}

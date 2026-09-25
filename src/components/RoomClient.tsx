'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminSettings } from '@/components/AdminSettings';
import { JoinGate } from '@/components/JoinGate';
import { Mark } from '@/components/Mark';
import { PokerPanel } from '@/components/PokerPanel';
import { WheelPanel } from '@/components/WheelPanel';
import { useRoom, type Connection } from '@/hooks/useRoom';
import { rememberRoom, setAdminToken } from '@/lib/client';
import type { RoomState } from '@/lib/types';

type Tab = 'poker' | 'wheel' | 'settings';

const CONNECTION_COPY: Record<Connection, { text: string; color: string }> = {
  connecting: { text: 'Connecting', color: 'var(--color-ink-dim)' },
  live: { text: 'Live', color: 'var(--color-lime)' },
  dropped: { text: 'Reconnecting', color: 'var(--color-gold)' },
  gone: { text: 'Room deleted', color: 'var(--color-rose)' },
};

export function RoomClient({ slug, initialState }: { slug: string; initialState: RoomState }) {
  const router = useRouter();

  // Claim the admin token during the very first render, before useRoom reads
  // localStorage in its mount effect — an effect here would run too late and
  // the creator would land in their own room as an ordinary player.
  useState(() => {
    if (typeof window === 'undefined') return false;
    const token = new URLSearchParams(window.location.search).get('admin');
    if (token) setAdminToken(slug, token);
    return true;
  });

  const room = useRoom(slug, initialState);
  const [tab, setTab] = useState<Tab>('poker');

  // Having claimed it, drop the token from the address bar so a shared
  // screenshot or a copied URL does not hand out admin rights.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('admin')) return;
    params.delete('admin');
    const query = params.toString();
    window.history.replaceState(null, '', `/r/${slug}${query ? `?${query}` : ''}`);
  }, [slug]);

  useEffect(() => {
    rememberRoom({ slug, name: room.state.name, isAdmin: room.isAdmin });
  }, [slug, room.state.name, room.isAdmin]);

  if (room.connection === 'gone') {
    return (
      <main className="grid min-h-dvh place-items-center px-4 text-center">
        <div className="px-panel max-w-[420px] p-8">
          <h1 className="mb-2 text-[22px]">This room is gone</h1>
          <p className="mb-6 text-[color:var(--color-ink-dim)]">
            The admin deleted it. Anything estimated here went with it.
          </p>
          <Link href="/" className="px-btn px-btn-gold">
            Start a new room
          </Link>
        </div>
      </main>
    );
  }

  const status = CONNECTION_COPY[room.connection];
  const tabs: { id: Tab; label: string }[] = [
    { id: 'poker', label: 'Poker' },
    { id: 'wheel', label: 'Wheel' },
    ...(room.isAdmin ? ([{ id: 'settings', label: 'Settings' }] as const) : []),
  ];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1120px] flex-col gap-6 px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" aria-label="Scrumbler home" className="shrink-0">
            <Mark size={40} />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-[22px] leading-tight">{room.state.name}</h1>
            <p className="truncate text-[13px] text-[color:var(--color-ink-dim)]">/r/{slug}</p>
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
          {room.isAdmin && (
            <span className="px-chip" style={{ color: 'var(--color-gold)' }}>
              Admin
            </span>
          )}
        </div>
      </header>

      <nav className="flex gap-2" aria-label="Room sections">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`px-btn ${tab === entry.id ? 'px-btn-gold' : ''}`}
            aria-current={tab === entry.id ? 'page' : undefined}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {room.error && (
        <div
          role="alert"
          className="px-panel flex items-center justify-between gap-4 p-3"
          style={{ background: 'var(--color-rose-deep)' }}
        >
          <span className="text-[14px]">{room.error}</span>
          <button type="button" className="px-btn px-btn-sm" onClick={room.clearError}>
            Dismiss
          </button>
        </div>
      )}

      <main className="flex-1">
        {!room.ready ? (
          <div className="grid min-h-[40vh] place-items-center">
            <p className="font-display px-blink text-[color:var(--color-ink-dim)]">Loading room…</p>
          </div>
        ) : !room.me ? (
          <JoinGate roomName={room.state.name} onJoin={room.join} />
        ) : tab === 'poker' ? (
          <PokerPanel room={room} />
        ) : tab === 'wheel' ? (
          <WheelPanel room={room} />
        ) : (
          <AdminSettings room={room} onDeleted={() => router.push('/')} />
        )}
      </main>

      {room.me && (
        <footer className="flex flex-wrap items-center justify-between gap-3 pt-2 text-[13px] text-[color:var(--color-ink-dim)]">
          <span>
            Seated as <strong className="text-[color:var(--color-ink)]">{room.me.name}</strong>
            {room.me.isSpectator ? ' — watching' : ''}
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              className="px-btn px-btn-sm"
              onClick={() =>
                void room.updateParticipant(room.me!.id, { isSpectator: !room.me!.isSpectator })
              }
            >
              {room.me.isSpectator ? 'Start estimating' : 'Just watch'}
            </button>
            <button type="button" className="px-btn px-btn-sm" onClick={() => void room.leave()}>
              Leave
            </button>
          </span>
        </footer>
      )}
    </div>
  );
}

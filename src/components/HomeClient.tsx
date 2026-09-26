'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Mark } from '@/components/Mark';
import {
  api,
  forgetRoom,
  getRememberedRooms,
  rememberRoom,
  setAdminToken,
  type RememberedRoom,
} from '@/lib/client';
import { cardFontSize, DECK_KEYS, deckLabel, type DeckKey } from '@/lib/decks';
import { snapshot, subscribe } from '@/lib/store';

/** Stable empty list for the server snapshot; a new [] each call would loop. */
const NO_ROOMS: RememberedRoom[] = [];

/** The moment the whole product exists for: five cards turning over together. */
const HERO_CARDS = ['5', '8', '5', '5', '3'];

function HeroFan() {
  const [turned, setTurned] = useState<boolean[]>(() => HERO_CARDS.map(() => false));

  useEffect(() => {
    const timers = HERO_CARDS.map((_, index) =>
      setTimeout(
        () => setTurned((prev) => prev.map((was, i) => (i === index ? true : was))),
        500 + index * 130,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="flex justify-center gap-2 sm:gap-3" aria-hidden>
      {HERO_CARDS.map((value, index) => {
        const isUp = turned[index];
        // A shallow fan: outer cards sit lower, as if laid on a table.
        const lift = [10, 2, 0, 2, 10][index];
        const tilt = [-8, -4, 0, 4, 8][index];
        return (
          <div
            key={index}
            style={{ transform: `translateY(${lift}px) rotate(${tilt}deg)` }}
            className="transition-transform"
          >
            {isUp ? (
              <div
                key="up"
                className="px-flip px-card cursor-default"
                style={{
                  background: value === '5' ? 'var(--color-gold)' : 'var(--color-panel-hi)',
                  color: value === '5' ? 'var(--color-void-deep)' : 'var(--color-ink)',
                  fontSize: cardFontSize(value),
                }}
              >
                {value}
              </div>
            ) : (
              <div className="px-card px-card-back cursor-default" />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function HomeClient() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [deckKey, setDeckKey] = useState<DeckKey>('fibonacci');
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // forgetRoom() writes to localStorage, which invalidates this snapshot — no
  // manual refresh needed after removing one.
  const rooms = useSyncExternalStore(
    subscribe,
    () => snapshot('rooms', getRememberedRooms),
    () => NO_ROOMS,
  );

  const create = async () => {
    const roomName = name.trim();
    if (!roomName || busy) return;
    setBusy(true);
    setError(null);
    try {
      const room = await api<{ slug: string; name: string; adminToken: string }>('/api/rooms', {
        method: 'POST',
        body: {
          name: roomName,
          deckKey,
          wheelNames: team
            .split(',')
            .map((n) => n.trim())
            .filter(Boolean),
        },
      });
      setAdminToken(room.slug, room.adminToken);
      rememberRoom({ slug: room.slug, name: room.name, isAdmin: true });
      router.push(`/r/${room.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the room');
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 py-10 md:px-6 md:py-16">
      <header className="mb-12 text-center">
        <div className="mb-6 flex items-center justify-center gap-3">
          <Mark size={44} />
          <span className="font-display text-[34px] font-bold leading-none tracking-[0.02em]">
            Scrumbler
          </span>
        </div>

        <HeroFan />

        <h1 className="mx-auto mt-10 max-w-[19ch] text-[28px] leading-tight sm:text-[36px]">
          Estimate together, then spin for who runs tomorrow.
        </h1>
        <p className="mx-auto mt-4 max-w-[52ch] text-[color:var(--color-ink-dim)]">
          A permanent room your team can bookmark. Players just open the link and pick a card —
          nobody signs up for anything.
        </p>
      </header>

      <section className="px-panel mb-10 p-6" aria-labelledby="create-heading">
        <h2 id="create-heading" className="mb-5 text-[20px]">
          Create a room
        </h2>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label className="px-label" htmlFor="room-name">
            Room name
          </label>
          <input
            id="room-name"
            className="px-input mb-5"
            placeholder="Platform squad"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
          />

          <span className="px-label">Deck</span>
          <div className="mb-5 flex flex-wrap gap-2">
            {DECK_KEYS.filter((key) => key !== 'custom').map((key) => (
              <button
                key={key}
                type="button"
                className={`px-btn px-btn-sm ${deckKey === key ? 'px-btn-gold' : ''}`}
                aria-pressed={deckKey === key}
                onClick={() => setDeckKey(key)}
              >
                {deckLabel(key)}
              </button>
            ))}
          </div>

          <label className="px-label" htmlFor="team">
            Who is in the daily rotation? Optional, and you can edit it later.
          </label>
          <input
            id="team"
            className="px-input mb-6"
            placeholder="Ana, Bo, Kim, Sam"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          />

          {error && (
            <p role="alert" className="mb-4 text-[14px] text-[color:var(--color-rose)]">
              {error}
            </p>
          )}

          <button type="submit" className="px-btn px-btn-gold" disabled={!name.trim() || busy}>
            {busy ? 'Creating…' : 'Create room'}
          </button>
          <p className="mt-3 text-[13px] text-[color:var(--color-ink-dim)]">
            You become this room&rsquo;s admin. Keep the admin link — it is what lets you change
            settings and spin the wheel.
          </p>
        </form>
      </section>

      {rooms.length > 0 && (
        <section aria-labelledby="rooms-heading">
          <h2 id="rooms-heading" className="mb-4 text-[20px]">
            Rooms you have opened
          </h2>
          <ul className="flex flex-col gap-2">
            {rooms.map((room) => (
              <li key={room.slug} className="px-panel flex items-center justify-between gap-3 p-3">
                <Link href={`/r/${room.slug}`} className="min-w-0 flex-1">
                  <span className="font-display block truncate text-[16px]">{room.name}</span>
                  <span className="block truncate text-[13px] text-[color:var(--color-ink-dim)]">
                    /r/{room.slug}
                  </span>
                </Link>
                {room.isAdmin && (
                  <span className="px-chip shrink-0" style={{ color: 'var(--color-gold)' }}>
                    Admin
                  </span>
                )}
                <button
                  type="button"
                  className="px-btn px-btn-sm shrink-0"
                  onClick={() => forgetRoom(room.slug)}
                  aria-label={`Forget ${room.name} on this device`}
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-[color:var(--color-ink-dim)]">
            This list lives in this browser only. Forgetting a room also drops its admin token from
            this device.
          </p>
        </section>
      )}
    </div>
  );
}

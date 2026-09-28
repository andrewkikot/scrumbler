'use client';

/**
 * The super-admin console.
 *
 * Rooms are permanent by design — nobody signs up, nobody cleans up, and a year
 * of standups leaves a long tail of rooms whose admin tokens live in a laptop
 * that has since been reimaged. This is the one screen that can see all of them
 * and delete them, gated by the deployment's super-admin key.
 *
 * The key is read straight out of sessionStorage through the same store the rest
 * of the app uses, so it is never copied into React state: unlocking in one tab
 * does not silently unlock another, and closing the tab puts the key away.
 */

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Mark } from '@/components/Mark';
import { getSuperAdminKey, setSuperAdminKey } from '@/lib/client';
import { onClient, onServer, subscribe } from '@/lib/store';
import { ADMIN_DELETE_LIMIT, type AdminRoomList, type AdminRoomRow } from '@/lib/types';

/** Mirrors SUPER_ADMIN_HEADER; the module that owns it stays server-side. */
const KEY_HEADER = 'x-super-admin-key';
const PAGE_SIZE = 50;
const DAY_MS = 86_400_000;

/** Idle for this long and the row says so out loud. */
const STALE_DAYS = 30;

const IDLE_CHOICES = [
  { label: 'Any age', value: '' },
  { label: 'Idle 7d+', value: '7' },
  { label: 'Idle 30d+', value: '30' },
  { label: 'Idle 90d+', value: '90' },
  { label: 'Idle 180d+', value: '180' },
] as const;

const SORT_CHOICES = [
  { label: 'Last used', value: 'activity' },
  { label: 'Created', value: 'created' },
  { label: 'Name', value: 'name' },
] as const;

type Sort = (typeof SORT_CHOICES)[number]['value'];

class AdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function adminFetch<T>(
  path: string,
  key: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { [KEY_HEADER]: key };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((d: { error?: string }) => d.error)
      .catch(() => null);
    throw new AdminError(detail ?? `Request failed (${response.status})`, response.status);
  }

  return response.json() as Promise<T>;
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "3 days ago", against the server's clock so it agrees with the age filter. */
function ago(iso: string | null, now: number): string {
  if (!iso) return 'never';
  const delta = Date.parse(iso) - now;
  const days = Math.round(delta / DAY_MS);
  if (Math.abs(days) >= 1) return RELATIVE.format(days, 'day');
  const hours = Math.round(delta / 3_600_000);
  if (Math.abs(hours) >= 1) return RELATIVE.format(hours, 'hour');
  const minutes = Math.round(delta / 60_000);
  if (Math.abs(minutes) >= 1) return RELATIVE.format(minutes, 'minute');
  return 'just now';
}

const idleDays = (row: AdminRoomRow, now: number) =>
  Math.floor((now - Date.parse(row.updatedAt)) / DAY_MS);

const exact = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function KeyGate({ error, onSubmit }: { error: string | null; onSubmit: (key: string) => void }) {
  const [draft, setDraft] = useState('');

  return (
    <div className="mx-auto w-full max-w-[520px] px-4 py-16">
      <div className="mb-8 flex items-center justify-center gap-3">
        <Mark size={40} />
        <span className="font-display text-[28px] font-bold leading-none tracking-[0.02em]">
          Scrumbler
        </span>
      </div>

      <form
        className="px-panel p-6"
        onSubmit={(e) => {
          e.preventDefault();
          const key = draft.trim();
          if (key) onSubmit(key);
        }}
      >
        <h1 className="mb-2 text-[22px]">Super admin</h1>
        <p className="mb-5 text-[14px] text-[color:var(--color-ink-dim)]">
          Every room on this deployment, and the ability to delete any of them. Paste the value of
          the server&rsquo;s <span className="font-semibold">SCRUMBLER_SUPER_ADMIN_KEY</span>.
        </p>

        <label className="px-label" htmlFor="super-key">
          Super-admin key
        </label>
        <input
          id="super-key"
          className="px-input mb-5"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />

        {error && (
          <p role="alert" className="mb-4 text-[14px] text-[color:var(--color-rose)]">
            {error}
          </p>
        )}

        <button type="submit" className="px-btn px-btn-gold" disabled={!draft.trim()}>
          Unlock
        </button>
        <p className="mt-3 text-[13px] text-[color:var(--color-ink-dim)]">
          Kept in this tab only — closing it forgets the key.
        </p>
      </form>

      <p className="mt-6 text-center text-[13px]">
        <Link href="/" className="text-[color:var(--color-ink-dim)] underline">
          Back to Scrumbler
        </Link>
      </p>
    </div>
  );
}

export function SuperAdminConsole() {
  // Read from sessionStorage rather than copying it into state in an effect —
  // the same trick useRoom() uses for the per-room admin token.
  const ready = useSyncExternalStore(subscribe, onClient, onServer);
  const key = useSyncExternalStore(subscribe, getSuperAdminKey, () => null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  /** Which delete is waiting on a second click: one slug, or the whole selection. */
  const [confirming, setConfirming] = useState<'selection' | string | null>(null);

  // The applied query, kept apart from what is being typed: the list reloads
  // when these change, and nobody wants a request per keystroke.
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [idle, setIdle] = useState('');
  const [sort, setSort] = useState<Sort>('activity');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [offset, setOffset] = useState(0);
  /** Bumped to re-run the same query — Refresh, and after a delete lands. */
  const [reloads, setReloads] = useState(0);

  const params = new URLSearchParams({
    sort,
    order,
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (search) params.set('q', search);
  if (idle) params.set('idleDays', idle);
  const path = `/api/admin/rooms?${params}`;
  const queryKey = `${reloads}|${path}`;

  /**
   * The last answer we got, tagged with the query that produced it. Loading is
   * then a derivation — "what is on screen is not what was asked for" — instead
   * of a flag that has to be set before an await and cleared after it.
   */
  const [loaded, setLoaded] = useState<{ queryKey: string; data: AdminRoomList | null } | null>(
    null,
  );
  const loading = Boolean(key) && loaded?.queryKey !== queryKey;

  useEffect(() => {
    if (!key) return;
    const attempt = new AbortController();

    adminFetch<AdminRoomList>(path, key, { signal: attempt.signal })
      .then((data) => {
        setLoaded({ queryKey, data });
        setError(null);
      })
      .catch((cause: unknown) => {
        if (attempt.signal.aborted) return;
        // A rejected key drops back to the gate rather than retrying on 403.
        if (cause instanceof AdminError && cause.status === 403) setSuperAdminKey(null);
        setLoaded({ queryKey, data: null });
        setError(cause instanceof Error ? cause.message : 'Could not load the room list');
      });

    return () => attempt.abort();
  }, [key, path, queryKey]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const lock = () => {
    setSuperAdminKey(null);
    setLoaded(null);
    setSelected(new Set());
    setError(null);
  };

  /** Anything that changes the result set sends you back to the first page. */
  const changeFilter = (apply: () => void) => {
    setOffset(0);
    apply();
  };

  const data = loaded?.data ?? null;
  const rooms = data?.rooms ?? [];
  // The server's clock, so nothing here depends on an impure read at render.
  const now = data ? Date.parse(data.now) : 0;
  const total = data?.total ?? 0;

  // Selections are filtered down to what is actually listed, so the count on the
  // delete button always matches what you can see.
  const visible = new Set(rooms.map((room) => room.slug));
  const marked = [...selected].filter((slug) => visible.has(slug));
  const allOnPageSelected = rooms.length > 0 && rooms.every((room) => selected.has(room.slug));

  const toggle = (slug: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const toggleAllOnPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const room of rooms) {
        if (allOnPageSelected) next.delete(room.slug);
        else next.add(room.slug);
      }
      return next;
    });

  const runDelete = async (slugs: string[]) => {
    if (busy || slugs.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (slugs.length === 1) {
        await adminFetch(`/api/admin/rooms/${encodeURIComponent(slugs[0])}`, key ?? '', {
          method: 'DELETE',
        });
        setNotice(`Deleted ${slugs[0]}.`);
      } else {
        const result = await adminFetch<{ deleted: number }>('/api/admin/rooms', key ?? '', {
          method: 'DELETE',
          body: { slugs },
        });
        setNotice(`Deleted ${plural(result.deleted, 'room')}.`);
      }
      setSelected((prev) => {
        const next = new Set(prev);
        for (const slug of slugs) next.delete(slug);
        return next;
      });
      setConfirming(null);
      setReloads((n) => n + 1);
    } catch (cause) {
      if (cause instanceof AdminError && cause.status === 403) setSuperAdminKey(null);
      setError(cause instanceof Error ? cause.message : 'Could not delete');
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <p className="p-8 text-[color:var(--color-ink-dim)]">Loading…</p>;
  if (!key) return <KeyGate error={error} onSubmit={(next) => setSuperAdminKey(next)} />;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-8 md:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <Mark size={32} />
            <h1 className="text-[24px]">All rooms</h1>
          </div>
          <p className="max-w-[62ch] text-[13px] text-[color:var(--color-ink-dim)]">
            {plural(total, 'room')} match this filter. Deleting one takes its participants, rounds,
            votes, wheel and spin history with it — the URL stops working for everyone.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/" className="px-btn px-btn-sm">
            Home
          </Link>
          <button type="button" className="px-btn px-btn-sm" onClick={lock}>
            Lock console
          </button>
        </div>
      </header>

      <section className="px-panel mb-5 p-4" aria-label="Filters">
        <div className="flex flex-wrap items-end gap-5">
          <form
            className="min-w-[220px] flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              changeFilter(() => setSearch(searchDraft.trim()));
            }}
          >
            <label className="px-label" htmlFor="room-search">
              Search name or slug
            </label>
            <div className="flex gap-2">
              <input
                id="room-search"
                className="px-input"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="platform"
                maxLength={60}
              />
              <button type="submit" className="px-btn px-btn-sm shrink-0">
                Find
              </button>
            </div>
          </form>

          <div>
            <span className="px-label">Age</span>
            <div className="flex flex-wrap gap-2">
              {IDLE_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className={`px-btn px-btn-sm ${idle === choice.value ? 'px-btn-gold' : ''}`}
                  aria-pressed={idle === choice.value}
                  onClick={() => changeFilter(() => setIdle(choice.value))}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="px-label">Sort by</span>
            <div className="flex flex-wrap gap-2">
              {SORT_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className={`px-btn px-btn-sm ${sort === choice.value ? 'px-btn-gold' : ''}`}
                  aria-pressed={sort === choice.value}
                  onClick={() => changeFilter(() => setSort(choice.value))}
                >
                  {choice.label}
                </button>
              ))}
              <button
                type="button"
                className="px-btn px-btn-sm"
                onClick={() => changeFilter(() => setOrder(order === 'desc' ? 'asc' : 'desc'))}
              >
                {order === 'desc' ? 'Newest first' : 'Oldest first'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="px-btn px-btn-sm"
          onClick={() => setReloads((n) => n + 1)}
          disabled={loading || busy}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>

        {marked.length > 0 &&
          (confirming === 'selection' ? (
            <>
              <button
                type="button"
                className="px-btn px-btn-sm px-btn-danger"
                disabled={busy}
                onClick={() => void runDelete(marked.slice(0, ADMIN_DELETE_LIMIT))}
              >
                {busy ? 'Deleting…' : `Yes, delete ${plural(marked.length, 'room')}`}
              </button>
              <button
                type="button"
                className="px-btn px-btn-sm"
                onClick={() => setConfirming(null)}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="px-btn px-btn-sm px-btn-danger"
                onClick={() => setConfirming('selection')}
              >
                Delete {marked.length} selected
              </button>
              <button
                type="button"
                className="px-btn px-btn-sm"
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </button>
            </>
          ))}

        {marked.length > ADMIN_DELETE_LIMIT && (
          <span className="text-[13px] text-[color:var(--color-rose)]">
            One delete carries at most {ADMIN_DELETE_LIMIT} rooms.
          </span>
        )}

        {notice && (
          <span role="status" className="text-[13px] text-[color:var(--color-teal)]">
            {notice}
          </span>
        )}
        {error && (
          <span role="alert" className="text-[13px] text-[color:var(--color-rose)]">
            {error}
          </span>
        )}
      </div>

      <div className="px-panel overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="bg-[color:var(--color-panel-hi)]">
              <th scope="col" className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[color:var(--color-gold)]"
                  checked={allOnPageSelected}
                  onChange={toggleAllOnPage}
                  disabled={rooms.length === 0}
                  aria-label="Select every room on this page"
                />
              </th>
              <th scope="col" className="px-3 py-3 text-[13px] font-semibold">
                Room
              </th>
              <th scope="col" className="px-3 py-3 text-[13px] font-semibold">
                Last used
              </th>
              <th scope="col" className="px-3 py-3 text-[13px] font-semibold">
                Created
              </th>
              <th scope="col" className="px-3 py-3 text-[13px] font-semibold">
                Last seen
              </th>
              <th scope="col" className="px-3 py-3 text-right text-[13px] font-semibold">
                People
              </th>
              <th scope="col" className="px-3 py-3 text-right text-[13px] font-semibold">
                Rounds
              </th>
              <th scope="col" className="px-3 py-3 text-right text-[13px] font-semibold">
                Spins
              </th>
              <th scope="col" className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {rooms.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-[color:var(--color-ink-dim)]">
                  {loading ? 'Loading…' : error ? 'Nothing loaded.' : 'No rooms match this filter.'}
                </td>
              </tr>
            )}

            {rooms.map((room) => {
              const idleFor = idleDays(room, now);
              const isConfirming = confirming === room.slug;
              return (
                <tr key={room.slug} className="border-t-2 border-[color:var(--color-edge-dark)]">
                  <td className="px-3 py-3 align-top">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-[color:var(--color-gold)]"
                      checked={selected.has(room.slug)}
                      onChange={() => toggle(room.slug)}
                      aria-label={`Select ${room.name}`}
                    />
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">{room.name}</span>
                      {room.version === 0 && <span className="px-chip">never used</span>}
                      {idleFor >= STALE_DAYS && (
                        <span className="px-chip" style={{ color: 'var(--color-rose)' }}>
                          idle {idleFor}d
                        </span>
                      )}
                    </span>
                    <a
                      href={`/r/${room.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[13px] text-[color:var(--color-ink-dim)] underline"
                    >
                      /r/{room.slug}
                    </a>
                  </td>
                  <td
                    className="px-3 py-3 align-top text-[13px] whitespace-nowrap"
                    title={exact(room.updatedAt)}
                  >
                    {ago(room.updatedAt, now)}
                  </td>
                  <td
                    className="px-3 py-3 align-top text-[13px] whitespace-nowrap text-[color:var(--color-ink-dim)]"
                    title={exact(room.createdAt)}
                  >
                    {ago(room.createdAt, now)}
                  </td>
                  <td
                    className="px-3 py-3 align-top text-[13px] whitespace-nowrap text-[color:var(--color-ink-dim)]"
                    title={exact(room.lastSeenAt)}
                  >
                    {ago(room.lastSeenAt, now)}
                  </td>
                  <td className="px-numeral px-3 py-3 text-right align-top text-[14px]">
                    {room.counts.participants}
                  </td>
                  <td className="px-numeral px-3 py-3 text-right align-top text-[14px]">
                    {room.counts.rounds}
                  </td>
                  <td className="px-numeral px-3 py-3 text-right align-top text-[14px]">
                    {room.counts.spins}
                  </td>
                  <td className="px-3 py-3 text-right align-top whitespace-nowrap">
                    {isConfirming ? (
                      <span className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="px-btn px-btn-sm px-btn-danger"
                          disabled={busy}
                          onClick={() => void runDelete([room.slug])}
                        >
                          {busy ? 'Deleting…' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          className="px-btn px-btn-sm"
                          onClick={() => setConfirming(null)}
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="px-btn px-btn-sm px-btn-danger"
                        onClick={() => setConfirming(room.slug)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Pagination">
          <button
            type="button"
            className="px-btn px-btn-sm"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </button>
          <span className="px-numeral text-[13px] text-[color:var(--color-ink-dim)]">
            {Math.min(offset + 1, total)}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button
            type="button"
            className="px-btn px-btn-sm"
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

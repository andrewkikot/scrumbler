'use client';

/**
 * Browser-side identity and bookkeeping.
 *
 * There is no sign-up anywhere in Scrumbler. A player is just a `clientId`
 * minted in localStorage, and an admin is whoever holds a room's token — also
 * kept in localStorage, so the person who created the room keeps their powers
 * across refreshes without ever making an account.
 */

import { invalidate } from './store';

const CLIENT_ID_KEY = 'scrumbler:clientId';
const NAME_KEY = 'scrumbler:name';
const ADMIN_PREFIX = 'scrumbler:admin:';
const PARTICIPANT_PREFIX = 'scrumbler:pid:';
const ROOMS_KEY = 'scrumbler:rooms';

export type RememberedRoom = {
  slug: string;
  name: string;
  isAdmin: boolean;
  visitedAt: number;
};

function read(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode / blocked storage — the app still works, it just forgets.
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
  invalidate();
}

function remove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  invalidate();
}

/** Stable per-browser id. Created on first use. */
export function getClientId(): string {
  const existing = read(CLIENT_ID_KEY);
  if (existing) return existing;
  const fresh =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  write(CLIENT_ID_KEY, fresh);
  return fresh;
}

export const getDisplayName = () => read(NAME_KEY) ?? '';
export const setDisplayName = (name: string) => write(NAME_KEY, name);

export const getAdminToken = (slug: string) => read(`${ADMIN_PREFIX}${slug}`);
export const setAdminToken = (slug: string, token: string) => write(`${ADMIN_PREFIX}${slug}`, token);
export const clearAdminToken = (slug: string) => remove(`${ADMIN_PREFIX}${slug}`);

/**
 * Which Participant row this browser is, per room. Lets a refresh find your own
 * seat again without re-joining, and without the server ever sending clientIds
 * to other players.
 */
export const getParticipantId = (slug: string) => read(`${PARTICIPANT_PREFIX}${slug}`);
export const setParticipantId = (slug: string, id: string) => write(`${PARTICIPANT_PREFIX}${slug}`, id);

/** Rooms this browser has opened, newest first — the home page's room list. */
export function getRememberedRooms(): RememberedRoom[] {
  const raw = read(ROOMS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as RememberedRoom[])
      .filter((r) => typeof r?.slug === 'string')
      .sort((a, b) => b.visitedAt - a.visitedAt);
  } catch {
    return [];
  }
}

export function rememberRoom(room: { slug: string; name: string; isAdmin: boolean }): void {
  const rooms = getRememberedRooms().filter((r) => r.slug !== room.slug);
  rooms.unshift({ ...room, visitedAt: Date.now() });
  write(ROOMS_KEY, JSON.stringify(rooms.slice(0, 12)));
}

export function forgetRoom(slug: string): void {
  write(ROOMS_KEY, JSON.stringify(getRememberedRooms().filter((r) => r.slug !== slug)));
  clearAdminToken(slug);
}

/** fetch() wrapper that attaches the admin token and unwraps API errors. */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; slug?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'x-client-id': getClientId() };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const token = options.slug ? getAdminToken(options.slug) : null;
  if (token) headers['x-admin-token'] = token;

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((d: { error?: string }) => d.error)
      .catch(() => null);
    throw new Error(detail ?? `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

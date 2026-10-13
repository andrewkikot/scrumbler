'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  api,
  getAdminToken,
  getClientId,
  getParticipantId,
  setParticipantId as persistParticipantId,
} from '@/lib/client';
import { onClient, onServer, snapshot, subscribe } from '@/lib/store';
import type { TimerAction } from '@/lib/timer';
import type { ParticipantView, RoomState } from '@/lib/types';

export type Connection = 'connecting' | 'live' | 'dropped' | 'gone';

/** Presence ping cadence. Comfortably inside ONLINE_WINDOW_MS (45s). */
const HEARTBEAT_MS = 18_000;

export type RoomController = {
  state: RoomState;
  connection: Connection;
  /** False until localStorage has been read, so the UI never flashes a join form. */
  ready: boolean;
  isAdmin: boolean;
  /**
   * True on the watch page. Every action is then a no-op, and components hide
   * the controls rather than offer buttons that do nothing.
   */
  readOnly: boolean;
  /**
   * Server clock minus this browser's, in ms. Add it to `Date.now()` to count
   * down against the same clock as everyone else.
   */
  clockOffset: number;
  /** Your own row in the participant list, once you have joined. */
  me: ParticipantView | null;
  error: string | null;
  clearError: () => void;
  join: (name: string, isSpectator?: boolean) => Promise<void>;
  leave: () => Promise<void>;
  vote: (value: string | null) => Promise<void>;
  round: (
    action: 'reveal' | 'hide' | 'clear' | 'next' | 'topic',
    topic?: string | null,
  ) => Promise<void>;
  updateRoom: (patch: Record<string, unknown>) => Promise<void>;
  updateParticipant: (id: string, patch: Record<string, unknown>) => Promise<void>;
  removeParticipant: (id: string) => Promise<void>;
  addWheelNames: (labels: string[]) => Promise<void>;
  syncWheelFromRoom: () => Promise<void>;
  updateWheelEntry: (id: string, patch: Record<string, unknown>) => Promise<void>;
  removeWheelEntry: (id: string) => Promise<void>;
  spin: () => Promise<void>;
  /** Ask the server to take the winner off the wheel, now the wheel has stopped. */
  settleSpin: () => Promise<void>;
  timer: (input: TimerAction) => Promise<void>;
  deleteRoom: () => Promise<void>;
};

/**
 * The push channel and the snapshot it feeds, shared by the player and the
 * watcher. Only the URL differs between them — and whether it says who is
 * asking, which a player does to see their own card before the reveal.
 */
function useRoomStream(initial: RoomState, path: string, identify: boolean) {
  const [state, setState] = useState<RoomState>(initial);
  const [connection, setConnection] = useState<Connection>('connecting');
  // Zero until the first frame arrives from the browser's side of the wire:
  // the server-rendered snapshot is too old by page-load time to measure with.
  const [clockOffset, setClockOffset] = useState(0);

  // Guards against a slow POST response overwriting a newer SSE frame.
  const versionRef = useRef(initial.version);

  const applyState = useCallback((next: RoomState) => {
    if (next.version < versionRef.current) return;
    versionRef.current = next.version;
    setState(next);
    setClockOffset(next.serverNow - Date.now());
  }, []);

  // ---- the push channel ---------------------------------------------------
  useEffect(() => {
    const source = new EventSource(
      identify ? `${path}?clientId=${encodeURIComponent(getClientId())}` : path,
    );
    let closedByUs = false;

    source.addEventListener('open', () => setConnection('live'));

    source.addEventListener('state', (event) => {
      try {
        applyState(JSON.parse((event as MessageEvent<string>).data) as RoomState);
        setConnection('live');
      } catch {
        /* one malformed frame is not worth tearing the connection down */
      }
    });

    source.addEventListener('gone', () => {
      closedByUs = true;
      setConnection('gone');
      source.close();
    });

    // EventSource reconnects on its own (the server sends `retry: 2000`);
    // we only reflect the gap in the UI.
    source.addEventListener('error', () => {
      if (!closedByUs) setConnection((current) => (current === 'gone' ? current : 'dropped'));
    });

    return () => {
      closedByUs = true;
      source.close();
    };
  }, [path, identify, applyState]);

  return { state, connection, clockOffset, applyState };
}

/**
 * Subscribes to a room over Server-Sent Events and exposes every mutation as a
 * plain async function.
 *
 * The transport is sealed inside this hook on purpose: routes POST, the stream
 * pushes, and no component knows how updates arrive. Swapping SSE for real
 * WebSockets later is a change to this file alone.
 */
export function useRoom(slug: string, initial: RoomState): RoomController {
  const { state, connection, clockOffset, applyState } = useRoomStream(
    initial,
    `/api/rooms/${slug}/stream`,
    true,
  );
  const [error, setError] = useState<string | null>(null);
  // Read straight from localStorage rather than copying it into state in an
  // effect — this also keeps two tabs of the same room in step.
  const ready = useSyncExternalStore(subscribe, onClient, onServer);
  const adminToken = useSyncExternalStore(
    subscribe,
    () => snapshot(`admin:${slug}`, () => getAdminToken(slug)),
    () => null,
  );
  const participantId = useSyncExternalStore(
    subscribe,
    () => snapshot(`pid:${slug}`, () => getParticipantId(slug)),
    () => null,
  );

  // Writing invalidates the store, which re-runs the snapshot above.
  const rememberSeat = useCallback((id: string) => persistParticipantId(slug, id), [slug]);

  // ---- presence -----------------------------------------------------------
  useEffect(() => {
    const ping = async () => {
      try {
        const result = await api<{ known: boolean; participantId: string | null }>(
          `/api/rooms/${slug}/heartbeat`,
          { method: 'POST', body: { clientId: getClientId() } },
        );
        // Recovers your seat after a refresh, or after an admin kicked and you
        // re-joined from another tab.
        if (result.participantId) rememberSeat(result.participantId);
      } catch {
        /* a missed ping just shows you as away for a moment */
      }
    };

    void ping();
    const timer = setInterval(() => void ping(), HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void ping();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [slug, rememberSeat]);

  const run = useCallback(
    async (work: () => Promise<RoomState | undefined>) => {
      try {
        const next = await work();
        if (next) applyState(next);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      }
    },
    [applyState],
  );

  const me = useMemo(
    () => state.participants.find((p) => p.id === participantId) ?? null,
    [state.participants, participantId],
  );

  const actions = useMemo(
    () => ({
      join: (name: string, isSpectator?: boolean) =>
        run(async () => {
          const result = await api<{ participantId: string; state: RoomState }>(
            `/api/rooms/${slug}/join`,
            { method: 'POST', body: { clientId: getClientId(), name, isSpectator }, slug },
          );
          rememberSeat(result.participantId);
          return result.state;
        }),

      leave: () =>
        run(async () => {
          if (!participantId) return undefined;
          const result = await api<{ state?: RoomState }>(
            `/api/rooms/${slug}/participants/${participantId}?clientId=${encodeURIComponent(getClientId())}`,
            { method: 'DELETE', slug },
          );
          return result.state;
        }),

      vote: (value: string | null) =>
        run(() =>
          api<RoomState>(`/api/rooms/${slug}/vote`, {
            method: 'POST',
            body: { clientId: getClientId(), value },
            slug,
          }),
        ),

      round: (action: 'reveal' | 'hide' | 'clear' | 'next' | 'topic', topic?: string | null) =>
        run(() =>
          api<RoomState>(`/api/rooms/${slug}/round`, {
            method: 'POST',
            body: { action, topic },
            slug,
          }),
        ),

      updateRoom: (patch: Record<string, unknown>) =>
        run(() => api<RoomState>(`/api/rooms/${slug}`, { method: 'PATCH', body: patch, slug })),

      updateParticipant: (id: string, patch: Record<string, unknown>) =>
        run(() =>
          api<RoomState>(`/api/rooms/${slug}/participants/${id}`, {
            method: 'PATCH',
            body: { clientId: getClientId(), ...patch },
            slug,
          }),
        ),

      removeParticipant: (id: string) =>
        run(async () => {
          const result = await api<{ state?: RoomState }>(
            `/api/rooms/${slug}/participants/${id}?clientId=${encodeURIComponent(getClientId())}`,
            { method: 'DELETE', slug },
          );
          return result.state;
        }),

      addWheelNames: (labels: string[]) =>
        run(async () => {
          const result = await api<{ state: RoomState }>(`/api/rooms/${slug}/wheel`, {
            method: 'POST',
            body: { labels },
            slug,
          });
          return result.state;
        }),

      syncWheelFromRoom: () =>
        run(async () => {
          const result = await api<{ state: RoomState }>(`/api/rooms/${slug}/wheel`, {
            method: 'POST',
            body: { syncFromParticipants: true },
            slug,
          });
          return result.state;
        }),

      updateWheelEntry: (id: string, patch: Record<string, unknown>) =>
        run(() =>
          api<RoomState>(`/api/rooms/${slug}/wheel/${id}`, { method: 'PATCH', body: patch, slug }),
        ),

      removeWheelEntry: (id: string) =>
        run(() => api<RoomState>(`/api/rooms/${slug}/wheel/${id}`, { method: 'DELETE', slug })),

      spin: () => run(() => api<RoomState>(`/api/rooms/${slug}/spin`, { method: 'POST', slug })),

      settleSpin: () =>
        run(() => api<RoomState>(`/api/rooms/${slug}/spin/settle`, { method: 'POST', slug })),

      timer: (input: TimerAction) =>
        run(() =>
          api<RoomState>(`/api/rooms/${slug}/timer`, { method: 'POST', body: input, slug }),
        ),

      deleteRoom: () =>
        run(async () => {
          await api(`/api/rooms/${slug}`, { method: 'DELETE', slug });
          return undefined;
        }),
    }),
    [slug, run, rememberSeat, participantId],
  );

  return {
    state,
    connection,
    ready,
    isAdmin: Boolean(adminToken),
    readOnly: false,
    clockOffset,
    me,
    error,
    clearError: () => setError(null),
    ...actions,
  };
}

const nothing = async () => {};

/**
 * The room through a watch link: the same stream and snapshot, no seat, no
 * presence ping (a watcher is not at the table), and nothing to call. The
 * server would refuse every write anyway — a watcher never learns the slug the
 * write routes live under — so these are no-ops rather than requests.
 */
export function useWatchedRoom(token: string, initial: RoomState): RoomController {
  const { state, connection, clockOffset } = useRoomStream(
    initial,
    `/api/watch/${encodeURIComponent(token)}/stream`,
    false,
  );
  return {
    state,
    connection,
    ready: true,
    isAdmin: false,
    readOnly: true,
    clockOffset,
    me: null,
    error: null,
    clearError: () => {},
    join: nothing,
    leave: nothing,
    vote: nothing,
    round: nothing,
    updateRoom: nothing,
    updateParticipant: nothing,
    removeParticipant: nothing,
    addWheelNames: nothing,
    syncWheelFromRoom: nothing,
    updateWheelEntry: nothing,
    removeWheelEntry: nothing,
    spin: nothing,
    settleSpin: nothing,
    timer: nothing,
    deleteRoom: nothing,
  };
}

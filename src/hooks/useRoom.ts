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
import { SINCE_PARAM, STREAM_PROTOCOL, STREAM_PROTOCOL_PARAM } from '@/lib/stream-protocol';
import type { TimerAction } from '@/lib/timer';
import type { ParticipantView, RoomState } from '@/lib/types';

export type Connection = 'connecting' | 'live' | 'dropped' | 'paused' | 'kicked' | 'gone';

/** Presence ping cadence. Comfortably inside ONLINE_WINDOW_MS (45s). */
const HEARTBEAT_MS = 18_000;

/**
 * An open stream keeps a Vercel function running the whole time, whether or
 * not anything happens, and that runtime is what the plan bills. So the stream
 * only stays up while someone could be looking: it drops when the tab is
 * hidden, and after this long with no change in the room and no input here.
 */
const IDLE_MS = 10 * 60_000;
const IDLE_CHECK_MS = 30_000;

const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

export type RoomController = {
  state: RoomState;
  connection: Connection;
  /** Reopen the live stream after it paused for being idle. */
  resume: () => void;
  /** Start a new session after the super admin disconnected this room. */
  reconnect: () => void;
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

  // ---- when the stream may stay open --------------------------------------
  const [visible, setVisible] = useState(isVisible);
  const [idle, setIdle] = useState(false);
  const idleRef = useRef(false);
  /** Last room change or local input; the idle clock counts from here. */
  const lastActivityRef = useRef(0);
  /** A running timer counts as activity until it ends. */
  const timerEndsRef = useRef<number | null>(initial.timer?.endsAt ?? null);

  // ---- the super admin's disconnect ---------------------------------------
  /** Server time this session began; a disconnect after it stops this tab. */
  const sinceRef = useRef(initial.serverNow);
  const kickedAtRef = useRef(0);
  const [kicked, setKicked] = useState(false);

  const getSince = useCallback(() => sinceRef.current, []);

  const kick = useCallback((at: number) => {
    kickedAtRef.current = Math.max(kickedAtRef.current, at);
    setKicked(true);
  }, []);

  /** Start a new session after a disconnect. Only the Reconnect button does this. */
  const reconnect = useCallback(() => {
    sinceRef.current = Math.max(sinceRef.current, kickedAtRef.current);
    lastActivityRef.current = Date.now();
    setKicked(false);
    setConnection((current) => (current === 'gone' ? current : 'connecting'));
  }, []);

  const applyState = useCallback((next: RoomState) => {
    if (next.version < versionRef.current) return;
    if (next.version > versionRef.current) lastActivityRef.current = Date.now();
    versionRef.current = next.version;
    timerEndsRef.current = next.timer?.endsAt ?? null;
    setState(next);
    setClockOffset(next.serverNow - Date.now());
  }, []);

  /** Reopen an idle stream. Any click or key press here does this too. */
  const resume = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (!idleRef.current) return;
    idleRef.current = false;
    setIdle(false);
    setConnection((current) => (current === 'gone' ? current : 'connecting'));
  }, []);

  useEffect(() => {
    lastActivityRef.current = Date.now();

    const onVisibility = () => {
      const now = isVisible();
      if (now) {
        // Coming back is activity: don't let the idle clock close it at once.
        lastActivityRef.current = Date.now();
        idleRef.current = false;
        setIdle(false);
        setConnection((current) => (current === 'gone' ? current : 'connecting'));
      }
      setVisible(now);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);

    const check = setInterval(() => {
      const busyUntil = Math.max(lastActivityRef.current, timerEndsRef.current ?? 0);
      if (!idleRef.current && Date.now() - busyUntil > IDLE_MS) {
        idleRef.current = true;
        setIdle(true);
      }
    }, IDLE_CHECK_MS);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
      clearInterval(check);
    };
  }, [resume]);

  const streaming = visible && !idle && !kicked && connection !== 'gone';

  // ---- the push channel ---------------------------------------------------
  useEffect(() => {
    if (!streaming) return;

    const query = new URLSearchParams({
      [STREAM_PROTOCOL_PARAM]: STREAM_PROTOCOL,
      [SINCE_PARAM]: String(sinceRef.current),
    });
    if (identify) query.set('clientId', getClientId());
    const source = new EventSource(`${path}?${query}`);
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

    // The super admin disconnected this room. Stay closed until Reconnect.
    source.addEventListener('kicked', (event) => {
      closedByUs = true;
      source.close();
      let at = Date.now();
      try {
        at = (JSON.parse((event as MessageEvent<string>).data) as { at: number }).at;
      } catch {
        /* the stop matters, not the timestamp */
      }
      kick(at);
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
  }, [path, identify, applyState, streaming, kick]);

  const shown: Connection =
    connection === 'gone' ? 'gone' : kicked ? 'kicked' : !streaming ? 'paused' : connection;

  return {
    state,
    connection: shown,
    clockOffset,
    applyState,
    resume,
    reconnect,
    /** True while the tab may stream and ping. */
    active: streaming,
    getSince,
    kick,
  };
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
  const { state, connection, clockOffset, applyState, resume, reconnect, active, getSince, kick } =
    useRoomStream(initial, `/api/rooms/${slug}/stream`, true);
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
  // Pings only while the stream may be open: a hidden, idle or disconnected tab
  // stays quiet, so it neither keeps a function busy nor wakes the database.
  // Coming back re-runs this effect, which pings at once.
  useEffect(() => {
    if (!active) return;

    const ping = async () => {
      try {
        const result = await api<{
          known?: boolean;
          participantId?: string | null;
          kicked?: boolean;
          at?: number;
        }>(`/api/rooms/${slug}/heartbeat`, {
          method: 'POST',
          body: { clientId: getClientId(), v: STREAM_PROTOCOL, since: getSince() },
        });
        if (result.kicked) {
          kick(result.at ?? Date.now());
          return;
        }
        // Recovers your seat after a refresh, or after an admin kicked and you
        // re-joined from another tab.
        if (result.participantId) rememberSeat(result.participantId);
      } catch {
        /* a missed ping just shows you as away for a moment */
      }
    };

    void ping();
    const timer = setInterval(() => void ping(), HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [slug, rememberSeat, active, getSince, kick]);

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
    resume,
    reconnect,
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
  const { state, connection, clockOffset, resume, reconnect } = useRoomStream(
    initial,
    `/api/watch/${encodeURIComponent(token)}/stream`,
    false,
  );
  return {
    state,
    connection,
    resume,
    reconnect,
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

import type { DeckKey } from './decks';
import type { TimerView } from './timer';

export type ParticipantView = {
  id: string;
  name: string;
  isSpectator: boolean;
  online: boolean;
  hasVoted: boolean;
  /** Only populated once the round is revealed. */
  value: string | null;
};

export type WheelEntryView = {
  id: string;
  label: string;
  active: boolean;
};

export type SpinView = {
  id: string;
  winnerLabel: string;
  /** Epoch milliseconds — lets every client land on the same frame. */
  startedAt: number;
};

export type RoomSettings = {
  deckKey: DeckKey;
  customDeck: string | null;
  /** The resolved card faces for `deckKey`. */
  deck: string[];
  autoReveal: boolean;
  allowRevote: boolean;
  showAverage: boolean;
  allowSpectatorVote: boolean;
  /** Whether anyone may spin the wheel, or only the admin. */
  allowAnyoneToSpin: boolean;
  /** Whether the name the wheel lands on leaves the wheel afterwards. */
  dropWinnerAfterSpin: boolean;
  /** Whether anyone may run the discussion timer, or only the admin. */
  allowAnyoneToTime: boolean;
};

export type RoundStats = {
  voted: number;
  eligible: number;
  average: number | null;
  median: number | null;
  consensus: boolean;
  distribution: { value: string; count: number }[];
};

export type RoomState = {
  /** Empty on the watch page: a watcher must never learn the player URL. */
  slug: string;
  /** The read-only link's token. Weaker than the slug, so anyone may see it. */
  watchToken: string;
  name: string;
  version: number;
  createdAt: string;
  settings: RoomSettings;
  round: {
    id: string;
    number: number;
    topic: string | null;
    revealed: boolean;
  };
  participants: ParticipantView[];
  /** The requesting viewer's own card, visible to them before the reveal. */
  myVote: string | null;
  /** Null until the round is revealed. */
  stats: RoundStats | null;
  wheel: WheelEntryView[];
  /**
   * The name the next draw will skip, or null when there is none. Set when a
   * shrinking wheel refills itself: whoever closed the last rotation is back
   * on the wheel with everybody else, and it is the one next draw that passes
   * over them. Published because a skip nobody can see is a weighted roll —
   * the roster marks that name, so the rule is on screen rather than hidden.
   */
  wheelHeldOver: string | null;
  spin: SpinView | null;
  history: { id: string; winnerLabel: string; createdAt: string }[];
  /** The shared discussion timer; null when nobody has one running. */
  timer: TimerView | null;
  /**
   * The server's clock when this snapshot was built. Lets each client correct
   * for its own clock being off, so every screen hits 0:00 together.
   */
  serverNow: number;
};

/** Milliseconds of silence after which a participant is shown as away. */
export const ONLINE_WINDOW_MS = 45_000;

/** How long the wheel animation runs, shared by server and client. */
export const SPIN_DURATION_MS = 8000;

/**
 * How many spins a room keeps. "Recent draws" shows exactly this many, so
 * anything older is never read again — the spin route deletes it on write.
 */
export const SPIN_HISTORY_LIMIT = 8;

/**
 * How many rounds a room keeps, the current one included. Only the current
 * round is ever read; the rest are a small buffer of finished estimates, so
 * the round route deletes anything older (votes go with them, by cascade).
 * Round numbers keep counting up — they come from the current round, not a count.
 */
export const ROUND_HISTORY_LIMIT = 10;

/**
 * One row in the super-admin room list.
 *
 * No `adminToken` and no `clientId`s: the console is for housekeeping — seeing
 * what exists and how stale it is — not for taking over a room.
 */
export type AdminRoomRow = {
  slug: string;
  name: string;
  /** Mutation counter. A room nobody ever used sits at 0. */
  version: number;
  createdAt: string;
  /** Bumped by every mutation, so: when the room was last actually used. */
  updatedAt: string;
  /** Most recent heartbeat from anyone in the room; null if nobody ever joined. */
  lastSeenAt: string | null;
  counts: {
    participants: number;
    rounds: number;
    wheelEntries: number;
    spins: number;
  };
};

export type AdminRoomList = {
  rooms: AdminRoomRow[];
  /** Rooms matching the filter, which may be more than this page holds. */
  total: number;
  limit: number;
  offset: number;
  /** The server's clock, so "idle for 30 days" agrees with the filter. */
  now: string;
};

/** How many rooms one super-admin delete call may take at once. */
export const ADMIN_DELETE_LIMIT = 100;

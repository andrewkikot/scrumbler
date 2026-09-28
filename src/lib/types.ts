import type { DeckKey } from './decks';

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
  slug: string;
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
  spin: SpinView | null;
  history: { id: string; winnerLabel: string; createdAt: string }[];
};

/** Milliseconds of silence after which a participant is shown as away. */
export const ONLINE_WINDOW_MS = 45_000;

/** How long the wheel animation runs, shared by server and client. */
export const SPIN_DURATION_MS = 8000;

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

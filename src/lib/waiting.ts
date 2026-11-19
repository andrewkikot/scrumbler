import type { ParticipantView } from './types';

export type Waiting = {
  /** Everyone auto-reveal waits for: every seat that may vote. */
  players: number;
  voted: number;
  /** Players without a card down, in seat order. */
  missing: { name: string; online: boolean }[];
  /** Only people who are away are holding the round up. */
  onlyAway: boolean;
};

/**
 * Who the round is waiting on, worked out from the state the client already
 * has — no request, no polling. Mirrors `maybeAutoReveal` on the server.
 */
export function waitingFor(participants: ParticipantView[], allowSpectatorVote: boolean): Waiting {
  const players = participants.filter((p) => !p.isSpectator || allowSpectatorVote);
  const missing = players.filter((p) => !p.hasVoted).map((p) => ({ name: p.name, online: p.online }));
  return {
    players: players.length,
    voted: players.length - missing.length,
    missing,
    onlyAway: missing.length > 0 && missing.every((p) => !p.online),
  };
}

/** "Ana, Bo (away) and 2 more" — short enough for one line. */
export function describeMissing(missing: Waiting['missing'], shown = 3): string {
  const names = missing.slice(0, shown).map((p) => (p.online ? p.name : `${p.name} (away)`));
  const rest = missing.length - names.length;
  return rest > 0 ? `${names.join(', ')} and ${rest} more` : names.join(', ');
}

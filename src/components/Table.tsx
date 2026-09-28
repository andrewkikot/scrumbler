'use client';

import { cardFontSize } from '@/lib/decks';
import type { ParticipantView } from '@/lib/types';

/** The watcher's eye, also drawn on the seat of anyone sitting a round out. */
function EyeIcon() {
  return (
    <svg width="18" height="12" viewBox="0 0 12 8" className="pixel-art" aria-hidden>
      {/* Almond and iris in one path, so the eye is a hole rather than a
          second colour guessed at the background behind it. */}
      <path
        d="M1 4h1V3h1V2h2V1h2v1h2v1h1v1h1v1h-1v1h-1v1H8v1H4V7H2V6H1zM4 2h4v4H4z"
        fillRule="evenodd"
        fill="currentColor"
      />
      <rect x="5" y="3" width="2" height="2" fill="currentColor" />
    </svg>
  );
}

/** A card, for dealing somebody back into the round. */
function CardIcon() {
  return (
    <svg width="12" height="16" viewBox="0 0 6 8" className="pixel-art" aria-hidden>
      <path d="M0 0h6v8H0zM1 1h4v6H1z" fillRule="evenodd" fill="currentColor" />
      <rect x="2" y="3" width="2" height="2" fill="currentColor" />
    </svg>
  );
}

/** The cross that takes somebody out of the room altogether. */
function CrossIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 6 6" className="pixel-art" aria-hidden>
      <path
        d="M0 0h1v1h1v1h2V1h1V0h1v1H5v1H4v2h1v1h1v1H5V5H4V4H2v1H1v1H0V5h1V4h1V2H1V1H0z"
        fill="currentColor"
      />
    </svg>
  );
}

type SeatProps = {
  participant: ParticipantView;
  revealed: boolean;
  isMe: boolean;
  canManage: boolean;
  /** Drop somebody out of the round, or deal them back in. */
  onSetSpectator: (id: string, isSpectator: boolean) => void;
  onKick: (id: string) => void;
};

/**
 * What this seat is doing, as one sentence for a screen reader.
 *
 * The visual seat says this with a sunken slot, a hatched card back or a
 * turned card, and those are `<div>`s. An `aria-label` on a `<div>` with no
 * role is not reliably exposed, so the state would simply be missing rather
 * than merely terse. One sentence per seat also beats labelling each layer,
 * which would read the name back three times.
 */
function seatStatus(participant: ParticipantView, revealed: boolean, isMe: boolean): string {
  const { isSpectator, online, hasVoted, value } = participant;
  // Gold text is what marks your own seat on screen, and colour alone says
  // nothing out loud.
  const name = isMe ? `${participant.name} (you)` : participant.name;
  const away = online ? '' : ', away';
  if (isSpectator) return `${name}: watching, not estimating${away}`;
  if (revealed && value !== null) return `${name}: estimated ${value}${away}`;
  if (hasVoted) return `${name}: card played, face down${away}`;
  return `${name}: no card yet${away}`;
}

function Seat({ participant, revealed, isMe, canManage, onSetSpectator, onKick }: SeatProps) {
  const { name, isSpectator, online, hasVoted, value } = participant;

  return (
    /*
     * 96px rather than 88px: it is the smallest 4px step that fits two 40px
     * admin controls with an 8px gap between them, and it gives a long name
     * another few characters before it truncates.
     */
    <li className="flex w-[96px] flex-col items-center gap-2">
      <span className="sr-only">{seatStatus(participant, revealed, isMe)}</span>
      <div className="relative">
        {isSpectator ? (
          <div
            className="px-panel-sunken grid h-[88px] w-[64px] place-items-center"
            title="Watching, not estimating"
          >
            <svg width="24" height="16" viewBox="0 0 12 8" className="pixel-art" aria-hidden>
              <path
                d="M1 4h1V3h1V2h2V1h2v1h2v1h1v1h1v1h-1v1h-1v1H8v1H4V7H2V6H1z"
                fill="var(--color-edge-light)"
              />
              <rect x="4" y="2" width="4" height="4" fill="var(--color-ink-dim)" />
              <rect x="5" y="3" width="2" height="2" fill="var(--color-void-deep)" />
            </svg>
          </div>
        ) : revealed && value !== null ? (
          <div
            key={`${participant.id}-revealed`}
            className="px-flip px-card cursor-default"
            style={{
              background: 'var(--color-teal)',
              color: 'var(--color-void-deep)',
              fontSize: cardFontSize(value),
            }}
          >
            {value}
          </div>
        ) : hasVoted ? (
          <div className="px-card px-card-back cursor-default" title={`${name} has voted`} />
        ) : (
          <div
            className="px-panel-sunken h-[88px] w-[64px]"
            title={`${name} has not voted`}
          />
        )}

        {!online && (
          <span
            aria-hidden
            className="px-chip absolute -bottom-2 left-1/2 -translate-x-1/2 text-[color:var(--color-ink-dim)]"
          >
            away
          </span>
        )}
      </div>

      {/*
        Decorative for assistive tech: the sentence at the top of the seat
        already carries the name, and carries it in full where this one may be
        truncated. Sighted readers keep the tooltip to recover a long one.
      */}
      <span
        aria-hidden
        className={`max-w-full truncate text-[13px] font-medium ${
          isMe ? 'text-[color:var(--color-gold)]' : 'text-[color:var(--color-ink)]'
        }`}
        title={name}
      >
        {name}
      </span>

      {/*
        Admin seat controls, quiet but always drawn. They used to appear only
        on hover, which on a touch screen means never.

        Each is a 40px box around a 12-18px glyph. The glyphs alone were the
        whole target, well under the 24px minimum, with "remove from the room"
        sitting one mis-tap away from "drop out of the round". The destructive
        one also carries its colour at rest rather than only on hover, so it
        reads as the dangerous one on a touch screen too.
      */}
      {canManage && !isMe && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSetSpectator(participant.id, !isSpectator)}
            className="grid h-10 w-10 place-items-center text-[color:var(--color-ink-dim)] transition-colors hover:text-[color:var(--color-gold)]"
            aria-label={
              isSpectator ? `Deal ${name} back into the round` : `Drop ${name} out of the round`
            }
            title={isSpectator ? `Deal ${name} back in` : `Drop ${name} out of the round`}
          >
            {isSpectator ? <CardIcon /> : <EyeIcon />}
          </button>
          <button
            type="button"
            onClick={() => onKick(participant.id)}
            className="grid h-10 w-10 place-items-center text-[color:var(--color-rose)] transition-colors hover:text-[color:var(--color-ink)]"
            aria-label={`Remove ${name} from the room`}
            title={`Remove ${name} from the room`}
          >
            <CrossIcon />
          </button>
        </div>
      )}
    </li>
  );
}

type TableProps = {
  participants: ParticipantView[];
  revealed: boolean;
  meId: string | null;
  canManage: boolean;
  onSetSpectator: (id: string, isSpectator: boolean) => void;
  onKick: (id: string) => void;
};

export function Table({
  participants,
  revealed,
  meId,
  canManage,
  onSetSpectator,
  onKick,
}: TableProps) {
  if (participants.length === 0) {
    return (
      <div className="px-panel-sunken grid min-h-[200px] place-items-center p-8 text-center">
        <p className="text-[color:var(--color-ink-dim)]">
          Nobody has sat down yet. Share the room link to fill the table.
        </p>
      </div>
    );
  }

  return (
    <div className="px-panel-sunken p-6">
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-6">
        {participants.map((participant) => (
          <Seat
            key={participant.id}
            participant={participant}
            revealed={revealed}
            isMe={participant.id === meId}
            canManage={canManage}
            onSetSpectator={onSetSpectator}
            onKick={onKick}
          />
        ))}
      </ul>
    </div>
  );
}

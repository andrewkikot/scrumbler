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

function Seat({ participant, revealed, isMe, canManage, onSetSpectator, onKick }: SeatProps) {
  const { name, isSpectator, online, hasVoted, value } = participant;

  return (
    <li className="flex w-[88px] flex-col items-center gap-2">
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
          <div
            className="px-card px-card-back cursor-default"
            aria-label={`${name} has voted`}
            title={`${name} has voted`}
          />
        ) : (
          <div
            className="px-panel-sunken h-[88px] w-[64px]"
            aria-label={`${name} has not voted`}
            title={`${name} has not voted`}
          />
        )}

        {!online && (
          <span className="px-chip absolute -bottom-2 left-1/2 -translate-x-1/2 text-[color:var(--color-ink-dim)]">
            away
          </span>
        )}
      </div>

      <span
        className={`font-display max-w-full truncate text-[13px] ${
          isMe ? 'text-[color:var(--color-gold)]' : 'text-[color:var(--color-ink)]'
        }`}
        title={name}
      >
        {name}
      </span>

      {/*
        Admin seat controls, quiet but always drawn. They used to appear only
        on hover, which on a touch screen means never.
      */}
      {canManage && !isMe && (
        <div className="flex items-center gap-3 text-[color:var(--color-ink-dim)]">
          <button
            type="button"
            onClick={() => onSetSpectator(participant.id, !isSpectator)}
            className="opacity-60 transition hover:text-[color:var(--color-gold)] hover:opacity-100 focus-visible:opacity-100"
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
            className="opacity-60 transition hover:text-[color:var(--color-rose)] hover:opacity-100 focus-visible:opacity-100"
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

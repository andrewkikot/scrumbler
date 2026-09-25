'use client';

import type { ParticipantView } from '@/lib/types';

type SeatProps = {
  participant: ParticipantView;
  revealed: boolean;
  isMe: boolean;
  canManage: boolean;
  onKick: (id: string) => void;
};

function Seat({ participant, revealed, isMe, canManage, onKick }: SeatProps) {
  const { name, isSpectator, online, hasVoted, value } = participant;

  return (
    <li className="group flex w-[88px] flex-col items-center gap-2">
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
            className="px-flip px-card font-display cursor-default"
            style={{ background: 'var(--color-teal)', color: 'var(--color-void-deep)' }}
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

      <div className="flex min-w-0 items-center gap-1">
        <span
          className={`font-display truncate text-[13px] ${
            isMe ? 'text-[color:var(--color-gold)]' : 'text-[color:var(--color-ink)]'
          }`}
          title={name}
        >
          {name}
        </span>
        {canManage && !isMe && (
          <button
            type="button"
            onClick={() => onKick(participant.id)}
            className="text-[color:var(--color-ink-dim)] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-[color:var(--color-rose)]"
            aria-label={`Remove ${name} from the room`}
            title={`Remove ${name}`}
          >
            <svg width="12" height="12" viewBox="0 0 6 6" className="pixel-art" aria-hidden>
              <path
                d="M0 0h1v1h1v1h2V1h1V0h1v1H5v1H4v2h1v1h1v1H5V5H4V4H2v1H1v1H0V5h1V4h1V2H1V1H0z"
                fill="currentColor"
              />
            </svg>
          </button>
        )}
      </div>
    </li>
  );
}

type TableProps = {
  participants: ParticipantView[];
  revealed: boolean;
  meId: string | null;
  canManage: boolean;
  onKick: (id: string) => void;
};

export function Table({ participants, revealed, meId, canManage, onKick }: TableProps) {
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
            onKick={onKick}
          />
        ))}
      </ul>
    </div>
  );
}

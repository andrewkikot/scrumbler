'use client';

import { useState } from 'react';
import { Hand } from '@/components/Hand';
import { Results } from '@/components/Results';
import { Table } from '@/components/Table';
import type { RoomController } from '@/hooks/useRoom';

export function PokerPanel({ room }: { room: RoomController }) {
  const { state, isAdmin, me } = room;

  // Null until this admin types, so the field follows the server's topic
  // whenever they are not mid-edit — including across a new round.
  const [topicDraft, setTopicDraft] = useState<string | null>(null);
  const topic = topicDraft ?? state.round.topic ?? '';

  const canVote =
    me !== null && (!me.isSpectator || state.settings.allowSpectatorVote) && !state.round.revealed;

  const voteBlockedReason = !me
    ? 'Join the room to play a card.'
    : me.isSpectator && !state.settings.allowSpectatorVote
      ? 'You are watching this round.'
      : state.round.revealed
        ? 'Cards are on the table. Start a new round to vote again.'
        : !state.settings.allowRevote && me.hasVoted
          ? 'Your card is locked in this room.'
          : null;

  const votedCount = state.participants.filter((p) => p.hasVoted).length;
  const playerCount = state.participants.filter(
    (p) => !p.isSpectator || state.settings.allowSpectatorVote,
  ).length;

  return (
    <div className="flex flex-col gap-6">
      {/*
        Revealing the cards is the loudest moment in the room and it was silent
        to a screen reader: the table simply changed underneath you. This region
        is rendered empty-shaped from the first paint so that later updates are
        announced rather than treated as new content, and it deliberately tracks
        only the round and the reveal — wiring the live vote count in here would
        talk over every player as they pick a card.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {state.round.revealed
          ? `Round ${state.round.number}: cards revealed.`
          : `Round ${state.round.number}: cards face down.`}
      </p>

      <section className="px-panel flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] font-medium text-[color:var(--color-ink-dim)]">
            Round {state.round.number}
          </span>
          {isAdmin ? (
            <input
              className="px-input text-[17px] font-medium"
              style={{ minWidth: 240 }}
              placeholder="What are we estimating?"
              value={topic}
              onChange={(e) => setTopicDraft(e.target.value)}
              onBlur={() => {
                const next = topic.trim();
                if (next !== (state.round.topic ?? '')) void room.round('topic', next || null);
                setTopicDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              aria-label="Round topic"
            />
          ) : (
            <p className="truncate text-[17px] font-medium">
              {state.round.topic || 'No topic set'}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="px-chip text-[color:var(--color-ink-dim)]">
            {votedCount}/{playerCount} in
          </span>
          {isAdmin && (
            <>
              <button
                type="button"
                className="px-btn px-btn-gold"
                onClick={() => void room.round(state.round.revealed ? 'hide' : 'reveal')}
                disabled={!state.round.revealed && votedCount === 0}
              >
                {state.round.revealed ? 'Hide cards' : 'Reveal cards'}
              </button>
              <button type="button" className="px-btn" onClick={() => void room.round('clear')}>
                Clear votes
              </button>
              <button
                type="button"
                className="px-btn px-btn-teal"
                onClick={() => void room.round('next')}
              >
                New round
              </button>
            </>
          )}
        </div>
      </section>

      <Table
        participants={state.participants}
        revealed={state.round.revealed}
        meId={me?.id ?? null}
        canManage={isAdmin}
        onSetSpectator={(id, isSpectator) => void room.updateParticipant(id, { isSpectator })}
        onKick={(id) => void room.removeParticipant(id)}
      />

      {state.round.revealed && state.stats && (
        <Results stats={state.stats} showAverage={state.settings.showAverage} />
      )}

      <Hand
        deck={state.settings.deck}
        selected={state.myVote}
        disabled={!canVote || (!state.settings.allowRevote && Boolean(me?.hasVoted))}
        disabledReason={voteBlockedReason}
        onPick={(value) => void room.vote(value)}
      />
    </div>
  );
}

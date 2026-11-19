'use client';

/**
 * Shown once the super admin disconnects a room. The tab has stopped streaming
 * and pinging; nothing in the room changed, so Reconnect picks up where it was.
 */
export function DisconnectedNotice({ onReconnect }: { onReconnect: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div className="px-panel max-w-[420px] p-8">
        <h1 className="mb-2 text-[22px]">Disconnected</h1>
        <p className="mb-6 text-[color:var(--color-ink-dim)]">
          An admin closed the open tabs in this room to save server time. The room, its seats and
          votes are all still here.
        </p>
        <button type="button" className="px-btn px-btn-gold" onClick={onReconnect}>
          Reconnect
        </button>
      </div>
    </main>
  );
}

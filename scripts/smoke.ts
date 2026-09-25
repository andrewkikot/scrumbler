/**
 * End-to-end check against a running server and a real database.
 *
 *   npm run dev          # in one terminal
 *   npm run smoke        # in another
 *
 * Drives a whole standup through the public API: create a room, seat two
 * players, estimate, auto-reveal, start a fresh round, then spin the wheel —
 * asserting the SSE stream pushes each change as it happens, and that a player
 * without the admin token is refused everywhere it matters.
 *
 * It creates a throwaway room and deletes it at the end.
 */
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  ✔ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✘ ${label}${detail === undefined ? '' : ` — got ${JSON.stringify(detail)}`}`);
  }
}

type Json = Record<string, unknown>;

async function call(
  path: string,
  options: { method?: string; body?: unknown; admin?: string; clientId?: string } = {},
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.admin) headers['x-admin-token'] = options.admin;
  if (options.clientId) headers['x-client-id'] = options.clientId;

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  let body: Json = {};
  try {
    body = text ? (JSON.parse(text) as Json) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

/** Collects `state` frames from the SSE stream in the background. */
function listen(slug: string, clientId: string) {
  const controller = new AbortController();
  const frames: Json[] = [];

  const done = (async () => {
    const response = await fetch(
      `${BASE}/api/rooms/${slug}/stream?clientId=${encodeURIComponent(clientId)}`,
      { headers: { Accept: 'text/event-stream' }, signal: controller.signal },
    );
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });

        let split: number;
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const event = /^event: (.+)$/m.exec(chunk)?.[1];
          const data = /^data: (.+)$/m.exec(chunk)?.[1];
          if (event && data) frames.push({ event, ...(JSON.parse(data) as Json) });
        }
      }
    } catch {
      /* aborted by us */
    }
  })();

  return { frames, stop: () => (controller.abort(), done) };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until the stream shows what we are waiting for, or give up. */
async function until(frames: Json[], predicate: (f: Json) => boolean, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (frames.some(predicate)) return true;
    await wait(120);
  }
  return false;
}

async function main() {
  const ana = `smoke-ana-${Date.now()}`;
  const bo = `smoke-bo-${Date.now()}`;

  console.log(`\nScrumbler smoke test against ${BASE}\n`);

  // ---- create ------------------------------------------------------------
  console.log('Creating a room');
  const created = await call('/api/rooms', {
    method: 'POST',
    body: { name: 'Smoke Test Squad', deckKey: 'fibonacci', wheelNames: ['Ana', 'Bo', 'Kim'] },
  });
  check('room is created', created.status === 201, created.body);
  const slug = created.body.slug as string;
  const admin = created.body.adminToken as string;
  if (!slug || !admin) {
    console.error('\nCannot continue without a room. Is DATABASE_URL set and migrated?');
    process.exit(1);
  }
  check('slug is derived from the name', slug.startsWith('smoke-test-squad'), slug);
  check('admin token is long enough to be unguessable', admin.length >= 32);

  const stream = listen(slug, ana);
  check('stream delivers an opening snapshot', await until(stream.frames, (f) => f.event === 'state'));

  // ---- seat two players --------------------------------------------------
  console.log('\nSeating two players');
  const joinAna = await call(`/api/rooms/${slug}/join`, {
    method: 'POST',
    body: { clientId: ana, name: 'Ana' },
    clientId: ana,
  });
  check('a player joins with no auth at all', joinAna.status === 200, joinAna.body);

  await call(`/api/rooms/${slug}/join`, {
    method: 'POST',
    body: { clientId: bo, name: 'Bo' },
    clientId: bo,
  });
  check(
    'both players appear on the stream',
    await until(stream.frames, (f) => ((f.participants as unknown[]) ?? []).length === 2),
  );

  // ---- estimate ----------------------------------------------------------
  console.log('\nEstimating');
  const voteAna = await call(`/api/rooms/${slug}/vote`, {
    method: 'POST',
    body: { clientId: ana, value: '5' },
    clientId: ana,
  });
  check('a vote is accepted', voteAna.status === 200, voteAna.body);

  const afterFirst = voteAna.body as { round?: Json; participants?: Json[]; myVote?: string };
  check('the round stays hidden until everyone is in', afterFirst.round?.revealed === false);
  check('a voter sees their own card early', afterFirst.myVote === '5', afterFirst.myVote);
  check(
    "a voter cannot see anyone else's card",
    (afterFirst.participants ?? []).every((p) => (p as Json).value === null),
  );

  const rejected = await call(`/api/rooms/${slug}/vote`, {
    method: 'POST',
    body: { clientId: ana, value: '999' },
    clientId: ana,
  });
  check('a card outside the deck is rejected', rejected.status === 400, rejected.body);

  const voteBo = await call(`/api/rooms/${slug}/vote`, {
    method: 'POST',
    body: { clientId: bo, value: '5' },
    clientId: bo,
  });
  const revealed = voteBo.body as { round?: Json; stats?: Json };
  check('auto-reveal fires once everyone present has voted', revealed.round?.revealed === true);
  check('consensus is detected', revealed.stats?.consensus === true, revealed.stats);
  check('the average is right', revealed.stats?.average === 5, revealed.stats);
  check(
    'voting is closed after the reveal',
    (await call(`/api/rooms/${slug}/vote`, { method: 'POST', body: { clientId: ana, value: '8' } }))
      .status === 409,
  );

  // ---- admin boundary ----------------------------------------------------
  console.log('\nChecking the admin boundary');
  check(
    'a player cannot start a round',
    (await call(`/api/rooms/${slug}/round`, { method: 'POST', body: { action: 'next' } })).status ===
      403,
  );
  check(
    'a player cannot change the deck',
    (await call(`/api/rooms/${slug}`, { method: 'PATCH', body: { deckKey: 'tshirt' } })).status ===
      403,
  );
  check(
    'a player cannot spin the wheel',
    (await call(`/api/rooms/${slug}/spin`, { method: 'POST', body: {} })).status === 403,
  );
  check(
    'a wrong token is refused',
    (await call(`/api/rooms/${slug}/spin`, { method: 'POST', body: {}, admin: 'x'.repeat(32) }))
      .status === 403,
  );
  check(
    'a player cannot delete the room',
    (await call(`/api/rooms/${slug}`, { method: 'DELETE' })).status === 403,
  );

  // ---- next round --------------------------------------------------------
  console.log('\nStarting the next round');
  const next = await call(`/api/rooms/${slug}/round`, {
    method: 'POST',
    body: { action: 'next', topic: 'Checkout retries' },
    admin,
  });
  const fresh = next.body as { round?: Json; stats?: Json };
  check('the round number advances', fresh.round?.number === 2, fresh.round);
  check('the new round starts hidden', fresh.round?.revealed === false);
  check('the new round takes the topic it was given', fresh.round?.topic === 'Checkout retries');
  check('previous results are cleared', fresh.stats === null);

  const deck = await call(`/api/rooms/${slug}`, { method: 'PATCH', body: { deckKey: 'tshirt' }, admin });
  check(
    'the admin can change the deck',
    ((deck.body as { settings?: { deck?: string[] } }).settings?.deck ?? []).includes('XL'),
  );

  // ---- the wheel ---------------------------------------------------------
  console.log('\nSpinning the wheel');
  const added = await call(`/api/rooms/${slug}/wheel`, {
    method: 'POST',
    body: { labels: ['Ana', 'Sam'] },
    admin,
  });
  check('a duplicate name is not added twice', (added.body as { added?: number }).added === 1, added.body);

  const spin = await call(`/api/rooms/${slug}/spin`, { method: 'POST', body: { avoidRepeat: false }, admin });
  const spun = spin.body as { spin?: { winnerLabel?: string }; history?: unknown[] };
  const roster = ['Ana', 'Bo', 'Kim', 'Sam'];
  check('the winner comes from the wheel', roster.includes(spun.spin?.winnerLabel ?? ''), spun.spin);
  check('the draw is recorded in history', (spun.history ?? []).length === 1);

  const first = spun.spin?.winnerLabel;
  const second = await call(`/api/rooms/${slug}/spin`, {
    method: 'POST',
    body: { avoidRepeat: true },
    admin,
  });
  check(
    'skip-last-leader does not draw the same name again',
    (second.body as { spin?: { winnerLabel?: string } }).spin?.winnerLabel !== first,
  );

  check(
    'the spin reached the stream',
    await until(stream.frames, (f) => ((f as { history?: unknown[] }).history ?? []).length >= 2),
  );

  // ---- teardown ----------------------------------------------------------
  console.log('\nDeleting the room');
  const deleted = await call(`/api/rooms/${slug}`, { method: 'DELETE', admin });
  check('the admin can delete the room', deleted.status === 200, deleted.body);
  check('the stream announces the room is gone', await until(stream.frames, (f) => f.event === 'gone'));
  check('the room really is gone', (await call(`/api/rooms/${slug}`)).status === 404);

  await stream.stop();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
  }
  console.log('Everything works end to end.\n');
}

main().catch((error) => {
  console.error('\nSmoke test crashed:', error instanceof Error ? error.message : error);
  console.error('Is the dev server running, and DATABASE_URL set and migrated?');
  process.exit(1);
});

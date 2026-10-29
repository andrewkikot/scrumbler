# Scrumbler

Planning poker in a permanent room, a wheel that picks who runs tomorrow's
daily, and a shared timer to timebox the discussion. Players open a link and
pick a card — there are no accounts.

Next.js 16 (App Router) · Prisma 7 · Neon Postgres · Server-Sent Events · Tailwind 4

---

## How it works

### Rooms are permanent URLs

Creating a room mints two things: a public slug (`/r/platform-squad`) and a
secret **admin token**. The slug is safe to paste anywhere. The token lives in
the creator's `localStorage` and is sent as an `x-admin-token` header on the
requests that change things.

That is the entire auth model, and it is why there is no sign-up:

| | Player | Admin |
|---|---|---|
| Join, vote, watch | yes | yes |
| Reveal / clear / start a round | no | yes |
| Change the deck and rules | no | yes |
| Add, bench or remove wheel names | no | yes |
| Spin the wheel | yes, unless the admin closes it | yes |
| Start, pause, stop the timer | yes, unless the admin locks it | yes |
| Reset the watch link | no | yes |
| Delete the room | no | yes |

An admin shares their powers by sending the admin link
(`/r/<slug>?admin=<token>`); the page claims the token on load and strips it
from the address bar so the URL is not left lying around in a screenshot.

### A watch link for people who should not vote

Stakeholders who want to follow along get `/w/<watchToken>` (Settings → Copy
watch link). It is a separate capability, not a mode of the player page: the
watch routes (`GET /api/watch/<token>` and its `/stream`) are read-only, and
the snapshot they serve has the slug blanked out — so a watcher never learns
the URL that can vote, and no edit to the address bar gets them a seat. They do
not appear at the table or count towards "who is in".

The admin can reset the link; every stream on the old one closes within a
second. A player can see the watch token, which is fine — it is strictly less
than what they already hold.

### A shared timer

`POST /api/rooms/<slug>/timer` starts, pauses, resumes, extends (+1 min) or
stops the room's single timebox. The server stores only when it ends (or what
was left when paused); every client counts down locally against the server's
clock — each snapshot carries `serverNow`, so a laptop whose clock is off still
hits 0:00 with everyone else — and a running timer costs no writes at all. At
zero each browser plays a short chime (mutable per device) and the clock turns
red and counts the overtime.

### One super admin, for housekeeping

Rooms are permanent and nobody signs up, so nothing ever cleans them up: last
year's squads keep their URLs, and their admin tokens sit in `localStorage` on
laptops that have since been reimaged. Deleting those needs a capability wider
than one room.

That capability is a single environment variable, `SCRUMBLER_SUPER_ADMIN_KEY`
(at least 24 characters — `openssl rand -hex 16`). Set it and `/admin` lists
every room with how long each has been idle, and deletes any of them — one at a
time, or a whole selection:

```
GET    /api/admin/rooms?q=&idleDays=&sort=&order=&limit=&offset=
DELETE /api/admin/rooms            { "slugs": ["a", "b"] }
DELETE /api/admin/rooms/:slug
```

Every one of those requires the key in an `x-super-admin-key` header, which is
also why the console asks for it and keeps it in `sessionStorage` — closing the
tab puts the master key away. Leave the variable unset and the routes answer
`503`: there is no super admin until you create one, and a per-room admin token
is never accepted in its place.

The key never reaches the browser bundle. `/admin` is a shell that renders
nothing until you paste the key, so the page itself holds no secret.

### Limits, so nobody can fill the database

With no sign-up, the routes that create rows are open to anyone with curl. Each
limit sits far above real use and far below what a loop can do
(`src/lib/limits.ts`):

| | Limit |
|---|---|
| New rooms, whole deployment | 200 per hour — stops a script on many addresses |
| New rooms, per IP | 20 per hour |
| Joins, per IP | 120 per 10 minutes (an office shares one address) |
| Seats per room | 50 — a full room first clears seats unseen for 30 days |
| Wheel names per room | 100 |

Per-IP counters live in a small `RateLimit` table rather than in memory
(serverless instances share nothing) or Redis (a second service). Only a hash of
the address is stored. Over a limit, the route answers `429` with `Retry-After`.

**Daily cleanup.** Vercel Cron calls `GET /api/cron/cleanup` at 04:00 UTC
(`vercel.json`), authenticated with `CRON_SECRET`. It deletes:

- rooms never used (no mutation at all) a week after they were made;
- seats nobody has heartbeated from in 30 days (their votes go with them);
- rate-limit windows older than a day;
- rooms idle longer than `SCRUMBLER_ROOM_IDLE_DAYS` — **only if you set it**
  (minimum 30). Unset, rooms are permanent, as promised above.

Run it by hand with the super-admin key:

```bash
curl -H "x-super-admin-key: $SCRUMBLER_SUPER_ADMIN_KEY" https://<host>/api/cron/cleanup
```

### Realtime without WebSockets

Vercel's serverless functions cannot hold an open WebSocket, so the push
channel is **Server-Sent Events**: one long-lived `GET /api/rooms/<slug>/stream`
per client, with ordinary `POST` routes carrying the writes. For planning poker
what matters is server-to-client latency, and SSE gives that plus native browser
reconnection, with no extra service to pay for.

Every mutation increments `Room.version`. The stream watches that one column
two ways:

1. an **in-process signal** (`src/lib/bus.ts`), so clients served by the same
   instance see a vote land immediately;
2. a **1-second poll** of `Room.version`, one small indexed read, which catches
   writes that landed on a different instance.

Connections close themselves at 50s — just under Vercel's 60s function limit —
and `EventSource` reconnects on its own.

The transport is sealed inside `src/hooks/useRoom.ts`. Moving to real
WebSockets later (Pusher, Ably, a separate Node server) is a change to that one
file plus the stream route; no component knows how updates arrive.

### The spin is decided by the server

`POST /api/rooms/<slug>/spin` picks the winner with `crypto.randomInt` (uniform,
unlike `Math.random`) and stores it. Clients then animate toward that stored
label from the recorded timestamp, with the turn count derived from the spin id
— so everyone watches the same wheel land on the same name at the same moment,
and a late joiner sees the result rather than a replay.

Wheel names are **not** tied to participants on purpose: someone on holiday, or
who never opens the room, can still be in (or benched from) the rotation.

### The rotation refills itself

With `dropWinnerAfterSpin` on — the default — each draw takes the winner off the
wheel, so over a sprint everybody leads exactly once. When the last name goes,
the wheel does not sit empty waiting for twelve names to be added back by hand:
the whole roster goes straight back on for the next rotation.

Everybody goes back on, the name that just led included — it is the next **draw**
that skips them, not the wheel that benches them. Drawn again immediately they
would run two dailies in a row, which is the one thing a rotation exists to
prevent; so that one spin passes over them, and they are in the running again
from the spin after. Their wedge is on the wheel throughout.

An exclusion the room cannot see is just a weighted roll, so the roster marks
that name *not this draw* and says why underneath. It is the only skip in the
app: a *standing* "never the last leader" is still not on offer, and the draw is
otherwise uniform over everyone on the wheel.

`src/lib/rotation.ts` holds both halves as pure functions — `settleRotation` for
what the roster looks like after a draw, `drawPool` for who is in the next one —
so the policy is checked without a database. The routes only apply what they
return.

---

## Running it locally

You need a Neon database. The free plan is more than enough.

1. **Create the database.** Sign in at [neon.tech](https://neon.tech), create a
   project, then open **Connect** and copy both connection strings — the pooled
   one (host contains `-pooler`) and the direct one.

2. **Configure the environment.**

   ```bash
   cp .env.example .env
   # paste your two connection strings into .env
   ```

3. **Install, migrate, run.**

   ```bash
   npm install
   npm run db:deploy   # applies prisma/migrations to your database
   npm run dev
   ```

   Open <http://localhost:3000>.

To try it as a team, open the room in a second browser (or a private window) —
that window gets its own identity and joins as a player.

### Scripts

| | |
|---|---|
| `npm run dev` | development server |
| `npm run build` | generate the Prisma client, then build |
| `npm test` | unit tests (stats, decks, slugs, wheel, timer, limits, env) |
| `npm run smoke` | end-to-end check against a running server |
| `SCRUMBLER_SUPER_ADMIN_KEY=… npm run smoke` | as above, plus the /admin routes |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:deploy` | apply existing migrations (use this in CI and prod) |
| `npm run db:migrate` | create a new migration after editing the schema |
| `npm run db:studio` | browse the data |

---

## Deploying to Vercel

1. **Push this repo to GitHub.**

   ```bash
   git add -A
   git commit -m "Scrumbler"
   git remote add origin git@github.com:<you>/scrumbler.git
   git push -u origin main
   ```

2. **Import the repo** at [vercel.com/new](https://vercel.com/new). Leave the
   framework preset on Next.js.

3. **Connect Neon.** In the Vercel project, go to **Storage → Connect Database →
   Neon**, or add the two variables by hand under **Settings → Environment
   Variables**:

   - `DATABASE_URL` — the **pooled** string
   - `DATABASE_URL_UNPOOLED` — the **direct** string
   - `CRON_SECRET` — any long random string (`openssl rand -hex 16`); Vercel
     signs the daily cleanup with it. Without it the cron call is refused.

   **Prefixed names work too.** If those names are already claimed — by another
   project, or by a team-wide shared variable — Vercel prefixes them, and this
   deployment uses `SCRUMBLER_DATABASE_URL` / `SCRUMBLER_DATABASE_URL_UNPOOLED`.
   Either spelling is accepted; the prefixed one wins when both are present, so
   an inherited team-level `DATABASE_URL` pointing at a different database can
   never quietly take over. The resolution order lives in `src/lib/env.ts`.

   `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING` (prefixed or not) are accepted
   as a last fallback. The other `PG*` variables Neon emits are unused.

4. **Apply the schema** once, from your machine, with production credentials:

   ```bash
   npm run db:deploy
   ```

5. **Deploy.** `npm run build` runs `prisma generate` first, so the client is
   always built against the current schema. Every push to `main` redeploys.

### Notes on the free tiers

- **Function duration.** The stream route sets `maxDuration = 60` and closes at
  50s. That is within Vercel Hobby limits; clients reconnect automatically, so
  the ceiling is invisible in use.
- **Neon compute.** Each open room polls one small indexed column once a second.
  A standup-sized room for an hour is negligible, but leaving dozens of tabs
  open for days is not free — Neon's free compute does scale to zero when the
  last client disconnects.
- **No Redis needed.** Cross-instance fan-out rides on the `Room.version`
  column, which is why this runs on the free plan at all.

---

## Layout

```
prisma/
  schema.prisma          data model
  migrations/0_init/     initial SQL
prisma.config.ts         Prisma 7 config (the URL no longer lives in the schema)
src/
  app/
    api/rooms/...        REST routes + the SSE stream
    api/watch/[token]/   read-only snapshot + stream for the watch link
    api/admin/rooms/     list + delete any room (super-admin key)
    api/cron/cleanup/    the daily sweep (CRON_SECRET or super-admin key)
    r/[slug]/            the room page (server-rendered first frame)
    w/[token]/           the watch page
    admin/               the super-admin console
    globals.css          the pixel design system
  components/            Wheel, Table, Hand, Results, panels
  hooks/useRoom.ts       SSE subscription + every mutation
  lib/
    room.ts              snapshot building, admin checks, auto-reveal
    sse.ts               the SSE loop both streams share
    timer.ts             timer arithmetic (shared by route and countdown)
    limits.ts            rate limits, creation brake, per-room caps
    cleanup.ts           what the daily sweep deletes
    stats.ts             vote maths
    wheel.ts             wheel geometry
    rotation.ts          who is on the wheel after a draw, and who the next one skips
    bus.ts               in-process pub/sub
    db.ts                Prisma client (lazy, Neon adapter)
    env.ts               connection-string resolution (prefixed names)
    superadmin.ts        the deployment-wide key and its route guard
    secret.ts            constant-time token comparison
tests/
  logic.test.ts          vote maths, decks, slugs, wheel geometry, rotation
  env.test.ts            env resolution priority
  superadmin.test.ts     the super-admin key guard
  timer.test.ts          start, pause, extend, overtime, clock face
  limits.test.ts         rate-limit windows, client address, idle sweep
scripts/smoke.ts         end-to-end check against a live server
```

## Design

Deep plum, amber and teal on a 4px grid — no rounded corners, no blurred
shadows, depth from 3px bevels and hard 4px offsets. The wheel is rasterised
pixel-by-pixel into a 180×180 canvas and scaled up with `image-rendering:
pixelated`, because drawing real arcs would give smooth antialiased segment
edges, which is the one thing a bitmap wheel must not have.

Type is Pixelify Sans for display and IBM Plex Sans for body text. Motion is
limited to three moments: cards flipping on reveal, the wheel spinning, and
buttons physically travelling on press. `prefers-reduced-motion` turns all of it
off.

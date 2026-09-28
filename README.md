# Scrumbler

Planning poker in a permanent room, plus a wheel that picks who runs tomorrow's
daily. Players open a link and pick a card — there are no accounts.

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
| Spin the wheel | no | yes |
| Delete the room | no | yes |

An admin shares their powers by sending the admin link
(`/r/<slug>?admin=<token>`); the page claims the token on load and strips it
from the address bar so the URL is not left lying around in a screenshot.

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
| `npm test` | unit tests (stats, decks, slugs, wheel geometry, env) |
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
    api/admin/rooms/     list + delete any room (super-admin key)
    r/[slug]/            the room page (server-rendered first frame)
    admin/               the super-admin console
    globals.css          the pixel design system
  components/            Wheel, Table, Hand, Results, panels
  hooks/useRoom.ts       SSE subscription + every mutation
  lib/
    room.ts              snapshot building, admin checks, auto-reveal
    stats.ts             vote maths
    wheel.ts             wheel geometry
    bus.ts               in-process pub/sub
    db.ts                Prisma client (lazy, Neon adapter)
    env.ts               connection-string resolution (prefixed names)
    superadmin.ts        the deployment-wide key and its route guard
    secret.ts            constant-time token comparison
tests/
  logic.test.ts          vote maths, decks, slugs, wheel geometry
  env.test.ts            env resolution priority
  superadmin.test.ts     the super-admin key guard
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

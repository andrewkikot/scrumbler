/**
 * The winner's fireworks, kept out of the component so every client lets off
 * the same show — and so the flight of a spark can be checked without a canvas.
 *
 * Space: `y` is height above the floor and `x` runs right, both in *field
 * units*, where one unit is the height of the box the show is drawn in. A
 * burst is therefore round whatever shape the box happens to be; the only
 * number the caller contributes is the box's aspect ratio, which says how wide
 * the field is.
 *
 * Time is milliseconds from the first launch.
 */

/** From the first launch to the last ember going out. */
export const SHOW_MS = 3400;

/** How long the shockwave of a burst takes to run out from the flash. */
export const RING_MS = 260;

/** How many colours the ramp the caller paints with has to offer. */
export const SHELL_COLORS = 5;

/** Field units per second², downwards. Gentle: sparks are meant to hang. */
const GRAVITY = 0.5;

/** Seconds a spark takes to shed most of its launch speed. */
const DRAG_TAU = 0.85;

/** How many shells go up, and how many of those are held back for the finale. */
const SHELLS = 16;
const FINALE = 4;
/**
 * When the finale goes up. A shell takes about half a second to climb, so
 * this has to overlap the tail of the steady middle — left with a gap, the
 * show visibly stops and then starts again.
 */
const FINALE_AT = 1400;

/** One shell: its climb, its flash, and the sparks it throws. */
export type Burst = {
  /** When the shell leaves the floor. */
  launchAt: number;
  /** Where it is fired from and where it goes off, as fractions of the width. */
  fromX: number;
  burstX: number;
  /** How high it gets, in field units above the floor. */
  burstY: number;
  /** Climb time, and how long a spark burns after the flash. */
  rise: number;
  life: number;
  /** Launch speed of a spark, in field units per second. */
  speed: number;
  sparks: number;
  /** Which of the ramp's colours this shell is packed with. */
  color: number;
  /** Rotation of the spark ring, so no two bursts line up. */
  phase: number;
  /** A big one: more stars, thrown further, with a shockwave worth drawing. */
  heavy: boolean;
  /** A crackler, whose stars flicker on and off as they burn. */
  twinkle: boolean;
};

export type Spark = {
  x: number;
  y: number;
  /** 0 at the flash, 1 when the ember is out. */
  age: number;
};

/** Same string hash as the wheel's turn count: cheap, and stable everywhere. */
function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 16777619 + seed.charCodeAt(i)) >>> 0;
  return hash;
}

/** mulberry32 — small, fast, and the same sequence in every browser. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The show a given spin lets off.
 *
 * Seeded from the spin id for the same reason the wheel's travel is: the
 * result is shared, so the celebration of it should be the same one in every
 * room on the call rather than a different accident per browser.
 */
export function createShow(seed: string): Burst[] {
  const next = random(hashSeed(seed));
  const bursts: Burst[] = [];

  let color = Math.floor(next() * SHELL_COLORS);

  for (let i = 0; i < SHELLS; i += 1) {
    // The shape of a real display: an opening pair to say it has started, a
    // steady middle, then everything left in the mortars going up at once.
    const inFinale = i >= SHELLS - FINALE;
    const launchAt = inFinale
      ? FINALE_AT + (i - (SHELLS - FINALE)) * 80
      : Math.round(i * 105 + next() * 70);
    // The opening pair barely climb. A shell that takes its half second to get
    // up there means half a second of nothing at all between the wheel
    // stopping and the first bang, which is exactly where the celebration is
    // supposed to be loudest.
    const rise = i < 2 ? 150 + Math.round(next() * 90) : 380 + Math.round(next() * 220);

    // Shells alternate sides, so the show spans the screen rather than piling
    // up wherever the generator happened to point first — weighted towards the
    // middle, because that is where the wheel and the name are.
    const edge = i % 2 === 0 ? 0.08 + next() * 0.4 : 0.92 - next() * 0.4;
    const side = 0.5 + (edge - 0.5) * 0.88;
    // Fired from nearer the middle than they go off, so the climb leans
    // outwards instead of running dead straight up.
    const fromX = 0.5 + (side - 0.5) * 0.35;
    // Never the same colour twice running, for the same reason neighbouring
    // wedges on the wheel are never the same colour.
    color = (color + 1 + Math.floor(next() * (SHELL_COLORS - 1))) % SHELL_COLORS;
    const heavy = inFinale || i < 2;

    bursts.push({
      launchAt,
      fromX,
      burstX: side,
      burstY: 0.5 + next() * 0.36,
      rise,
      // Clamped so the last ember is out when the show is: the overlay is torn
      // down at SHOW_MS, and a spark cut off mid-flight reads as a dropped frame.
      life: Math.min(760 + Math.round(next() * 420), SHOW_MS - launchAt - rise),
      // A burst is sized against the height of the box, and the box is the
      // whole window: at half of it the sparks scatter so far apart that the
      // ring stops reading as one firework. A quarter of it holds together.
      speed: (heavy ? 0.22 : 0.15) + next() * 0.1,
      sparks: (heavy ? 34 : 24) + Math.round(next() * 16),
      color,
      phase: next() * Math.PI * 2,
      heavy,
      // Roughly every third shell crackles, which is the one effect that makes
      // a pixel firework unmistakably a firework rather than a confetti cannon.
      twinkle: next() < 0.38,
    });
  }

  return bursts;
}

/** When the shell goes off. */
export function burstAt(burst: Burst): number {
  return burst.launchAt + burst.rise;
}

/**
 * The climbing shell at `t`, or null when it is either still on the floor or
 * already gone off. It decelerates into the flash — a shell is slowest at the
 * top, which is also where the eye needs a moment to find it.
 */
export function shellAt(burst: Burst, t: number, aspect: number): { x: number; y: number } | null {
  if (t < burst.launchAt || t >= burstAt(burst)) return null;
  const u = (t - burst.launchAt) / burst.rise;
  const climb = 1 - (1 - u) ** 2;
  return {
    x: (burst.fromX + (burst.burstX - burst.fromX) * u) * aspect,
    y: burst.burstY * climb,
  };
}

/**
 * The shockwave: a ring that runs out of the flash ahead of the stars and is
 * gone before they have spread. It is what the eye catches from across a
 * screen — a cloud of single pixels is easy to miss, an expanding circle is
 * not — and it costs one burst's worth of drawing.
 */
export function ringAt(burst: Burst, t: number): { radius: number; age: number } | null {
  const since = t - burstAt(burst);
  if (since < 0 || since >= RING_MS) return null;
  const age = since / RING_MS;
  // Fast out of the flash, then easing to a stop, like the stars themselves.
  // It stays close to the burst it came out of: a ring thrown much wider than
  // that stops reading as a shockwave and starts reading as a drawn circle.
  return { radius: burst.speed * 0.55 * (1 - (1 - age) ** 2), age };
}

/**
 * Where a spark is, `seconds` after the flash.
 *
 * The exact solution for a body under gravity and linear drag, rather than a
 * step-by-step integration: every frame is then computed from the clock alone,
 * so a tab that was throttled or a frame that ran late never drifts the show.
 */
function fly(v: number, seconds: number, gravity: number): number {
  const decay = 1 - Math.exp(-seconds / DRAG_TAU);
  return (v + gravity * DRAG_TAU) * DRAG_TAU * decay - gravity * DRAG_TAU * seconds;
}

/**
 * A deterministic jitter per spark. Storing a random number for each would
 * mean carrying a few hundred of them around; this reads one out of the index.
 */
function wobble(index: number, phase: number): number {
  const x = Math.sin(index * 12.9898 + phase * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** The sparks of one burst at `t`. Empty before the flash and after the last ember. */
export function sparksAt(burst: Burst, t: number, aspect: number): Spark[] {
  const since = t - burstAt(burst);
  if (since < 0 || since >= burst.life) return [];

  const seconds = since / 1000;
  const age = since / burst.life;
  const originX = burst.burstX * aspect;
  const out: Spark[] = [];

  for (let i = 0; i < burst.sparks; i += 1) {
    const jitter = wobble(i, burst.phase);
    const angle = (i / burst.sparks) * Math.PI * 2 + burst.phase + (jitter - 0.5) * 0.25;
    // A ring with everything at one speed looks like a stencil. Spreading the
    // speed fills the disc, and the slowest sparks read as the shell's core.
    const speed = burst.speed * (0.45 + jitter * 0.75);

    out.push({
      x: originX + fly(Math.cos(angle) * speed, seconds, 0),
      y: burst.burstY + fly(Math.sin(angle) * speed, seconds, GRAVITY),
      age,
    });
  }

  return out;
}

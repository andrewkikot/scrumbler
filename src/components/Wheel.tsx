'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SPIN_DURATION_MS, type SpinView, type WheelEntryView } from '@/lib/types';
import {
  droppedIndex,
  segmentCenter,
  segmentUnderPointer,
  spinProgress,
  spinTarget,
  turnsFor,
  windupDeg,
} from '@/lib/wheel';

/**
 * The wheel is rasterised per-pixel into a 180×180 canvas and scaled up with
 * `image-rendering: pixelated`.
 *
 * Drawing real arcs with SVG or canvas paths would give antialiased, smoothly
 * curved segment edges — which is exactly what a bitmap wheel must not have.
 * Deciding each pixel's colour by hand keeps the segment boundaries hard and
 * stair-stepped at any display size.
 */
const SIZE = 180;
const CENTER = SIZE / 2;
const RADIUS = 78;
const RIM = 6;
const HUB = 14;

/** Clear pixels between the rim and the canvas edge: the ejection runway. */
const RUNWAY = CENTER - RADIUS;

/** How far the winning wedge stands proud of the disc once the wheel stops. */
const POP_PX = 3;
const POP_MS = 220;

/** The drop: the wedge keeps going until it has left the disc entirely. */
const DROP_PX = RUNWAY - 1;
const DROP_MS = 460;

/** Console-palette segment colours, cycled around the wheel. */
const SEGMENT_COLORS = ['#ffb43c', '#4fd6c0', '#a97bff', '#ef5f6b', '#9ede4c'];
const RIM_COLOR = '#0b0716';
const HUB_COLOR = '#f4ead8';
const HUB_EDGE = '#0b0716';
/** What the winning wedge is tinted towards while it stands proud. */
const GLOW_COLOR: [number, number, number] = [255, 244, 222];

/** Ordered 4×4 dither — the wedge crumbles away in pixels, not in opacity. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

type Band = 0 | 1 | 2 | 3; // outside | rim | face | hub

/** The winning wedge, lifted out of the disc and possibly falling away. */
type Accent = {
  index: number;
  /** Canvas pixels the wedge has travelled along its own bisector. */
  offset: number;
  /** 0 = solid, 1 = fully dithered away. */
  dissolve: number;
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(
  a: [number, number, number],
  b: [number, number, number],
  amount: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * amount),
    Math.round(a[1] + (b[1] - a[1]) * amount),
    Math.round(a[2] + (b[2] - a[2]) * amount),
  ];
}

/**
 * Per-pixel geometry never changes, so angle and band are computed once and
 * reused by every frame — the animation loop then does nothing but a modulo
 * and a palette lookup.
 */
function buildLookup() {
  const angle = new Float32Array(SIZE * SIZE);
  const band = new Uint8Array(SIZE * SIZE);

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const i = y * SIZE + x;
      // Sample pixel centres so the circle stays symmetric.
      const dx = x + 0.5 - CENTER;
      const dy = y + 0.5 - CENTER;
      const r = Math.sqrt(dx * dx + dy * dy);

      if (r > RADIUS) band[i] = 0;
      else if (r > RADIUS - RIM) band[i] = 1;
      else if (r < HUB) band[i] = 3;
      else band[i] = 2;

      // Degrees clockwise from 12 o'clock, which is where the pointer sits.
      let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      angle[i] = deg;
    }
  }

  return { angle, band };
}

/**
 * Labels ride the face between hub and rim, sized in `cqw` against the wheel
 * box so they scale with it. Percentages cannot do this job: a percentage
 * inside `translateX` resolves against the *label's own* width, which is what
 * used to drag every name into a heap around the hub.
 */
const LABEL_IN = HUB + 5;
const LABEL_OUT = RADIUS - RIM - 4;
/** Radial room a name has to run in, and the radius its centre line rides. */
const LABEL_RUN = LABEL_OUT - LABEL_IN;
const LABEL_TRACK = (LABEL_IN + LABEL_OUT) / 2;

/** Canvas pixels as a share of the wheel box's width. */
const cqw = (px: number) => `${((px / SIZE) * 100).toFixed(2)}cqw`;

/**
 * Type size for a wheel of `count` names.
 *
 * The constraint is tangential, not radial: a name is laid along its own
 * bisector, so what has to fit between the two cuts is the height of the
 * line. Whole pixels, because a wedge label is small, upright type sitting on
 * a saturated ground and fractional sizes only blur it.
 */
function labelFontPx(count: number): number {
  const chord = count === 1 ? Infinity : 2 * LABEL_TRACK * Math.sin(Math.PI / count);
  return Math.max(9, Math.min(13, Math.floor(chord)));
}

/**
 * How wide the wheel is allowed to get, for the caller to set. The wheel is
 * square and scales freely — only its surroundings know how much room there is,
 * so the size is theirs to state and 420px is only the fallback.
 */
const WHEEL_MAX = 'var(--wheel-max, 420px)';

export type SpinResult = {
  spinId: string;
  winnerLabel: string;
  /**
   * True when the draw has only just happened. False when the wheel is showing
   * a result it found already finished — a refresh, or someone arriving late.
   */
  fresh: boolean;
};

type WheelProps = {
  entries: WheelEntryView[];
  spin: SpinView | null;
  /** Fired once the wheel is at rest, with the spin it came to rest on. */
  onSpinSettled?: (result: SpinResult) => void;
};

export function Wheel({ entries, spin, onSpinSettled }: WheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<HTMLDivElement>(null);
  const rotationRef = useRef(0);
  const settledRef = useRef<string | null>(null);
  /** The entry whose wedge has already fallen — a wedge falls once. */
  const droppedRef = useRef<string | null>(null);
  /** Which label span carries the accent styles, so we know what to clear. */
  const accentedLabelRef = useRef(-1);
  /**
   * Where the current spin set off from and where it lands.
   *
   * Pinned for the life of the spin: the roster stream re-runs the animation
   * effect whenever anything on the wheel changes, and recomputing the arc
   * from the rotation of the moment would jump the wheel mid-flight.
   */
  const arcRef = useRef<{ key: string; from: number; target: number } | null>(null);

  // The callback lands in a ref: a parent re-render must never restart a spin.
  const settledCallback = useRef(onSpinSettled);
  useEffect(() => {
    settledCallback.current = onSpinSettled;
  }, [onSpinSettled]);

  /**
   * The names the canvas is drawn from. It deliberately lags `entries`: when
   * the winner is dropped off the wheel, their wedge has to fall out *before*
   * the others close the gap.
   */
  const [layout, setLayout] = useState<WheelEntryView[]>(() => entries.filter((e) => e.active));
  const [drop, setDrop] = useState<{ index: number; startedAt: number } | null>(null);
  /**
   * The spin the wheel is currently flying along, if any. State rather than a
   * ref because the roster is held back while it is set, and letting go has to
   * re-run the effect that does the holding.
   */
  const [animating, setAnimating] = useState<string | null>(null);

  // Primitives, not objects: the stream hands us a fresh `spin` object on every
  // frame and the animation must not read that as a new spin.
  const spinId = spin?.id ?? null;
  const spinStartedAt = spin?.startedAt ?? 0;
  const winnerLabel = spin?.winnerLabel ?? null;

  const layoutSignature = useMemo(
    () => layout.map((e) => `${e.id}:${e.label}`).join(','),
    [layout],
  );

  // ---- keep the drawn layout in step with the roster ----------------------
  useEffect(() => {
    const active = entries.filter((e) => e.active);
    if (active.map((e) => `${e.id}:${e.label}`).join(',') === layoutSignature) return;

    if (drop) return; // hold everything until the wedge has finished falling
    // Nothing may change under a turning wheel: the segment count is baked
    // into the arc it is flying along, and the names are printed on it. A
    // change that lands mid-spin waits for the wheel to stop, then plays.
    if (animating !== null) return;

    // Somebody has left the wheel — the winner benched after a spin, or a name
    // the admin dropped by hand. Either way the wedge falls out before the
    // rest close the gap. `droppedRef` matters: the held layout still looks
    // droppable on the render right after the wedge lands, and without it the
    // fall would loop.
    const falling = droppedIndex(layout, active);
    if (falling >= 0 && droppedRef.current !== layout[falling].id) {
      droppedRef.current = layout[falling].id;
      setDrop({ index: falling, startedAt: Date.now() });
      return;
    }

    // Cleared on the way past, so the same name can be dropped again later.
    droppedRef.current = null;
    setLayout(active);
  }, [entries, layout, layoutSignature, drop, animating]);

  const palette = useMemo(() => {
    const colors = layout.map((_, i) => SEGMENT_COLORS[i % SEGMENT_COLORS.length]);
    // Stop the wheel closing on two identical neighbours.
    if (colors.length > 2 && colors[0] === colors[colors.length - 1]) {
      colors[colors.length - 1] = SEGMENT_COLORS[(layout.length + 1) % SEGMENT_COLORS.length];
    }
    return colors;
  }, [layout]);

  const lookup = useMemo(() => buildLookup(), []);

  // ---- render + animate ---------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const image = ctx.createImageData(SIZE, SIZE);
    const data = image.data;
    const rgb = palette.map(hexToRgb);
    const rim = hexToRgb(RIM_COLOR);
    const hub = hexToRgb(HUB_COLOR);
    const hubEdge = hexToRgb(HUB_EDGE);
    const count = Math.max(layout.length, 1);
    const segment = 360 / count;
    const { angle, band } = lookup;

    // The canvas is scaled up to fill the panel, so any nudge applied to a DOM
    // layer has to be scaled the same way or it will not line up.
    const displayScale = (labelsRef.current?.clientWidth || SIZE) / SIZE;

    /** Which segment a lookup entry falls in, at a normalised rotation. */
    const segmentAt = (index: number, offsetDeg: number) => {
      let local = angle[index] - offsetDeg;
      local -= Math.floor(local / 360) * 360;
      return Math.min(count - 1, Math.floor(local / segment));
    };

    const paintLabels = (rotation: number, accent: Accent | null) => {
      const labels = labelsRef.current;
      if (!labels) return;
      labels.style.transform = `rotate(${rotation}deg)`;

      const previous = accentedLabelRef.current;
      if (previous >= 0 && previous !== (accent?.index ?? -1)) {
        const stale = labels.children[previous] as HTMLElement | undefined;
        if (stale) {
          stale.style.removeProperty('--pop');
          stale.style.removeProperty('opacity');
        }
      }
      accentedLabelRef.current = accent?.index ?? -1;
      if (!accent) return;

      const el = labels.children[accent.index] as HTMLElement | undefined;
      if (!el) return;
      el.style.setProperty('--pop', `${(accent.offset * displayScale).toFixed(1)}px`);
      // Quantised, so the name blinks out in steps with the wedge under it.
      el.style.opacity = `${1 - Math.round(accent.dissolve * 3) / 3}`;
    };

    const paint = (rotation: number, accent: Accent | null) => {
      // Normalise once; the inner loop must stay branch-light.
      const offsetDeg = ((rotation % 360) + 360) % 360;
      // While the wedge is out of its slot, the slot is a hole in the disc.
      const hole = accent ? accent.index : -1;

      for (let i = 0; i < SIZE * SIZE; i += 1) {
        const o = i * 4;
        const b = band[i] as Band;

        if (b === 0) {
          data[o + 3] = 0;
          continue;
        }

        let color: [number, number, number];
        if (b === 3) {
          color = i % 2 === 0 ? hub : hubEdge;
        } else {
          const seg = segmentAt(i, offsetDeg);
          if (seg === hole) {
            data[o + 3] = 0;
            continue;
          }
          color = b === 1 ? rim : (rgb[seg] ?? rim);
        }

        data[o] = color[0];
        data[o + 1] = color[1];
        data[o + 2] = color[2];
        data[o + 3] = 255;
      }

      // Second pass: the detached wedge, slid along its own bisector.
      if (accent) {
        const bisector = ((rotation + segmentCenter(accent.index, count)) * Math.PI) / 180;
        const ox = Math.round(accent.offset * Math.sin(bisector));
        const oy = Math.round(-accent.offset * Math.cos(bisector));
        const face = mix(rgb[accent.index] ?? rim, GLOW_COLOR, 0.3);
        const threshold = accent.dissolve * 16;

        for (let y = 0; y < SIZE; y += 1) {
          const sy = y - oy;
          if (sy < 0 || sy >= SIZE) continue;
          for (let x = 0; x < SIZE; x += 1) {
            const sx = x - ox;
            if (sx < 0 || sx >= SIZE) continue;
            const j = sy * SIZE + sx;
            const b = band[j] as Band;
            if (b !== 1 && b !== 2) continue;
            if (segmentAt(j, offsetDeg) !== accent.index) continue;
            if (BAYER[(y & 3) * 4 + (x & 3)] < threshold) continue;

            const color = b === 1 ? rim : face;
            const o = (y * SIZE + x) * 4;
            data[o] = color[0];
            data[o + 1] = color[1];
            data[o + 2] = color[2];
            data[o + 3] = 255;
          }
        }
      }

      ctx.putImageData(image, 0, 0);
      paintLabels(rotation, accent);
      rotationRef.current = rotation;
    };

    /** The pointer is shoved sideways by pegs, and lifted by a rising wedge. */
    const paintPointer = (flick: number, lift: number) => {
      const el = pointerRef.current;
      if (!el) return;
      const y = (Math.min(lift, POP_PX) * displayScale).toFixed(1);
      el.style.transform = `translateX(-50%) translateY(-${y}px) rotate(${(flick * 20).toFixed(1)}deg)`;
    };

    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---- the wedge falling out of the wheel -------------------------------
    if (drop) {
      if (reduced) {
        paint(rotationRef.current, { index: drop.index, offset: DROP_PX, dissolve: 1 });
        setDrop(null);
        return;
      }
      let frame = requestAnimationFrame(function fall() {
        const p = Math.min(1, (Date.now() - drop.startedAt) / DROP_MS);
        paint(rotationRef.current, {
          index: drop.index,
          offset: Math.round(POP_PX + (DROP_PX - POP_PX) * p),
          dissolve: p,
        });
        paintPointer(0, POP_PX * (1 - p));
        if (p < 1) frame = requestAnimationFrame(fall);
        else setDrop(null);
      });
      return () => cancelAnimationFrame(frame);
    }

    /**
     * Report a spin as finished. `fresh` is false whenever nobody watched this
     * client's wheel land on it — a restored spin, or one with no wedge left to
     * fly to. A spin is reported once, which is what `settledRef` is for.
     */
    const settle = (id: string, label: string, fresh: boolean) => {
      setAnimating(null);
      if (settledRef.current === id) return;
      settledRef.current = id;
      settledCallback.current?.({ spinId: id, winnerLabel: label, fresh });
    };

    const winnerIndex = winnerLabel ? layout.findIndex((e) => e.label === winnerLabel) : -1;

    // No spin yet, or the winner is no longer on the wheel: just sit there.
    if (spinId === null || winnerLabel === null || winnerIndex < 0) {
      paint(rotationRef.current, null);
      paintPointer(0, 0);
      // Whatever the roster is waiting to do, it is not waiting on this.
      setAnimating(null);
      // A draw whose winner has since left the wheel — dropped by the admin,
      // by hand or automatically — as seen by whoever arrives next. There is no
      // wedge to fly to, but the draw did happen, and a wheel that never
      // settles leaves the room reading "Spinning…" for good.
      if (spinId !== null && winnerLabel !== null) settle(spinId, winnerLabel, false);
      return;
    }

    const arcKey = `${spinId}:${count}:${winnerIndex}`;
    if (arcRef.current?.key !== arcKey) {
      const from = rotationRef.current;
      arcRef.current = {
        key: arcKey,
        from,
        target: spinTarget(from, winnerIndex, count, turnsFor(spinId)),
      };
    }
    const { from, target } = arcRef.current;
    const atRest: Accent = { index: winnerIndex, offset: POP_PX, dissolve: 0 };

    const elapsed = Date.now() - spinStartedAt;
    const over = elapsed >= SPIN_DURATION_MS + POP_MS || elapsed < 0;

    // A spin from an earlier session — or a viewer who asked for less motion:
    // show the result, don't play the show. A live draw still counts as fresh
    // for anyone downstream, whether or not this client animated it.
    if (over || reduced) {
      paint(target, atRest);
      paintPointer(0, POP_PX);
      settle(spinId, winnerLabel, !over);
      return;
    }

    setAnimating(spinId);

    const travel = target - from;
    // Where the wheel actually is right now, which is `from` on a fresh spin
    // and wherever it had got to if this effect was restarted mid-flight.
    let previous = rotationRef.current;
    let lastSegment = segmentUnderPointer(previous, count);
    let flick = 0;

    let frame = requestAnimationFrame(function step() {
      const since = Date.now() - spinStartedAt;
      const t = Math.min(1, since / SPIN_DURATION_MS);
      const rotation = from + travel * spinProgress(t) - windupDeg(t);

      // Once the wheel is still, the chosen wedge lifts out of the disc.
      const popped = Math.min(1, Math.max(0, (since - SPIN_DURATION_MS) / POP_MS));
      const offset = Math.round(POP_PX * popped);
      paint(rotation, offset > 0 ? { ...atRest, offset } : null);

      // The pointer clacks over every segment edge, softer as the wheel dies.
      const segmentNow = segmentUnderPointer(rotation, count);
      if (segmentNow !== lastSegment) {
        lastSegment = segmentNow;
        flick = Math.min(1, Math.abs(rotation - previous) / 6);
      }
      flick *= 0.78;
      previous = rotation;
      paintPointer(flick, offset);

      if (t >= 1) settle(spinId, winnerLabel, true);
      if (popped < 1) frame = requestAnimationFrame(step);
      else paintPointer(0, POP_PX);
    });

    return () => cancelAnimationFrame(frame);
  }, [layout, palette, lookup, drop, spinId, spinStartedAt, winnerLabel]);

  if (layout.length === 0) {
    return (
      <div
        className="px-panel-sunken grid aspect-square w-full place-items-center p-8 text-center"
        style={{ maxWidth: WHEEL_MAX }}
      >
        <p className="text-[color:var(--color-ink-dim)]">
          Nobody is on the wheel yet.
          <br />
          Add names to start the rotation.
        </p>
      </div>
    );
  }

  const segment = 360 / layout.length;
  const fontPx = labelFontPx(layout.length);

  return (
    <div className="relative mx-auto w-full" style={{ maxWidth: WHEEL_MAX }}>
      {/*
        Pointer, drawn as stacked pixel rows rather than a smooth triangle. It
        hangs from the rail above and bites *into* the rim, so the segment
        edges have something to push against.
      */}
      <div
        ref={pointerRef}
        className="absolute left-1/2 top-[-12px] z-20 origin-top"
        style={{ transform: 'translateX(-50%)' }}
        aria-hidden
      >
        <svg width="28" height="30" viewBox="0 0 14 15" className="pixel-art">
          {/* the shaft, then the arrowhead's black silhouette */}
          <rect x="4" y="0" width="6" height="8" fill="#0b0716" />
          <path
            d="M0 8h14v1h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1h-1v-1z"
            fill="#0b0716"
          />
          {/* rose fill, inset by one pixel all the way round */}
          <rect x="5" y="1" width="4" height="7" fill="#ef5f6b" />
          <path d="M2 9h10v1h-1v1h-1v1h-1v1h-1v1h-2v-1h-1v-1h-1v-1h-1v-1h-1v-1z" fill="#ef5f6b" />
          {/* top-lit highlight: the shaft and the shoulder of the head */}
          <rect x="5" y="1" width="4" height="3" fill="#ff9aa2" />
          <rect x="2" y="9" width="10" height="1" fill="#ff9aa2" />
        </svg>
      </div>

      <div className="px-panel aspect-square p-3">
        {/* Labels size themselves in `cqw`, so the wheel box is the container. */}
        <div className="relative h-full w-full" style={{ containerType: 'inline-size' }}>
          <canvas
            ref={canvasRef}
            width={SIZE}
            height={SIZE}
            className="pixel-art h-full w-full"
            role="img"
            aria-label={`Wheel with ${layout.length} ${layout.length === 1 ? 'name' : 'names'}`}
          />

          {/* Labels ride on top of the canvas and rotate with it. */}
          <div ref={labelsRef} className="pointer-events-none absolute inset-0" aria-hidden>
            {layout.map((entry, index) => {
              const center = index * segment + segment / 2;
              // Names on the left half would otherwise read upside down. The
              // flip turns the name about its own middle — it must not be
              // folded into the outer transform, whose origin is the hub.
              const flip = center > 180;
              return (
                <span
                  key={entry.id}
                  className="absolute left-1/2 top-1/2 block"
                  style={{
                    width: cqw(LABEL_RUN),
                    height: `${fontPx + 4}px`,
                    marginTop: `-${(fontPx + 4) / 2}px`,
                    transformOrigin: '0 50%',
                    // `--pop` is driven by the animation loop: a winning name
                    // slides outward with the wedge it is printed on.
                    transform: `rotate(${center - 90}deg) translateX(${cqw(LABEL_IN)}) translateX(var(--pop, 0px))`,
                  }}
                >
                  <span
                    className="flex h-full w-full items-center justify-center font-semibold text-[#120c22]"
                    style={{
                      fontSize: `${fontPx}px`,
                      lineHeight: 1,
                      transform: flip ? 'rotate(180deg)' : undefined,
                      textShadow: '0 1px 0 rgba(255,255,255,.35)',
                    }}
                  >
                    <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                      {entry.label}
                    </span>
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

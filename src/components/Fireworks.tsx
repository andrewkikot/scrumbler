'use client';

import { useEffect, useRef } from 'react';
import {
  createShow,
  RING_MS,
  ringAt,
  SHELL_COLORS,
  SHOW_MS,
  shellAt,
  sparksAt,
} from '@/lib/fireworks';

/**
 * Fireworks over the room when the wheel lands on a name.
 *
 * Like the wheel, this is rasterised coarse and scaled up with
 * `image-rendering: pixelated`: the canvas carries one pixel per 4 display
 * pixels, so a star is a hard 4px square on the same grid as every border and
 * bevel in the app. Drawing them at device resolution would give soft round
 * dots — pretty, and from a different product.
 *
 * It covers the window rather than the wheel. A draw is the loudest moment
 * this app has, and shells going off behind the roster and over the header is
 * the difference between a celebration and a decoration in one corner.
 */

/** Display pixels per canvas pixel. The grid the whole UI is built on. */
const PIXEL = 4;

/**
 * Three stops per shell: the flash, the burning star, the dying ember. A star
 * steps between them rather than fading through them — the palette is fixed,
 * so colour change is the only way to show something cooling.
 */
const RAMPS: [string, string, string][] = [
  ['#fff4de', '#ffb43c', '#c47d16'],
  ['#dffff8', '#4fd6c0', '#1f8f80'],
  ['#ece0ff', '#a97bff', '#6a40c0'],
  ['#ffe2e4', '#ef5f6b', '#a8323d'],
  ['#f2ffdb', '#9ede4c', '#5f9b23'],
];

/** Ordered 4×4 dither: an ember crumbles away in pixels, not in opacity. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** The trail behind a climbing shell, brightest at the nose. */
const TRAIL = 5;

/** How long a crackling star holds each half of its flicker. */
const TWINKLE_MS = 70;

type FireworksProps = {
  /** The spin being celebrated: the same seed gives every client one show. */
  seed: string;
  /** Fired when the last ember is out, so the caller can unmount us. */
  onDone?: () => void;
};

export function Fireworks({ seed, onDone }: FireworksProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Nothing is announced here that the result line does not already say in
    // words, so a viewer who asked for less motion gets no show at all.
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const timer = setTimeout(() => doneRef.current?.(), 0);
      return () => clearTimeout(timer);
    }

    const show = createShow(seed);
    const startedAt = performance.now();

    /** Canvas pixels, recomputed whenever the window changes size. */
    let width = 0;
    let height = 0;

    const measure = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth / PIXEL));
      const h = Math.max(1, Math.round(canvas.clientHeight / PIXEL));
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = width;
      canvas.height = height;
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);

    /** A star's colour, stepped through the ramp by how long it has burned. */
    const emberColor = (color: number, age: number) => {
      const ramp = RAMPS[color % SHELL_COLORS];
      if (age < 0.16) return ramp[0];
      if (age < 0.58) return ramp[1];
      return ramp[2];
    };

    /**
     * One ring of the shockwave, walked with the midpoint circle algorithm —
     * which is also why it looks right here: a rasterised circle has the
     * stair-stepped edge this UI is built from, where a stroked arc would not.
     */
    const strokeRing = (cx: number, cy: number, radius: number, dissolve: number) => {
      const threshold = dissolve * 16;
      const dot = (x: number, y: number) => {
        if (BAYER[(y & 3) * 4 + (x & 3)] < threshold) return;
        ctx.fillRect(x, y, 1, 1);
      };

      let x = Math.round(radius);
      let y = 0;
      let error = 0;
      while (x >= y) {
        dot(cx + x, cy + y);
        dot(cx + y, cy + x);
        dot(cx - y, cy + x);
        dot(cx - x, cy + y);
        dot(cx - x, cy - y);
        dot(cx - y, cy - x);
        dot(cx + y, cy - x);
        dot(cx + x, cy - y);
        y += 1;
        error += 1 + 2 * y;
        if (2 * (error - x) + 1 > 0) {
          x -= 1;
          error += 1 - 2 * x;
        }
      }
    };

    let frame = requestAnimationFrame(function draw() {
      const t = performance.now() - startedAt;
      // The field is measured in heights, so the box's aspect is how wide it is.
      const aspect = width / height;
      // Which half of the flicker every crackling star is in this frame.
      const lit = Math.floor(t / TWINKLE_MS) % 2 === 0;
      ctx.clearRect(0, 0, width, height);

      for (const burst of show) {
        const ramp = RAMPS[burst.color % SHELL_COLORS];

        const shell = shellAt(burst, t, aspect);
        if (shell) {
          const x = Math.round(shell.x * height);
          const y = Math.round((1 - shell.y) * height);
          for (let i = 0; i < TRAIL; i += 1) {
            // The nose is the flash colour and the smoke behind it the ember.
            // The tail of that is thinned by dropping pixels rather than by
            // dimming them: in a fixed palette there is no dimmer.
            if (i > 2 && (y + i) % 2 === 0) continue;
            ctx.fillStyle = ramp[Math.min(i, 2)];
            ctx.fillRect(x, y + i, 1, 1);
          }
        }

        const ring = ringAt(burst, t);
        if (ring) {
          const cx = Math.round(burst.burstX * aspect * height);
          const cy = Math.round((1 - burst.burstY) * height);
          ctx.fillStyle = ring.age < 0.4 ? ramp[0] : ramp[1];
          strokeRing(cx, cy, ring.radius * height, ring.age);
          // A heavy shell throws a second ring inside the first, which is what
          // makes the finale read as bigger rather than merely as more.
          if (burst.heavy && ring.age > 0.25) {
            ctx.fillStyle = ramp[1];
            strokeRing(cx, cy, ring.radius * height * 0.62, ring.age * 0.8);
          }
        }

        const sparks = sparksAt(burst, t, aspect);
        for (let i = 0; i < sparks.length; i += 1) {
          const spark = sparks[i];
          // A crackler's stars drop in and out in alternating halves, so the
          // burst seethes instead of merely drifting.
          if (burst.twinkle && spark.age > 0.3 && (i % 2 === 0) !== lit) continue;

          const x = Math.round(spark.x * height);
          const y = Math.round((1 - spark.y) * height);
          // Late on, the ember starts dropping pixels, so it goes out in steps
          // instead of dissolving into whatever is behind it. It holds together
          // for most of its life first: a burst that starts breaking up early
          // is a scatter of dots for longer than it is a firework.
          const threshold = Math.max(0, (spark.age - 0.7) / 0.3) * 16;
          if (threshold > 0 && BAYER[(y & 3) * 4 + (x & 3)] < threshold) continue;
          ctx.fillStyle = emberColor(burst.color, spark.age);
          // The flash is fat, the ember is a single pixel.
          const size = spark.age < 0.2 ? (burst.heavy ? 3 : 2) : 1;
          ctx.fillRect(x, y, size, size);
        }
      }

      // The rings of the last shells outlive the show by their own length.
      if (t < SHOW_MS + RING_MS) frame = requestAnimationFrame(draw);
      else doneRef.current?.();
    });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [seed]);

  return (
    <canvas
      ref={canvasRef}
      className="pixel-art pointer-events-none fixed inset-0 z-50 h-full w-full"
      aria-hidden
    />
  );
}

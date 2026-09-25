'use client';

import { useEffect, useMemo, useRef } from 'react';
import { SPIN_DURATION_MS, type SpinView, type WheelEntryView } from '@/lib/types';
import { easeOutQuart, restAngle, segmentUnderPointer, turnsFor } from '@/lib/wheel';

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
const RADIUS = 86;
const RIM = 6;
const HUB = 15;

/** Console-palette segment colours, cycled around the wheel. */
const SEGMENT_COLORS = ['#ffb43c', '#4fd6c0', '#a97bff', '#ef5f6b', '#9ede4c'];
const RIM_COLOR = '#0b0716';
const HUB_COLOR = '#f4ead8';
const HUB_EDGE = '#0b0716';

type Band = 0 | 1 | 2 | 3; // outside | rim | face | hub

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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

type WheelProps = {
  entries: WheelEntryView[];
  spin: SpinView | null;
  /** Fired once the wheel is at rest, with the spin it came to rest on. */
  onSpinSettled?: (spinId: string, winnerLabel: string) => void;
};

export function Wheel({ entries, spin, onSpinSettled }: WheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<HTMLDivElement>(null);
  const rotationRef = useRef(0);
  const settledRef = useRef<string | null>(null);

  const active = useMemo(() => entries.filter((e) => e.active), [entries]);

  const palette = useMemo(() => {
    const colors = active.map((_, i) => SEGMENT_COLORS[i % SEGMENT_COLORS.length]);
    // Stop the wheel closing on two identical neighbours.
    if (colors.length > 2 && colors[0] === colors[colors.length - 1]) {
      colors[colors.length - 1] = SEGMENT_COLORS[(active.length + 1) % SEGMENT_COLORS.length];
    }
    return colors;
  }, [active]);

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
    const count = Math.max(active.length, 1);
    const segment = 360 / count;
    const { angle, band } = lookup;

    const paint = (rotation: number) => {
      // Normalise once; the inner loop must stay branch-light.
      const offset = ((rotation % 360) + 360) % 360;

      for (let i = 0; i < SIZE * SIZE; i += 1) {
        const o = i * 4;
        const b = band[i] as Band;

        if (b === 0) {
          data[o + 3] = 0;
          continue;
        }

        let color: [number, number, number];
        if (b === 1) color = rim;
        else if (b === 3) color = i % 2 === 0 ? hub : hubEdge;
        else {
          let local = angle[i] - offset;
          local -= Math.floor(local / 360) * 360;
          color = rgb[Math.min(count - 1, Math.floor(local / segment))] ?? rim;
        }

        data[o] = color[0];
        data[o + 1] = color[1];
        data[o + 2] = color[2];
        data[o + 3] = 255;
      }

      ctx.putImageData(image, 0, 0);
      if (labelsRef.current) labelsRef.current.style.transform = `rotate(${rotation}deg)`;
      rotationRef.current = rotation;
    };

    // Where the wheel must come to rest for `spin` to be under the pointer.
    const targetAngle = (() => {
      if (!spin) return rotationRef.current;
      const index = active.findIndex((e) => e.label === spin.winnerLabel);
      if (index < 0) return rotationRef.current;
      return restAngle(index, count, turnsFor(spin.id));
    })();

    if (!spin) {
      paint(rotationRef.current);
      return;
    }

    const elapsed = Date.now() - spin.startedAt;

    // A spin from an earlier session: show the result, don't replay the show.
    if (elapsed >= SPIN_DURATION_MS || elapsed < 0) {
      paint(targetAngle);
      if (settledRef.current !== spin.id) {
        settledRef.current = spin.id;
        onSpinSettled?.(spin.id, spin.winnerLabel);
      }
      return;
    }

    const from = rotationRef.current;
    const travel = targetAngle - from;
    let frame = 0;
    let lastSegment = -1;

    const step = () => {
      const t = Math.min(1, (Date.now() - spin.startedAt) / SPIN_DURATION_MS);
      const rotation = from + travel * easeOutQuart(t);
      paint(rotation);

      // The pointer flicks as each segment clacks past it.
      const under = segmentUnderPointer(rotation, count);
      if (pointerRef.current) {
        if (under !== lastSegment) {
          lastSegment = under;
          pointerRef.current.style.transform = 'translateX(-50%) rotate(-18deg)';
        } else {
          pointerRef.current.style.transform = 'translateX(-50%) rotate(0deg)';
        }
      }

      if (t < 1) {
        frame = requestAnimationFrame(step);
      } else {
        settledRef.current = spin.id;
        onSpinSettled?.(spin.id, spin.winnerLabel);
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [active, palette, spin, lookup, onSpinSettled]);

  if (active.length === 0) {
    return (
      <div className="px-panel-sunken grid aspect-square w-full max-w-[420px] place-items-center p-8 text-center">
        <p className="font-display text-[color:var(--color-ink-dim)]">
          Nobody is on the wheel yet.
          <br />
          Add names to start the rotation.
        </p>
      </div>
    );
  }

  const segment = 360 / active.length;

  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      {/* Pointer, drawn as stacked pixel rows rather than a smooth triangle. */}
      <div
        ref={pointerRef}
        className="absolute left-1/2 top-[-10px] z-20 origin-top"
        style={{ transform: 'translateX(-50%)', transition: 'transform 90ms steps(2)' }}
        aria-hidden
      >
        <svg width="28" height="34" viewBox="0 0 14 17" className="pixel-art">
          <path
            d="M6 0h2v1h1v1h1v1h1v1h1v1h1v1h1v2H0V6h1V5h1V4h1V3h1V2h1V1h1z"
            fill="#0b0716"
          />
          <path d="M6 1h2v1h1v1h1v1h1v1h1v1h1v1H1V6h1V5h1V4h1V3h1V2h1z" fill="#ef5f6b" />
          <path d="M6 2h2v1h1v1h1v1h1v1H2V5h1V4h1V3h1z" fill="#ff9aa2" />
          <rect x="4" y="8" width="6" height="9" fill="#0b0716" />
          <rect x="5" y="8" width="4" height="8" fill="#ef5f6b" />
        </svg>
      </div>

      <div className="px-panel aspect-square p-3">
        <div className="relative h-full w-full">
          <canvas
            ref={canvasRef}
            width={SIZE}
            height={SIZE}
            className="pixel-art h-full w-full"
            role="img"
            aria-label={`Wheel with ${active.length} ${active.length === 1 ? 'name' : 'names'}`}
          />

          {/* Labels ride on top of the canvas and rotate with it. */}
          <div ref={labelsRef} className="pointer-events-none absolute inset-0" aria-hidden>
            {active.map((entry, index) => {
              const center = index * segment + segment / 2;
              const flip = center > 180;
              return (
                <span
                  key={entry.id}
                  className="font-display absolute left-1/2 top-1/2 flex items-center text-[11px] font-semibold text-[#120c22]"
                  style={{
                    width: '38%',
                    height: 14,
                    marginTop: -7,
                    transformOrigin: '0 50%',
                    transform: `rotate(${center - 90}deg) translateX(9%)${flip ? ' rotate(180deg)' : ''}`,
                    justifyContent: flip ? 'flex-end' : 'flex-start',
                    textShadow: '0 1px 0 rgba(255,255,255,.35)',
                  }}
                >
                  <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                    {entry.label}
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

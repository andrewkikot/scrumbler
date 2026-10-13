'use client';

/**
 * The timer's "time's up": three square-wave blips, the sound this room's
 * pixels would make. Synthesised rather than shipped as a file — it is three
 * notes, and nothing has to load before the first timer runs out.
 */
let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  try {
    context ??= new AudioContext();
    return context;
  } catch {
    return null;
  }
}

/**
 * Browsers only let a page make sound after the viewer has interacted with it,
 * and may suspend it again later (Safari on any interruption, Chrome in a
 * background tab). Call this from every user gesture, not just the first.
 */
export function unlockChime(): void {
  const ctx = getContext();
  if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => {});
}

function schedule(ctx: AudioContext): void {
  const start = ctx.currentTime + 0.03;
  [988, 784, 1319].forEach((frequency, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = frequency;
    const at = start + i * 0.2;
    // A short ramp each side: a square wave cut off mid-cycle clicks.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.15, at + 0.01);
    gain.gain.setValueAtTime(0.15, at + 0.15);
    gain.gain.linearRampToValueAtTime(0, at + 0.17);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.18);
  });
}

/**
 * Play the chime, waking the audio context first if the browser put it to
 * sleep. `resume()` is asynchronous — checking the state straight after
 * calling it always sees "suspended", which is how this used to stay silent.
 * Resolves false when the browser still refuses (no gesture on this page yet).
 */
export async function playChime(): Promise<boolean> {
  const ctx = getContext();
  if (!ctx) return false;
  try {
    // Chrome leaves a disallowed resume() pending rather than rejecting it, and
    // a chime that finally sounds on some later click would be worse than none.
    if (ctx.state !== 'running') {
      await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 400))]);
    }
  } catch {
    return false;
  }
  if (ctx.state !== 'running') return false;
  schedule(ctx);
  return true;
}

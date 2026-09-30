// The cockpit's per-frame fan-out: the engine hands each frame's canopy and
// gauges to Cockpit.svelte, which passes them on to every instrument that
// needs to move with the render (the attitude ball, the lever's servo, the
// console's turn with the head). Hooks write to the DOM directly.

import type { CockpitFrame } from '../../engine/cockpit.ts';
import type { ShipGauges } from '../../engine/camera/ship.ts';

export type FrameHook = (f: CockpitFrame, g: ShipGauges, dt: number) => void;

const hooks = new Set<FrameHook>();
let last = 0;

/** Call `fn` every frame while in the cockpit; returns the unsubscribe (for onMount). */
export function onFrame(fn: FrameHook): () => void {
  hooks.add(fn);
  return () => hooks.delete(fn);
}

export function emitFrame(f: CockpitFrame, g: ShipGauges): void {
  const now = performance.now();
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  for (const h of hooks) h(f, g, dt);
}

/** Ease `x` toward `to` over about `tau` seconds, exact for any step. */
export function follow(x: number, to: number, dt: number, tau: number): number {
  return to + (x - to) * Math.exp(-dt / tau);
}

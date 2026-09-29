// Ship-mode input: flying from the cockpit.
//  - Scroll / pinch, +/-: fly along the heading
//  - W/S thrust, A/D strafe, R/F rise and sink, Shift boost, Alt fine
//  - Drag: steer by grabbing the sky (it follows the pointer, and a flick keeps turning); arrows pitch and yaw, Q/E roll
//  - Right-drag / Alt-drag: look around the cockpit (springs back on release)
//  - X all stop, C face the selected object, L level, H hide the canopy and instruments
// Keys are matched by physical position (e.code), so they work on any layout.

import type { ShipController } from './camera/ship.ts';
import type { Vec3 } from '../astro/vec.ts';

export interface ShipInputHooks {
  /** Turn to face the selected object (or the body the ship is with). */
  face(): void;
  toggleHud(): void;
}

export interface ShipInput {
  wheel(e: WheelEvent): void;
  /** Pinch: the ratio of finger spread to the last move's. */
  pinch(ratio: number): void;
  down(e: PointerEvent): void;
  move(e: PointerEvent, dx: number, dy: number): void;
  up(): void;
  /** True when the key was the ship's. */
  keydown(e: KeyboardEvent): boolean;
  keyup(e: KeyboardEvent): void;
  /** Let go of everything (window blur, leaving ship mode). */
  reset(): void;
}

const THRUST: Record<string, [number, number]> = {
  KeyD: [0, 1],
  KeyA: [0, -1],
  KeyR: [1, 1],
  KeyF: [1, -1],
  KeyW: [2, 1],
  KeyS: [2, -1],
};
const TURN: Record<string, [number, number]> = {
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowRight: [1, 1],
  ArrowLeft: [1, -1],
  KeyE: [2, 1],
  KeyQ: [2, -1],
};
const NUDGE: Record<string, number> = { Equal: 0.35, NumpadAdd: 0.35, Minus: -0.35, NumpadSubtract: -0.35 };

export function createShipInput(el: HTMLElement, ship: () => ShipController, hooks: ShipInputHooks): ShipInput {
  const held = new Set<string>();
  let drag: 'steer' | 'look' | null = null;

  const apply = () => {
    const thrust: Vec3 = [0, 0, 0];
    const turn: Vec3 = [0, 0, 0];
    for (const code of held) {
      const t = THRUST[code];
      if (t) thrust[t[0]] += t[1];
      const r = TURN[code];
      if (r) turn[r[0]] += r[1];
    }
    const has = (a: string, b: string) => held.has(a) || held.has(b);
    ship().setControls({ thrust, turn, boost: has('ShiftLeft', 'ShiftRight'), fine: has('AltLeft', 'AltRight') });
  };

  const input: ShipInput = {
    wheel(e) {
      // The orbit camera's zoom amounts, so one notch covers the same share of the way.
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      ship().nudge(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0022));
    },

    pinch(ratio) {
      ship().nudge(Math.log(ratio) * 1.6);
    },

    down(e) {
      drag = e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey) ? 'look' : 'steer';
      if (drag === 'steer') ship().beginGrab();
    },

    move(e, dx, dy) {
      if (drag === 'look') ship().look(dx, dy, el.clientHeight);
      else if (drag === 'steer') ship().grab(dx, dy, el.clientHeight);
    },

    up() {
      if (drag === 'look') ship().releaseLook();
      if (drag === 'steer') ship().releaseGrab();
      drag = null;
    },

    keydown(e) {
      const code = e.code;
      if (THRUST[code] || TURN[code] || code.startsWith('Shift') || code.startsWith('Alt')) {
        // Alt would otherwise focus the browser's menu bar on Windows.
        if (code.startsWith('Alt')) e.preventDefault();
        held.add(code);
        apply();
        return !code.startsWith('Shift') && !code.startsWith('Alt');
      }
      if (NUDGE[code] !== undefined) {
        ship().nudge(NUDGE[code]);
        return true;
      }
      if (e.repeat) return false;
      switch (code) {
        case 'KeyX':
          ship().stop();
          return true;
        case 'KeyC':
          hooks.face();
          return true;
        case 'KeyL':
          ship().level();
          return true;
        case 'KeyH':
          hooks.toggleHud();
          return true;
      }
      return false;
    },

    keyup(e) {
      if (!held.delete(e.code)) return;
      apply();
    },

    reset() {
      held.clear();
      if (drag === 'look') ship().releaseLook();
      if (drag === 'steer') ship().releaseGrab();
      drag = null;
      ship().setControls({ thrust: [0, 0, 0], turn: [0, 0, 0], boost: false, fine: false });
    },
  };
  return input;
}

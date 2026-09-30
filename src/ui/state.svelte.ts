// Reactive UI state shared between the engine loop and Svelte components.
// The engine writes (throttled); components read and call `actions`.

import type { ObjectInfo, SearchEntry } from '../scene/registry.ts';
import type { Landmark } from '../data/landmarks.ts';
import type { CockpitFrame } from '../engine/cockpit.ts';
import type { ShipGauges } from '../engine/camera/ship.ts';
import type { Sfx } from '../audio/foley.ts';
export type { SearchEntry, ShipGauges, Sfx };

/** A contact on the cockpit radar: on a unit disc, ahead up. */
export interface RadarContact {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Above (+) or below (−) the wings, radians. */
  el: number;
  /** Past the scope's range, pinned to its rim. */
  clipped: boolean;
  role: 'target' | 'frame' | 'other';
  /** From the ship to its center, m. */
  distance: number;
}

/** Cockpit instruments, refreshed about ten times a second in ship mode. */
export interface ShipReadout {
  /** m/s relative to the frame. */
  speed: number;
  /** Distance to the nearest surface (m): the scale speeds are measured in. */
  pace: number;
  /** Forward drift the throttle lever holds, and the ship's actual forward drift (pace units per second). */
  lever: number;
  drive: number;
  /** The autopilot has the throttle. */
  servo: boolean;
  boost: boolean;
  fine: boolean;
  /** Close to a surface. */
  prox: boolean;
  /** Name of the body the ship is moving with. */
  frame: string;
  /** Changing frames: the view is easing over to moving with a new body. */
  rebasing: boolean;
  /** The nearest body; `lat`/`lon` (degrees) of the point under the ship, longitude from local noon. */
  nearest: { name: string; altitude: number; lat: number | null; lon: number | null } | null;
  heading: { lon: number; lat: number; system: 'ecliptic' | 'galactic' };
  autopilot: { name: string; phase: 'turning' | 'cruising' | 'arriving' | 'facing'; distance: number; eta: number } | null;
  holding: string | null;
  /** Name of what's selected: where the engage lever would send the autopilot. */
  selected: string | null;
  radar: RadarContact[];
}

export const ui = $state({
  ready: false,
  timeMs: Date.now(),
  rate: 1,
  paused: false,
  focusId: 'earth',
  focusName: 'Earth',
  /** e.g. "Altitude 12,340 km" */
  distanceText: '',
  scaleText: '',
  selectedId: null as string | null,
  hoverId: null as string | null,
  settings: { labels: true, orbits: true, boost: false, constellations: false, smallBodies: true, location: true },
  /** Facts for the object named in the title. */
  card: null as ObjectInfo | null,
  depthMode: '' as string,
  fps: 0,
  assetsMissing: false,
  searchIndex: [] as SearchEntry[],
  creditsOpen: false,
  soundOn: true,
  /** The open top-right dropdown; they overlap, so only one at a time. */
  openMenu: null as 'search' | 'view' | null,
  /** The centered ⌘K palette for flying to a place. */
  paletteOpen: false,
  /** A landmark visit is pulling back or moving the clock, before its flight. */
  visiting: false,
  /** Map-like camera: drag pans, the wheel zooms toward the cursor. */
  freeMode: false,
  /** The view has been panned off the body it was centered on. */
  panned: false,
  /** Flying a ship from its cockpit instead of orbiting. */
  shipMode: false,
  ship: null as ShipReadout | null,
  /** The canopy and instruments are hidden (H), e.g. for a screenshot. */
  hudHidden: false,
  /** In the cockpit, the full timeline is raised over the console. */
  timeOpen: false,
});

export interface Actions {
  /** Set the speed and start playing. */
  setRate(rate: number): void;
  /** Set the speed or direction without starting or stopping playback. */
  setSpeed(rate: number): void;
  /** The clock right now; ui.timeMs is throttled, so the timeline reads this every frame. */
  readClock(): { ms: number; rate: number; paused: boolean };
  setPaused(p: boolean): void;
  setTime(ms: number): void;
  now(): void;
  /** `from`: arrive on the side of `id` facing this object. `stay`: keep the current distance. */
  flyTo(id: string, opts?: { from?: string; stay?: boolean }): void;
  /**
   * Rise clear of the body in view before a jump in time, so it isn't seen
   * spinning. True when the landmark is on the body in view (stay put instead).
   */
  pullBack(targetId: string): boolean;
  setFreeMode(on: boolean): void;
  setShipMode(on: boolean): void;
  /** Fly back to center on the body a pan left. */
  recenter(): void;
  /** Whether a flight under way is near the top of its climb (true when not flying). */
  flightHigh(): boolean;
  select(id: string | null): void;
  /** Search entries closest to the camera, nearest first. */
  nearby(limit: number): SearchEntry[];
  /** Distance (m) from the camera to an object's surface, or null if it has no position now or the camera is inside it. */
  distanceTo(id: string): number | null;
  toggle(key: keyof typeof ui.settings): void;
  setSound(on: boolean): void;
}

export const actions: Actions = {
  setRate: () => {},
  setSpeed: () => {},
  readClock: () => ({ ms: ui.timeMs, rate: ui.rate, paused: ui.paused }),
  setPaused: () => {},
  setTime: () => {},
  now: () => {},
  flyTo: () => {},
  pullBack: () => false,
  setFreeMode: () => {},
  setShipMode: () => {},
  recenter: () => {},
  flightHigh: () => true,
  select: () => {},
  nearby: () => [],
  distanceTo: () => null,
  toggle: () => {},
  setSound: () => {},
};

/**
 * The cockpit overlay's per-frame hook: the engine calls it from its frame
 * loop, so the canopy, markers and instruments never lag the render.
 */
export const cockpit = { sink: null as ((f: CockpitFrame, g: ShipGauges) => void) | null };

/** The cockpit's controls, bound to the ship by the app. */
export interface PilotActions {
  /** Take hold of the throttle lever (the autopilot lets go); returns the drift it holds. */
  takeLever(): number;
  /** Set the lever's drift (pace units per second); 0 is an all-stop. */
  setLever(drift: number): void;
  stop(): void;
  level(): void;
  /** Turn to face the selection, or the body the ship is with. */
  face(): void;
  /** Autopilot to the selection. */
  engage(): void;
  /** Let the autopilot go: the lever is at stop, so the ship coasts to rest. */
  disengage(): void;
  /** Leave the cockpit. */
  eject(): void;
  /** Star streaks for a thrown engage lever (set by the cockpit). */
  kick(): void;
}

export const pilot: PilotActions = {
  takeLever: () => 0,
  setLever: () => {},
  stop: () => {},
  level: () => {},
  face: () => {},
  engage: () => {},
  disengage: () => {},
  eject: () => {},
  kick: () => {},
};

/** Mechanical sounds for the cockpit's controls (silent when sound is off). */
export const sfx = { play: (_name: Sfx) => {} };

export function bindActions(a: Actions): void {
  Object.assign(actions, a);
}

export const nav = {
  /** Jump the clock to a landmark, then fly to its object. The timeline swaps in its eased jump when it mounts. */
  visit(lm: Landmark): void {
    actions.setTime(lm.ms);
    actions.flyTo(lm.target, { from: lm.from });
  },
  /** Play or pause; the timeline swaps in its own, which settles a scrub under way first. */
  togglePlay(): void {
    actions.setPaused(!actions.readClock().paused);
  },
};

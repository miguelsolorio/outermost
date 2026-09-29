// Reactive UI state shared between the engine loop and Svelte components.
// The engine writes (throttled); components read and call `actions`.

import type { ObjectInfo, SearchEntry } from '../scene/registry.ts';
import type { Landmark } from '../data/landmarks.ts';
export type { SearchEntry };

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
  /** `from`: arrive on the side of `id` facing this object. */
  flyTo(id: string, opts?: { from?: string }): void;
  /** Rise clear of the body in view before a jump in time, so it isn't seen spinning. */
  pullBack(): void;
  setFreeMode(on: boolean): void;
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
  pullBack: () => {},
  setFreeMode: () => {},
  recenter: () => {},
  flightHigh: () => true,
  select: () => {},
  nearby: () => [],
  distanceTo: () => null,
  toggle: () => {},
  setSound: () => {},
};

export function bindActions(a: Actions): void {
  Object.assign(actions, a);
}

export const nav = {
  /** Jump the clock to a landmark, then fly to its object. The timeline swaps in its eased jump when it mounts. */
  visit(lm: Landmark): void {
    actions.setTime(lm.ms);
    actions.flyTo(lm.target, { from: lm.from });
  },
};

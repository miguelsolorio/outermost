// Reactive UI state shared between the engine loop and Svelte components.
// The engine writes (throttled); components read and call `actions`.

import type { ObjectInfo, SearchEntry } from '../scene/registry.ts';
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
});

export interface Actions {
  setRate(rate: number): void;
  setPaused(p: boolean): void;
  setTime(ms: number): void;
  now(): void;
  flyTo(id: string): void;
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
  setPaused: () => {},
  setTime: () => {},
  now: () => {},
  flyTo: () => {},
  select: () => {},
  nearby: () => [],
  distanceTo: () => null,
  toggle: () => {},
  setSound: () => {},
};

export function bindActions(a: Actions): void {
  Object.assign(actions, a);
}

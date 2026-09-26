// Fuzzy matching shared by the search box and the command palette, so both rank places the same way.
// Timeline landmarks are searchable too, alongside the places.
import Fuse from 'fuse.js';
import { KIND_LABEL, LANDMARKS, type Landmark } from '../data/landmarks.ts';
import { actions, nav, type SearchEntry } from './state.svelte.ts';

export interface Match extends SearchEntry {
  /** Set when this result is a timeline landmark rather than a place. */
  event?: Landmark;
}

// Ranked after planets and named places, so "moon" still puts the Moon above its eclipses.
const EVENTS: Match[] = LANDMARKS.map((lm, i) => ({
  id: `event-${i}`,
  name: lm.name,
  aliases: [String(new Date(lm.ms).getUTCFullYear())],
  kind: KIND_LABEL[lm.kind],
  rank: 2,
  event: lm,
}));

let cached: { index: SearchEntry[]; fuse: Fuse<Match> } | null = null;

export function findMatches(index: SearchEntry[], query: string, limit: number): Match[] {
  if (cached?.index !== index) {
    cached = {
      index,
      fuse: new Fuse<Match>([...index, ...EVENTS], { keys: [{ name: 'name', weight: 2 }, 'aliases'], threshold: 0.3, includeScore: true }),
    };
  }
  return cached.fuse
    .search(query, { limit: 20 })
    .sort((a, b) => (a.score ?? 0) + a.item.rank * 0.02 - ((b.score ?? 0) + b.item.rank * 0.02))
    .slice(0, limit)
    .map((r) => r.item);
}

/** Fly to a place, or move the clock to a landmark and fly to its object. */
export function go(m: Match): void {
  if (m.event) nav.visit(m.event);
  else actions.flyTo(m.id);
}

// Fuzzy matching shared by the search box and the command palette, so both rank places the same way.
// Timeline landmarks are searchable too, alongside the places.
import Fuse from 'fuse.js';
import { KIND_LABEL, LANDMARKS, type Landmark } from '../data/landmarks.ts';
import { actions, nav, type SearchEntry } from './state.svelte.ts';

export interface Match extends SearchEntry {
  /** Set when this result is a timeline landmark rather than a place. */
  event?: Landmark;
}

/** Results shown per page; "Show more" adds another page. */
export const PAGE = 50;

// Ranked after planets and named places, so "moon" still puts the Moon above its eclipses.
const EVENTS: Match[] = LANDMARKS.map((lm, i) => ({
  id: `event-${i}`,
  name: lm.name,
  aliases: [String(new Date(lm.ms).getUTCFullYear())],
  kind: KIND_LABEL[lm.kind],
  rank: 2,
  event: lm,
}));

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

let cached: {
  index: SearchEntry[];
  fuse: Fuse<Match>;
  /** Each entry with the words of its subtext line (kind and detail), for prefix matching. */
  subtext: { item: Match; words: string[] }[];
  query: string;
  sorted: Match[];
} | null = null;

// A whole-word hit on the subtext counts as a close match: behind a near-exact name, ahead of a loose fuzzy one.
const SUBTEXT_SCORE = 0.1;

/** Fuzzy name matches plus places whose subtext ("Stellar black hole · Cygnus") has every query word as a word prefix. */
function search(query: string): Match[] {
  const c = cached!;
  const hits = c.fuse.search(query).map((r) => ({ item: r.item, score: r.score ?? 0 }));
  const seen = new Set(hits.map((h) => h.item.id));
  const terms = words(query);
  if (terms.length) {
    for (const s of c.subtext) {
      if (!seen.has(s.item.id) && terms.every((t) => s.words.some((w) => w.startsWith(t)))) hits.push({ item: s.item, score: SUBTEXT_SCORE });
    }
  }
  return hits.sort((a, b) => a.score + a.item.rank * 0.02 - (b.score + b.item.rank * 0.02)).map((h) => h.item);
}

export function findMatches(index: SearchEntry[], query: string, limit: number): { matches: Match[]; more: boolean } {
  if (cached?.index !== index) {
    const all: Match[] = [...index, ...EVENTS];
    cached = {
      index,
      fuse: new Fuse<Match>(all, { keys: [{ name: 'name', weight: 2 }, 'aliases'], threshold: 0.3, includeScore: true }),
      subtext: all.map((item) => ({ item, words: words(`${item.kind} ${item.detail ?? ''}`) })),
      query: '',
      sorted: [],
    };
  }
  if (cached.query !== query) {
    cached.query = query;
    cached.sorted = search(query);
  }
  return { matches: cached.sorted.slice(0, limit), more: cached.sorted.length > limit };
}

/** Fly to a place, or move the clock to a landmark and fly to its object. */
export function go(m: Match): void {
  if (m.event) nav.visit(m.event);
  else actions.flyTo(m.id);
}

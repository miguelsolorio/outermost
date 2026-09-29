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
  const ranked = hits.map((h) => ({ item: h.item, key: h.score + h.item.rank * 0.02, behind: false }));
  // A craft only there on some dates is part of a landmark from those dates ("apollo 11" is the
  // landing, not Columbia or Eagle), so it follows a matching one, unless its own name was typed.
  // Fuse alone ranks the craft first: their names are shorter than a landmark's sentence.
  const events = ranked.filter((r) => r.item.event);
  const typed = terms.join(' ');
  for (const r of ranked) {
    const { when, until = Infinity } = r.item;
    if (when === undefined || [r.item.name, ...(r.item.aliases ?? [])].some((n) => words(n).join(' ') === typed)) continue;
    for (const e of events) {
      const ms = e.item.event!.ms;
      if (ms >= when && ms <= until && e.key >= r.key) {
        r.key = e.key;
        r.behind = true;
      }
    }
  }
  return ranked.sort((a, b) => a.key - b.key || Number(a.behind) - Number(b.behind)).map((r) => r.item);
}

export function findMatches(index: SearchEntry[], query: string, limit: number): { matches: Match[]; more: boolean; total: number } {
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
  return { matches: cached.sorted.slice(0, limit), more: cached.sorted.length > limit, total: cached.sorted.length };
}

/** The `limit` places nearest the camera, with `keep` (rows already on screen) held in place at the top. */
export function findNearest(keep: SearchEntry[], limit: number): { matches: Match[]; more: boolean } {
  const ids = new Set(keep.map((e) => e.id));
  const all = [...keep, ...actions.nearby(limit + 1).filter((e) => !ids.has(e.id))];
  return { matches: all.slice(0, limit), more: all.length > limit };
}

/** Fly to a place, or move the clock to a landmark and fly to its object. */
export function go(m: Match): void {
  if (m.event) nav.visit(m.event);
  // A spacecraft that isn't there at this date: go to when it was.
  else if (m.when !== undefined && actions.distanceTo(m.id) === null) nav.visit(LANDMARKS.find((l) => l.target === m.id) ?? { ms: m.when, name: m.name, kind: 'mission', target: m.id });
  else actions.flyTo(m.id);
}

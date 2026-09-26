// Fuzzy matching shared by the search box and the command palette, so both rank places the same way.
import Fuse from 'fuse.js';
import type { SearchEntry } from './state.svelte.ts';

let cached: { index: SearchEntry[]; fuse: Fuse<SearchEntry> } | null = null;

export function findMatches(index: SearchEntry[], query: string, limit: number): SearchEntry[] {
  if (cached?.index !== index) {
    cached = {
      index,
      fuse: new Fuse(index, { keys: [{ name: 'name', weight: 2 }, 'aliases'], threshold: 0.3, includeScore: true }),
    };
  }
  return cached.fuse
    .search(query, { limit: 20 })
    .sort((a, b) => (a.score ?? 0) + a.item.rank * 0.02 - ((b.score ?? 0) + b.item.rank * 0.02))
    .slice(0, limit)
    .map((r) => r.item);
}

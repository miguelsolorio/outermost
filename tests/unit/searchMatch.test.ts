import { describe, expect, it } from 'vitest';
import { SpacecraftLayer } from '../../src/scene/layers/spacecraft.ts';
import type { World } from '../../src/scene/world.ts';
import { findMatches } from '../../src/ui/searchMatch.ts';
import type { SearchEntry } from '../../src/ui/state.svelte.ts';

const index: SearchEntry[] = [
  { id: 'moon', name: 'Moon', kind: 'Moon', rank: 1 },
  { id: 'mars', name: 'Mars', kind: 'Planet', rank: 0 },
  ...new SpacecraftLayer({} as World).search(),
];
const names = (query: string) => findMatches(index, query, 10).matches.map((m) => m.name);

describe('search ranking', () => {
  it('puts a mission landmark ahead of the craft that were there for it', () => {
    const r = names('apollo 11');
    expect(r[0]).toBe('Apollo 11 lands on the Moon');
    expect(r.slice(1, 3).sort()).toEqual(['Apollo 11 Columbia', 'Apollo 11 Eagle']);
  });

  it('keeps a craft first when its own name is typed', () => {
    expect(names('curiosity').slice(0, 2)).toEqual(['Curiosity', 'Curiosity lands on Mars']);
    expect(names('hubble')[0]).toBe('Hubble Space Telescope');
    expect(names('voyager 1')[0]).toBe('Voyager 1');
  });

  it('only moves a craft behind landmarks from its own dates', () => {
    const r = names('moon');
    expect(r[0]).toBe('Moon');
    // Eagle follows its landing, not Apollo 8, which was before it got there.
    expect(r.indexOf('Apollo 11 Eagle')).toBe(r.indexOf('Apollo 11 lands on the Moon') + 1);
    expect(r.indexOf('Apollo 8 orbits the Moon')).toBeLessThan(r.indexOf('Apollo 11 Eagle'));
  });
});

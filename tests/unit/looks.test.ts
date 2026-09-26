import { describe, expect, it } from 'vitest';
import { BODIES } from '../../src/scene/catalog.ts';
import { LOOKS } from '../../src/scene/looks.ts';

describe('enhanced planet looks', () => {
  const planets = BODIES.filter((b) => b.kind === 'planet').map((b) => b.id);

  it('covers exactly the eight planets', () => {
    expect(planets).toHaveLength(8);
    expect(Object.keys(LOOKS).sort()).toEqual([...planets].sort());
  });

  it('labels every look with an info-card note', () => {
    for (const id of planets) expect(LOOKS[id].note.length).toBeGreaterThan(20);
  });

  it('gives a moving atmosphere a wind profile and speed', () => {
    for (const look of Object.values(LOOKS)) {
      if (look.atmo === 'none') continue;
      expect(look.jets).toBeDefined();
      expect(look.flowSpeed).toBeGreaterThan(0);
    }
  });

  it('keeps the grade gentle enough to stay recognizable', () => {
    for (const look of Object.values(LOOKS)) {
      expect(look.saturation).toBeGreaterThanOrEqual(1);
      expect(look.saturation).toBeLessThanOrEqual(1.6);
      expect(look.vivid).toBeGreaterThanOrEqual(0);
      expect(look.vivid).toBeLessThanOrEqual(1);
    }
  });
});

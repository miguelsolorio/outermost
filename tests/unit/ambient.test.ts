import { describe, expect, it } from 'vitest';
import { layerWeights } from '../../src/audio/ambient.ts';

const AU = 1.496e11;
const LY = 9.461e15;

describe('ambient layer mix', () => {
  it('follows the view from a planet out to the cosmos', () => {
    // Near Earth: the planet drone alone.
    expect(layerWeights(3.2e7, AU)).toMatchObject({ planet: 1, system: 0, stars: 0, cosmos: 0 });
    // Framing the inner solar system: open fifths.
    expect(layerWeights(5 * AU, 5 * AU)).toMatchObject({ planet: 0, system: 1, stars: 0, cosmos: 0 });
    // Among the stars, a few hundred light-years out.
    expect(layerWeights(300 * LY, 300 * LY)).toMatchObject({ planet: 0, system: 0, stars: 1, cosmos: 0 });
    // Past the Local Group.
    expect(layerWeights(1e23, 1e23)).toMatchObject({ planet: 0, system: 0, stars: 0, cosmos: 1 });
  });

  it('crossfades smoothly between neighbours', () => {
    const w = layerWeights(10 ** 8.8, AU);
    expect(w.planet).toBeCloseTo(0.5, 5);
    expect(w.system).toBeCloseTo(0.5, 5);
    for (const s of [1e6, 1e9, 1e12, 1e15, 1e18, 1e21, 1e24]) {
      const sum = Object.values(layerWeights(s, s)).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
    }
  });
});

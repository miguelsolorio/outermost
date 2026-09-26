import { describe, expect, it } from 'vitest';
import { SUN_LIMB } from '../../src/scene/sunLimb.ts';

describe('Neckel & Labs limb-darkening coefficients', () => {
  for (const ch of ['r', 'g', 'b'] as const) {
    it(`${ch}: I(1) = 1 and intensity falls monotonically toward the limb`, () => {
      const a = SUN_LIMB[ch];
      const I = (mu: number) => a.reduce((s, c, k) => s + c * mu ** k, 0);
      expect(I(1)).toBeCloseTo(1, 4);
      for (let mu = 0.05; mu <= 1; mu += 0.05) expect(I(mu)).toBeGreaterThan(I(mu - 0.05));
      // Blue darkens more strongly than red at the limb.
    });
  }
  it('blue limb is darker than red limb', () => {
    const at = (a: number[], mu: number) => a.reduce((s, c, k) => s + c * mu ** k, 0);
    expect(at(SUN_LIMB.b, 0.1)).toBeLessThan(at(SUN_LIMB.r, 0.1));
  });
});

// Fact-check the cosmology against Planck 2018 and astropy's Planck18.
import { describe, expect, it } from 'vitest';
import { ageGyr, comovingDistanceMpc, particleHorizonMpc, Z_STAR } from '../../src/astro/cosmology.ts';
import { GLY, MPC } from '../../src/astro/units.ts';

describe('Planck 2018 cosmology', () => {
  it('age of the universe is 13.787 Gyr (astropy Planck18)', () => {
    expect(Math.abs(ageGyr(0) - 13.787)).toBeLessThan(0.01);
  });
  it('comoving distance to z = 1 is 3395.9 Mpc (astropy Planck18) within 0.2%', () => {
    expect(Math.abs(comovingDistanceMpc(1) / 3395.9 - 1)).toBeLessThan(0.002);
  });
  it('distance to last scattering matches r*/θ* = 144.43 Mpc / 0.0104110 (Planck 2018) within 0.5%', () => {
    const dm = 144.43 / 0.010411;
    expect(Math.abs(comovingDistanceMpc(Z_STAR) / dm - 1)).toBeLessThan(0.005);
  });
  it('the observable universe has a comoving radius of about 46 billion light-years', () => {
    const gly = (particleHorizonMpc() * MPC) / GLY;
    expect(gly).toBeGreaterThan(45.5);
    expect(gly).toBeLessThan(47);
  });
});

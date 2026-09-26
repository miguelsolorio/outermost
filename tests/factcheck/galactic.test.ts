// Fact-check: galactic coordinate frame and the Sun's position in the Galaxy.
import { describe, expect, it } from 'vitest';
import { EQJ_TO_GAL, SGRA_DIR, galaxyFrame, toGalactic, R0, Z_SUN } from '../../src/astro/galactic.ts';
import { fromRaDec, dot, length, scale, sub } from '../../src/astro/vec.ts';
import { DEG, KPC, PC } from '../../src/astro/units.ts';

describe('galactic coordinates (IAU 1958, ICRS realization)', () => {
  it('matches the Hipparcos EQJ→galactic rotation matrix to 1e-6', () => {
    // ESA 1997, The Hipparcos and Tycho Catalogues, Vol. 1, eq. 1.5.11 (A_G transposed).
    const ref = [
      -0.0548755604, -0.8734370902, -0.4838350155, 0.4941094279, -0.44482963, 0.7469822445, -0.867666149, -0.1980763734,
      0.4559837762,
    ];
    EQJ_TO_GAL.forEach((v, i) => expect(Math.abs(v - ref[i]), `element ${i}`).toBeLessThan(1e-6));
  });

  it('Sgr A* is at l ≈ 359.944°, b ≈ −0.046°', () => {
    const { l, b } = toGalactic(SGRA_DIR);
    expect(Math.abs(l - 359.944)).toBeLessThan(0.002);
    expect(Math.abs(b + 0.046)).toBeLessThan(0.002);
  });

  it('Deneb (RA 310.358°, Dec 45.280°) is near l = 84.3°, b = +2.0°', () => {
    const { l, b } = toGalactic(fromRaDec(310.35798 * DEG, 45.28034 * DEG));
    expect(Math.abs(l - 84.28)).toBeLessThan(0.05);
    expect(Math.abs(b - 2.0)).toBeLessThan(0.05);
  });
});

describe("the Sun's place in the Milky Way", () => {
  const f = galaxyFrame();
  const sunInGal = sub([0, 0, 0], f.center);
  it('R0 = 8.178 kpc (GRAVITY 2019)', () => {
    expect(length(f.center) / KPC).toBeCloseTo(8.178, 3);
  });
  it('the Sun is 20.8 pc above the midplane (Bennett & Bovy 2019)', () => {
    expect(dot(sunInGal, f.z) / PC).toBeCloseTo(20.8, 1);
  });
  it('galactocentric axes are orthonormal and +x points at the Sun', () => {
    expect(Math.abs(dot(f.x, f.y))).toBeLessThan(1e-12);
    expect(Math.abs(dot(f.x, f.z))).toBeLessThan(1e-12);
    expect(dot(f.x, scale(sunInGal, 1 / length(sunInGal)))).toBeGreaterThan(0.9999);
    expect(R0 / KPC).toBe(8.178);
    expect(Z_SUN / PC).toBe(20.8);
  });
  it('Galactic rotation (toward l = 90°) is clockwise seen from the north side', () => {
    // At the Sun, rotation points toward l = 90°, i.e. +y in the galactic frame.
    const l90 = [EQJ_TO_GAL[3], EQJ_TO_GAL[4], EQJ_TO_GAL[5]] as [number, number, number];
    // Seen from +z, moving from +x (Sun) toward +y... around the center at origin the
    // Sun at +x moving along +y component is counter-clockwise in a right-handed frame
    // unless y points the other way: galactic +y at the Sun is opposite our frame's +y.
    expect(dot(l90, f.y)).toBeLessThan(-0.99);
  });
});

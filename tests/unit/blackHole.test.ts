import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { einsteinAngle, exactSourceAngle, keplerSeparation, lensResidualRow, lensRow, lensRowRadius, LENS_LUT, RS_PER_MSUN, shadowAngularRadius, sourceAngle } from '../../src/astro/blackHole.ts';
import { galaxyFrame } from '../../src/astro/galactic.ts';
import { AU, DEG, PC } from '../../src/astro/units.ts';
import { dot, length, normalize, sub, type Vec3 } from '../../src/astro/vec.ts';
import { BLACK_HOLES } from '../../src/data/blackHoles.ts';
import { lensDepth, selectLenses } from '../../src/scene/layers/blackHoles.ts';
import { BlackHolesProvider } from '../../src/scene/providers/blackHoles.ts';
import { GalaxyProvider } from '../../src/scene/providers/galaxy.ts';
import type { StarsLayer } from '../../src/scene/layers/stars.ts';
import type { World } from '../../src/scene/world.ts';

describe('black hole geometry', () => {
  it('one solar mass has a 2953 m horizon', () => {
    expect(RS_PER_MSUN).toBeCloseTo(2953.25, 1);
  });

  it('shadow: 45° at 3 r_s, 90° on the photon sphere, 2.598 r_s/D far away', () => {
    expect(shadowAngularRadius(1, 3) / DEG).toBeCloseTo(45, 10);
    expect(shadowAngularRadius(1, 1.5) / DEG).toBeCloseTo(90, 10);
    expect(shadowAngularRadius(1, 1e8) * 1e8).toBeCloseTo((3 * Math.sqrt(3)) / 2, 6);
    // Inside the photon sphere the shadow covers more than half the sky.
    expect(shadowAngularRadius(1, 1.2)).toBeGreaterThan(Math.PI / 2);
  });

  it('point-lens equation: the Einstein ring images the point straight behind', () => {
    const tE = einsteinAngle(1, 50);
    expect(tE).toBeCloseTo(Math.sqrt(2 / 50), 12);
    expect(sourceAngle(tE, tE)).toBeCloseTo(0, 12);
    expect(sourceAngle(0.5 * tE, tE)).toBeLessThan(0);
    expect(sourceAngle(100 * tE, tE) / (100 * tE)).toBeCloseTo(1, 3);
    for (let x = 0.1; x < 5; x += 0.1) expect(sourceAngle((x + 0.1) * tE, tE)).toBeGreaterThan(sourceAngle(x * tE, tE));
  });

  it("Kepler's third law gives 1 AU for a year around one Sun", () => {
    expect(keplerSeparation(1, 365.25) / AU).toBeCloseTo(1, 3);
  });
});

describe('exact Schwarzschild bending', () => {
  it('matches the weak field far from the hole', () => {
    const ro = 1e6;
    const tE = einsteinAngle(1, ro);
    // To the second-order term (15π/16)(r_s/b)², a few parts in 10⁵ here.
    for (const k of [3, 10, 100]) expect(exactSourceAngle(k * tE, ro) / sourceAngle(k * tE, tE)).toBeCloseTo(1, 3);
    // The Einstein ring images the point straight behind the hole.
    expect(Math.abs(exactSourceAngle(tE, ro)) / tE).toBeLessThan(2e-3);
  });

  it('matches the strong-deflection limit at the photon sphere (Bozza 2002)', () => {
    // α = −ln(b/b_c − 1) + ln(216(7 − 4√3)) − π for an observer far away.
    const ro = 1e8;
    const sh = shadowAngularRadius(1, ro);
    for (const x of [1e-3, 1e-4]) {
      const alpha = -Math.log(x) + Math.log(216 * (7 - 4 * Math.sqrt(3))) - Math.PI;
      expect(exactSourceAngle(sh * (1 + x), ro)).toBeCloseTo(-alpha, 2);
    }
  });

  it('captures inward rays inside the shadow and passes outward ones', () => {
    const ro = 40;
    const sh = shadowAngularRadius(1, ro);
    expect(exactSourceAngle(0.99 * sh, ro)).toBeNaN();
    expect(exactSourceAngle(Math.PI - 1e-6, ro)).toBeCloseTo(Math.PI, 4);
  });

  it('tabulates corrections only where the weak field falls short', () => {
    expect(lensRow(40)).toBeGreaterThan(0);
    expect(lensRow(1e5)).toBe(-1);
    const row = lensResidualRow(10);
    expect(row).toHaveLength(LENS_LUT.n);
    expect(row.every(Number.isFinite)).toBe(true);
    // Looking straight away nothing bends (β = π), which the weak field misses by θ_E²/π;
    // at the shadow's edge light winds many times around.
    expect(row[LENS_LUT.n - 1]).toBeCloseTo(einsteinAngle(1, lensRowRadius(10)) ** 2 / Math.PI, 3);
    expect(row[0]).toBeLessThan(-2 * Math.PI);
  });
});

describe('lens depth matches three.js depth buffers', () => {
  const near = 1234;
  const far = 1e30;
  it('reversed-Z', () => {
    const m = new THREE.Matrix4().makePerspective(-1, 1, 1, -1, near, far, THREE.WebGLCoordinateSystem, true);
    for (const z of [2e3, 1e6, 3.7e10, 1e20]) {
      const v = new THREE.Vector4(0, 0, -z, 1).applyMatrix4(m);
      expect(lensDepth(z, near, far, 'reversed') / (v.z / v.w)).toBeCloseTo(1, 6);
    }
  });
  it('logarithmic', () => {
    const fc = 2 / Math.log2(far + 1);
    for (const z of [2e3, 1e6, 3.7e10, 1e20]) expect(lensDepth(z, near, far, 'logarithmic')).toBeCloseTo(Math.log2(1 + z) * fc * 0.5, 12);
  });
  it('behind the camera nothing is in front of the hole', () => {
    expect(lensDepth(-5, near, far, 'reversed')).toBeGreaterThan(1);
    expect(lensDepth(-5, near, far, 'logarithmic')).toBeLessThan(0);
  });
});

describe('lens selection', () => {
  const radPerPx = 1e-3;
  const half = 40 * DEG;
  it('keeps holes that bend the view and orders them by Einstein angle', () => {
    const sel = selectLenses(
      [
        { id: 'far', rs: 1, view: [0, 0, -1e9] }, // θ_E ≈ 4.5e-5 rad: under a pixel
        { id: 'near', rs: 1, view: [0, 0, -40] },
        { id: 'mid', rs: 1, view: [0, 0.1, -400] },
        { id: 'inside', rs: 1, view: [0, 0, -1] },
      ],
      radPerPx,
      half,
    );
    expect(sel.map((l) => l.id)).toEqual(['near', 'mid']);
    expect(sel[0].thetaE).toBeCloseTo(Math.sqrt(2 / 40), 12);
    expect(sel[0].z).toBe(40);
  });
  it('drops holes behind the camera whose pull cannot reach the screen, and caps the count', () => {
    // θ_E² / (0.5 px) ≈ 0.4 rad of reach: not enough to reach from straight behind.
    expect(selectLenses([{ id: 'behind', rs: 1, view: [0, 0, 1e4] }], radPerPx, half)).toEqual([]);
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `h${i}`, rs: 1, view: [0, 0, -(20 + i)] as Vec3 }));
    expect(selectLenses(many, radPerPx, half)).toHaveLength(4);
  });
});

describe('black hole provider', () => {
  const world = { get: () => ({ pos: [0, 0, 0] }), ms: 0 } as unknown as World;
  const galaxy = new GalaxyProvider(world);
  const star: Vec3 = [1000 * PC, 1500 * PC, 2000 * PC];
  const stars = {
    catalog: { meta: [{ i: 7, hip: 98298 }] },
    starPos: () => star,
  } as unknown as StarsLayer;
  const p = new BlackHolesProvider(world, (id) => galaxy.target(id), (id) => galaxy.info(id), stars);

  it('puts Sgr A* exactly at the Galactic Center', () => {
    const t = p.target('bh-sgr-a-star')!;
    expect(t.pos()).toEqual(galaxyFrame().center);
    expect(t.radius).toBeCloseTo(4.152e6 * RS_PER_MSUN, 0);
    expect(t.parent).toBe('milky-way');
  });

  it('places Cygnus X-1 one orbit radius from its companion, in the sky plane', () => {
    const bh = p.target('bh-cyg-x-1')!.pos();
    const off = sub(bh, star);
    expect(length(off) / AU).toBeCloseTo(0.244, 3);
    // Perpendicular to the line of sight, to the float64 spacing at 2.9 kpc (16 km of 0.24 AU).
    expect(Math.abs(dot(normalize(off), normalize(star)))).toBeLessThan(1e-6);
    expect(normalize(off)[2]).toBeGreaterThan(0);
  });

  it('only offers black holes whose hosts have loaded', () => {
    const ids = p.search().map((e) => e.id);
    expect(ids).toContain('bh-sgr-a-star');
    expect(ids).toContain('bh-gaia-bh1');
    expect(ids).not.toContain('bh-m31');
    expect(p.target('bh-m31')).toBeUndefined();
  });

  it('owns the Sgr A* name; the Milky Way no longer does', () => {
    const mw = galaxy.search().find((e) => e.id === 'milky-way')!;
    expect(mw.aliases).not.toContain('Sgr A*');
    expect(p.search().find((e) => e.id === 'bh-sgr-a-star')!.aliases).toContain('Sgr A*');
    expect(galaxy.info('milky-way')!.facts.some((f) => f.label === 'Central black hole')).toBe(true);
  });

  it('fills an info card for every resolved black hole', () => {
    for (const b of BLACK_HOLES) {
      if (!p.target(b.id)) continue;
      const info = p.info(b.id)!;
      expect(info.name, b.id).toBe(b.name);
      const labels = info.facts.map((f) => f.label);
      expect(new Set(labels).size, `${b.id} fact labels are unique`).toBe(labels.length);
    }
  });
});

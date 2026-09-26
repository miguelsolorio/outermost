// Accretion disks: the ray march the lensing shader mirrors, checked against
// the exact lensing table, plus redshift, temperature and orientation.
import { describe, expect, it } from 'vitest';
import {
  diskAxis,
  diskCrossings,
  diskRedshift,
  exactSourceAngle,
  orbitRk4,
  rayPoint,
  rayStart,
  shadowAngularRadius,
  thinDiskTemperature,
  traceToDisk,
} from '../../src/astro/blackHole.ts';
import { DEG, PC } from '../../src/astro/units.ts';
import { angleBetween, cross, dot, fromRaDec, normalize, scale, sub, type Vec3 } from '../../src/astro/vec.ts';
import { BLACK_HOLE_BY_ID } from '../../src/data/blackHoles.ts';
import type { FrameCtx } from '../../src/scene/frame.ts';
import { diskLensIndex, type Lens } from '../../src/scene/layers/blackHoles.ts';
import type { StarsLayer } from '../../src/scene/layers/stars.ts';
import { BlackHolesProvider } from '../../src/scene/providers/blackHoles.ts';
import { GalaxyProvider } from '../../src/scene/providers/galaxy.ts';
import type { World } from '../../src/scene/world.ts';

/** Total azimuth a ray sweeps from the camera out to infinity (NaN if captured). */
function sweep(theta: number, ro: number, h = 2e-3): number {
  let [u, du] = rayStart(theta, ro);
  let phi = 0;
  for (let i = 0; i < 1e6; i++) {
    const [u1, du1] = orbitRk4(u, du, h);
    if (u1 >= 1) return NaN;
    if (u1 <= 0) return phi + (h * u) / (u - u1);
    [u, du, phi] = [u1, du1, phi + h];
  }
  return NaN;
}

const skyNorth = (u: Vec3): Vec3 => normalize(sub([0, 0, 1], scale(u, u[2])));

describe('disk ray march', () => {
  it('sweeps the same angle as the exact lensing table (β = π − Δφ)', () => {
    for (const ro of [40, 1000]) {
      const sh = shadowAngularRadius(1, ro);
      for (const theta of [1.05 * sh, 1.5 * sh, 5 * sh, 0.3, 1.2, 2.5]) {
        expect(Math.PI - sweep(theta, ro), `r_o ${ro}, θ ${theta}`).toBeCloseTo(exactSourceAngle(theta, ro), 3);
      }
    }
  });

  it('captures rays inside the shadow', () => {
    for (const ro of [40, 1000]) expect(sweep(0.9 * shadowAngularRadius(1, ro), ro)).toBeNaN();
  });

  it('finds the disk-plane crossings analytically', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 50; i++) {
      const l = normalize([rnd(), rnd(), rnd()]);
      const t = normalize(cross(l, cross([rnd(), rnd(), rnd()], l)));
      const n = normalize([rnd(), rnd(), rnd()]);
      const phis = diskCrossings(l, t, n);
      expect(phis[0]).toBeGreaterThan(0);
      expect(phis[0]).toBeLessThanOrEqual(Math.PI);
      for (const phi of phis) expect(Math.abs(dot(rayPoint(l, t, 0.1, phi), n))).toBeLessThan(1e-9);
    }
  });

  it('sees the far side of a nearly edge-on disk lifted over the shadow', () => {
    // Camera 40 r_s out, 10° above the disk plane, looking at the hole; a ray just above the shadow.
    const l: Vec3 = [0, 0, -1];
    const n = normalize([0, Math.cos(10 * DEG), Math.sin(10 * DEG)]);
    const theta = 1.3 * shadowAngularRadius(1, 40);
    const hit = traceToDisk(theta, 40, l, [0, 1, 0], n, 3, 40)!;
    expect(hit).not.toBeNull();
    // It crosses the plane behind the hole, not in front, after bending over the top.
    expect(dot(rayPoint(l, [0, 1, 0], 1 / hit.r, hit.phi), l)).toBeGreaterThan(0);
  });
});

describe('disk light', () => {
  it('face-on from afar: g = √½ at the innermost stable orbit', () => {
    expect(diskRedshift(3, 0, 1e12)).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('nearly edge-on: the approaching side is blueshifted, the receding side redshifted', () => {
    const ro = 1000;
    const l: Vec3 = [0, 0, -1];
    const n = normalize([0, Math.cos(10 * DEG), -Math.sin(10 * DEG)]);
    const g = (t: Vec3) => {
      const theta = 8 / ro;
      const hit = traceToDisk(theta, ro, l, t, n, 3, 40)!;
      const b = (ro * Math.sin(theta)) / Math.sqrt(1 - 1 / ro);
      return diskRedshift(hit.r, b * dot(cross(l, t), n), ro);
    };
    // Gas turning about +y (≈ n) moves toward the camera on the −x side.
    expect(g([-1, 0, 0])).toBeGreaterThan(1);
    expect(g([1, 0, 0])).toBeLessThan(1);
  });

  it('temperature is zero at the inner edge and peaks at 49/36 of it', () => {
    expect(thinDiskTemperature(3, 3)).toBe(0);
    expect(thinDiskTemperature((49 / 36) * 3, 3)).toBeCloseTo(1, 12);
    for (const r of [3.5, 4.5, 6, 20]) expect(thinDiskTemperature(r, 3)).toBeLessThan(1);
  });
});

describe('disk orientation', () => {
  const world = { get: () => ({ pos: [0, 0, 0] }), ms: 0 } as unknown as World & { ms: number };
  const galaxy = new GalaxyProvider(world);
  const star: Vec3 = [1000 * PC, 1500 * PC, 2000 * PC];
  const stars = { catalog: { meta: [{ i: 7, hip: 98298 }] }, starPos: () => star } as unknown as StarsLayer;
  const p = new BlackHolesProvider(world, (id) => galaxy.target(id), (id) => galaxy.info(id), stars);

  it('Cygnus X-1: tilted 27.51° from the line of sight, companion in the orbital plane', () => {
    const def = BLACK_HOLE_BY_ID.get('bh-cyg-x-1')!;
    const n = p.diskAxisWorld(def)!;
    const pos = p.target(def.id)!.pos();
    expect(angleBetween(n, normalize(scale(pos, -1))) / DEG).toBeCloseTo(27.51, 6);
    expect(Math.abs(dot(n, normalize(sub(pos, star))))).toBeLessThan(1e-6);
  });

  it('Cygnus X-1 is approached 80° from its disk axis', () => {
    const def = BLACK_HOLE_BY_ID.get('bh-cyg-x-1')!;
    const a = p.target(def.id)!.approach!();
    expect(angleBetween(normalize(a), p.diskAxisWorld(def)!) / DEG).toBeCloseTo(80, 6);
  });

  it('M87*: axis 163° from Earth (clockwise on the sky), approaching jet at PA 288°', () => {
    const def = BLACK_HOLE_BY_ID.get('bh-m87')!.disk!;
    const u = fromRaDec(187.70593076725 * DEG, 12.39112324608 * DEG);
    const e = scale(u, -1);
    const N = skyNorth(u);
    const E = normalize(cross([0, 0, 1], u));
    const n = diskAxis(e, N, def.inclinationDeg, def.axisPaDeg, def.axisAway);
    expect(angleBetween(n, e) / DEG).toBeCloseTo(163, 9);
    const jet = scale(n, -1);
    const pa = (Math.atan2(dot(jet, E), dot(jet, N)) / DEG + 360) % 360;
    expect(pa).toBeCloseTo(288, 9);
  });

  it('V404 Cygni shines only during its outbursts', () => {
    const ctx = { pose: { pivot: [0, 0, 0], offset: [0, 0, 0] } } as unknown as FrameCtx;
    const disk = () => p.lenses(ctx).find((l) => l.id === 'bh-v404-cyg')?.disk;
    world.ms = Date.parse('2015-06-20');
    expect(disk()?.brightness).toBe(1);
    world.ms = Date.parse('2020-01-01');
    expect(disk()).toBeUndefined();
    world.ms = Date.parse('2015-06-15') - 1.5 * 86_400_000; // fading in
    expect(disk()!.brightness).toBeGreaterThan(0);
    expect(disk()!.brightness).toBeLessThan(1);
  });

  it('cards replace the no-disk note for holes with a disk', () => {
    const notes = (id: string) => p.info(id)!.notes.map((n) => n.text).join(' ');
    expect(notes('bh-cyg-x-1')).not.toContain('No accretion disk');
    expect(notes('bh-cyg-x-1')).toContain('NASA');
    expect(notes('bh-gaia-bh1')).toContain('No accretion disk');
    expect(p.info('bh-cyg-x-1')!.facts.some((f) => f.label === 'Inner disk temperature')).toBe(true);
  });
});

describe('disk lens choice', () => {
  const lens = (id: string, disk?: Partial<NonNullable<Lens['disk']>>): Lens => ({
    id,
    dir: [0, 0, -1],
    z: 1,
    thetaE: 0.1,
    shadow: 0.05,
    row: 0,
    disk: disk && { axis: [0, 1, 0], kind: 'thin', rIn: 3, rOut: 40, brightness: 1, ro: 40, ...disk },
  });
  it('draws the first disk wider than 2 px, and none past the table', () => {
    expect(diskLensIndex([lens('a'), lens('b', {}), lens('c', {})], 1e-3)).toBe(1);
    expect(diskLensIndex([lens('a', { ro: 1e5 }), lens('b', { ro: 50 })], 1e-3)).toBe(1);
    expect(diskLensIndex([lens('a', { ro: 9000 })], 1e-2)).toBe(-1);
  });
});

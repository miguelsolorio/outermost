// Fact-check: black hole positions, sizes and orbits against published values.
// Positions: SIMBAD (queried 2026-09). Shadow sizes: Event Horizon Telescope
// Collaboration 2019 (M87*, ApJL 875, L1/L6) and 2022 (Sgr A*, ApJL 930, L12).
// Orbits: the discovery papers cited in src/data/blackHoles.ts.
import { describe, expect, it } from 'vitest';
import { keplerSeparation, schwarzschildRadius, shadowAngularRadius, weakDeflection, RS_PER_MSUN } from '../../src/astro/blackHole.ts';
import { R0, SGRA_DEC, SGRA_RA } from '../../src/astro/galactic.ts';
import { AU, DEG, MPC, R_SUN } from '../../src/astro/units.ts';
import { BLACK_HOLES, BLACK_HOLE_BY_ID } from '../../src/data/blackHoles.ts';

const UAS = DEG / 3600e6;
const ARCSEC = DEG / 3600;
/** Angular separation (arcsec) of two RA/Dec positions in degrees. */
const sep = (a: { ra: number; dec: number }, b: { ra: number; dec: number }) => {
  const d = (x: number) => x * DEG;
  const c = Math.sin(d(a.dec)) * Math.sin(d(b.dec)) + Math.cos(d(a.dec)) * Math.cos(d(b.dec)) * Math.cos(d(a.ra - b.ra));
  return Math.acos(Math.min(1, c)) / ARCSEC;
};

describe('the black hole list', () => {
  it('has unique deep-linkable ids and cites every number', () => {
    const ids = BLACK_HOLES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of BLACK_HOLES) {
      expect(b.id).toMatch(/^bh-[a-z0-9-]+$/);
      expect(b.mass.source.url, `${b.id} mass`).toMatch(/^https:\/\//);
      for (const f of b.facts) expect(f.source.url, `${b.id}: ${f.label}`).toMatch(/^https:\/\//);
      if (b.binary) expect(b.binary.source.url).toMatch(/^https:\/\//);
      if (b.distance) expect(b.distance.source.url).toMatch(/^https:\/\//);
    }
  });

  it('places stellar black holes at their SIMBAD positions', () => {
    // SIMBAD ICRS coordinates (deg) of the systems.
    const simbad: Record<string, [number, number]> = {
      'bh-gaia-bh1': [262.1712358858566, -0.5809787160997], // GALEX J172841.0-003451
      'bh-gaia-bh2': [207.5697823340767, -59.2389807502900], // UCAC4 154-126202
      'bh-gaia-bh3': [294.8279647810400, 14.9316697199200], // LS II +14 13
      'bh-v404-cyg': [306.0159362655975, 33.8672114319058],
      'bh-a0620-00': [95.6855932738800, -0.3456362390400],
      'bh-cyg-x-1': [299.5903155649800, 35.2016068090800], // HD 226868
    };
    for (const [id, [ra, dec]] of Object.entries(simbad)) {
      const b = BLACK_HOLE_BY_ID.get(id)!;
      expect(sep(b.published, { ra, dec }), id).toBeLessThan(1);
      if (b.placement.type === 'sky') expect(sep(b.placement, { ra, dec }), id).toBeLessThan(1);
    }
  });

  it('Sgr A* in SIMBAD agrees with the Galactic Center used by the Milky Way model (Reid & Brunthaler 2004)', () => {
    expect(sep(BLACK_HOLE_BY_ID.get('bh-sgr-a-star')!.published, { ra: SGRA_RA, dec: SGRA_DEC })).toBeLessThan(0.2);
  });
});

describe('shadows against Event Horizon Telescope images', () => {
  it('Sgr A*: 4.152 million Suns at 8.178 kpc gives a ≈ 52 μas shadow (EHT ring 51.8 ± 2.3 μas)', () => {
    const rs = schwarzschildRadius(BLACK_HOLE_BY_ID.get('bh-sgr-a-star')!.mass.msun);
    expect(rs / 1e10).toBeCloseTo(1.226, 3);
    const d = (2 * shadowAngularRadius(rs, R0)) / UAS;
    expect(Math.abs(d - 51.8)).toBeLessThan(2.3);
    // EHT's own shadow estimate: 48.7 ± 7.0 μas.
    expect(Math.abs(d - 48.7)).toBeLessThan(7);
  });

  it('M87*: 6.5 billion Suns at 16.8 Mpc gives a ≈ 40 μas shadow (ring 42 ± 3 μas) and θ_g ≈ 3.8 μas', () => {
    const b = BLACK_HOLE_BY_ID.get('bh-m87')!;
    const rs = schwarzschildRadius(b.mass.msun);
    const D = b.mass.atDistMpc! * MPC;
    expect(rs / 1e13).toBeCloseTo(1.92, 2);
    expect(Math.abs((2 * shadowAngularRadius(rs, D)) / UAS - 42)).toBeLessThan(3);
    expect(Math.abs(rs / 2 / D / UAS - 3.8)).toBeLessThan(0.4);
  });

  it('bends starlight at the Sun’s limb by 1.75″ (Dyson, Eddington & Davidson 1920)', () => {
    expect(weakDeflection(RS_PER_MSUN, R_SUN) / ARCSEC).toBeCloseTo(1.751, 3);
  });
});

describe('binary orbits', () => {
  // Published semi-major axes (AU): El-Badry et al. 2023a/b; Gaia BH3 from the
  // giant's barycentric orbit a₁ = 16.17 AU scaled by M_total / M_BH.
  const published: Array<[string, number]> = [
    ['bh-gaia-bh1', 1.4],
    ['bh-gaia-bh2', 4.96],
    ['bh-gaia-bh3', 16.17 * ((32.7 + 0.76) / 32.7)],
  ];
  it.each(published)('%s orbit from Kepler matches the paper (%f AU)', (id, a) => {
    const b = BLACK_HOLE_BY_ID.get(id)!;
    const k = keplerSeparation(b.mass.msun + b.binary!.companionMsun!, b.binary!.periodDays) / AU;
    expect(Math.abs(k / a - 1)).toBeLessThan(0.02);
  });

  it('Cygnus X-1 orbits 0.244 AU from a 22.3 R☉ supergiant, well outside it (Miller-Jones et al. 2021)', () => {
    const b = BLACK_HOLE_BY_ID.get('bh-cyg-x-1')!;
    const a = keplerSeparation(b.mass.msun + b.binary!.companionMsun!, b.binary!.periodDays);
    expect(a / AU).toBeCloseTo(0.244, 3);
    expect(a / (b.binary!.companionRsun! * R_SUN)).toBeGreaterThan(2);
  });
});

describe('accretion disks', () => {
  const disk = (id: string) => BLACK_HOLE_BY_ID.get(id)!.disk!;
  it('inclinations and orientations match the papers', () => {
    expect(disk('bh-cyg-x-1').inclinationDeg).toBe(27.51); // Miller-Jones et al. 2021, Table 1: 27.51 (+0.77 / −0.57)°
    expect(disk('bh-v404-cyg').inclinationDeg).toBe(67); // Khargharia et al. 2010, §5: (67 +3 −1)°
    expect(disk('bh-a0620-00').inclinationDeg).toBe(50.98); // Cantrell et al. 2010, §4: 50.98 ± 0.87°
    expect(disk('bh-m87').inclinationDeg).toBe(17); // Walker et al. 2018, §1: jet viewing angle ≈ 17°
    expect(disk('bh-m87').axisPaDeg).toBe(288); // EHT 2019 Paper V, §2: jet PA ≈ 288°
    expect(disk('bh-m87').axisAway).toBe(true); // EHT 2019 Paper V: clockwise, spin pointing away from Earth
    expect(disk('bh-sgr-a-star').inclinationDeg).toBeLessThanOrEqual(30); // EHT 2022 Paper V: favored models i ≤ 30°
  });

  it('outbursts match the record', () => {
    // V404 Cyg: Ginga, late May 1989, very faint by 1 November (Corbel et al. 2008);
    // Swift/BAT, 15 June 2015, quiescent by early August (Plotkin et al. 2017).
    const dates = (id: string) => disk(id).active!.map(({ from, to }) => [from, to]);
    expect(dates('bh-v404-cyg')).toEqual([
      ['1989-05-22', '1989-11-01'],
      ['2015-06-15', '2015-08-05'],
    ]);
    // A0620-00: Ariel V, 3 August 1975 (Elvis et al. 1975); final decline mid-March 1976 (Kaluzienski et al. 1977).
    expect(dates('bh-a0620-00')).toEqual([['1975-08-03', '1976-03-15']]);
    for (const id of ['bh-gaia-bh1', 'bh-gaia-bh2', 'bh-gaia-bh3']) expect(BLACK_HOLE_BY_ID.get(id)!.disk, `${id} is dormant`).toBeUndefined();
  });

  it('cites every disk number', () => {
    for (const b of BLACK_HOLES) {
      if (!b.disk) continue;
      expect(b.disk.inclinationSource.url).toMatch(/^https:\/\//);
      for (const f of b.disk.facts) expect(f.source.url, `${b.id}: ${f.label}`).toMatch(/^https:\/\//);
    }
  });
});

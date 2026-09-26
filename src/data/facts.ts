// Info-card facts. Each fact carries its provenance kind and source so the
// card can show exactly where a number comes from.

import nssdca from '../../data/baked/nssdca.json';

export type FactKind = 'measured' | 'derived' | 'model' | 'artistic';

export interface Fact {
  label: string;
  value: string;
  kind: FactKind;
  sourceId: string;
  sourceUrl: string;
}

type Sheet = { url: string; si: Record<string, number | string> };
const sheets = nssdca.bodies as Record<string, Sheet>;

const fmt = (x: number, digits = 3) =>
  new Intl.NumberFormat('en-US', { maximumSignificantDigits: digits }).format(x);

function sci(x: number, unit: string): string {
  const e = Math.floor(Math.log10(Math.abs(x)));
  const m = x / 10 ** e;
  const sup = String(e).replace(/[-0-9]/g, (c) => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)]);
  return `${m.toFixed(3)} × 10${sup} ${unit}`;
}

function period(hours: number): string {
  const h = Math.abs(hours);
  const dir = hours < 0 ? ' (retrograde)' : '';
  if (h < 48) return `${fmt(h, 5)} hours${dir}`;
  return `${fmt(h / 24, 4)} days${dir}`;
}

function orbitPeriod(days: number): string {
  return days > 700 ? `${fmt(days / 365.25, 4)} years` : `${fmt(days, 4)} days`;
}

export function factsFor(key: string | undefined): Fact[] {
  if (!key || !sheets[key]) return [];
  const { url, si } = sheets[key];
  const out: Fact[] = [];
  const add = (label: string, value: string | null) => {
    if (value) out.push({ label, value, kind: 'measured', sourceId: 'nssdca', sourceUrl: url });
  };
  const n = (k: string) => (typeof si[k] === 'number' ? (si[k] as number) : undefined);

  const rMean = n('radius_mean_m');
  const rEq = n('radius_equatorial_m');
  add('Mean radius', rMean ? `${fmt(rMean / 1000, 6)} km` : null);
  if (rEq && rMean && Math.abs(rEq - rMean) / rMean > 1e-3) add('Equatorial radius', `${fmt(rEq / 1000, 6)} km`);
  add('Mass', n('mass_kg') ? sci(n('mass_kg')!, 'kg') : null);
  add('Surface gravity', n('surface_gravity_m_s2') ? `${fmt(n('surface_gravity_m_s2')!, 3)} m/s²` : null);
  add('Rotation period (sidereal)', n('sidereal_rotation_period_hours') ? period(n('sidereal_rotation_period_hours')!) : null);
  add('Length of day', n('length_of_day_hours') ? period(n('length_of_day_hours')!) : null);
  add('Axial tilt', n('obliquity_deg') !== undefined ? `${fmt(n('obliquity_deg')!, 4)}°` : null);
  add('Orbital period', n('sidereal_orbit_period_days') ? orbitPeriod(n('sidereal_orbit_period_days')!) : null);
  add('Orbital eccentricity', n('orbit_eccentricity') !== undefined ? fmt(n('orbit_eccentricity')!, 3) : null);
  add('Known moons', n('natural_satellites') !== undefined ? String(n('natural_satellites')) : null);
  add('Luminosity', n('luminosity_w') ? sci(n('luminosity_w')!, 'W') : null);
  add('Spectral type', typeof si.spectral_type === 'string' ? si.spectral_type : null);
  add('Geometric albedo', n('geometric_albedo') !== undefined ? fmt(n('geometric_albedo')!, 3) : null);
  return out;
}

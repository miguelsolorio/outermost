// Eclipses as a joint check of the Sun, Moon and Earth-rotation models:
// where the Moon's shadow axis meets Earth, and how deep the Moon sits in
// Earth's umbra, compared with NASA's eclipse predictions (Espenak).
import { describe, expect, it } from 'vitest';
import { World } from '../../src/scene/world.ts';
import type { Vec3 } from '../../src/astro/vec.ts';

const DEG = 180 / Math.PI;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

describe('eclipses vs NASA predictions', () => {
  it('total solar eclipse 2026-08-12: greatest eclipse at 65°13′N 25°14′W (within 1°)', () => {
    const w = new World();
    // Greatest eclipse 17:46:06 TD; ΔT ≈ 69 s.
    w.update(Date.UTC(2026, 7, 12, 17, 44, 57));
    const earth = w.get('earth');
    const moon = w.get('moon').pos;
    const sun = w.get('sun').pos;
    // Shadow axis: the ray from the Sun's center through the Moon's, meeting a
    // sphere of Earth's mean radius.
    const d = norm(sub(moon, sun));
    const oc = sub(moon, earth.pos);
    const R = 6_371_000;
    const b = dot(oc, d);
    const disc = b * b - (dot(oc, oc) - R * R);
    expect(disc, 'shadow axis misses Earth').toBeGreaterThan(0);
    const t = -b - Math.sqrt(disc);
    const hit: Vec3 = [oc[0] + d[0] * t, oc[1] + d[1] * t, oc[2] + d[2] * t];
    // To Earth-fixed coordinates (transpose of body -> EQJ).
    const m = earth.orient;
    const x = m[0] * hit[0] + m[3] * hit[1] + m[6] * hit[2];
    const y = m[1] * hit[0] + m[4] * hit[1] + m[7] * hit[2];
    const z = m[2] * hit[0] + m[5] * hit[1] + m[8] * hit[2];
    const latC = Math.asin(z / R);
    // Geocentric -> geodetic latitude (WGS84 flattening).
    const f = 1 / 298.257223563;
    const lat = Math.atan(Math.tan(latC) / (1 - f) ** 2) * DEG;
    const lon = Math.atan2(y, x) * DEG;
    expect(Math.abs(lat - (65 + 13 / 60)), `lat ${lat.toFixed(2)}`).toBeLessThan(1);
    expect(Math.abs(lon - -(25 + 14 / 60)) * Math.cos(lat / DEG), `lon ${lon.toFixed(2)}`).toBeLessThan(1);
  });

  it('total lunar eclipse 2026-03-03: the Moon is deep in the umbra at greatest eclipse', () => {
    const w = new World();
    // Greatest eclipse 11:34:52 TD (umbral magnitude 1.15).
    w.update(Date.UTC(2026, 2, 3, 11, 33, 43));
    const earth = w.get('earth').pos;
    const toMoon = norm(sub(w.get('moon').pos, earth));
    const antiSun = norm(sub(earth, w.get('sun').pos));
    const sepDeg = Math.acos(Math.min(1, dot(toMoon, antiSun))) * DEG;
    // Umbra radius at the Moon's distance ≈ 0.70°; Moon radius ≈ 0.26°. A
    // magnitude-1.15 eclipse puts the Moon's center ~0.3° from the axis.
    expect(sepDeg).toBeLessThan(0.45);
  });

  it('no eclipse a week later (sanity)', () => {
    const w = new World();
    w.update(Date.UTC(2026, 2, 10, 11, 33, 43));
    const earth = w.get('earth').pos;
    const sepDeg = Math.acos(dot(norm(sub(w.get('moon').pos, earth)), norm(sub(earth, w.get('sun').pos)))) * DEG;
    expect(sepDeg).toBeGreaterThan(20);
  });
});

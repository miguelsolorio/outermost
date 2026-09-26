// Eclipses as a joint check of the Sun, Moon and Earth-rotation models:
// where the Moon's shadow axis meets Earth, and how deep the Moon sits in
// Earth's umbra, compared with NASA's eclipse predictions (Espenak).
import * as A from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { World } from '../../src/scene/world.ts';
import { meanRadius, BODIES } from '../../src/scene/catalog.ts';
import { diskOverlap, penumbraReaches, sunVisibleFrom } from '../../src/scene/eclipse.ts';
import { R_SUN } from '../../src/astro/units.ts';
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

describe('eclipse shading', () => {
  const radius = (id: string) => meanRadius(BODIES.find((b) => b.id === id)!);
  const reaches = (ms: number, occluder: string, body: string) => {
    const w = new World();
    w.update(ms);
    return penumbraReaches(w.get('sun').pos, R_SUN, w.get(occluder).pos, radius(occluder), w.get(body).pos, radius(body) + 100_000);
  };

  it("the Moon's penumbra reaches Earth only during a solar eclipse", () => {
    expect(reaches(Date.UTC(2024, 3, 8, 18, 17), 'moon', 'earth')).toBe(true);
    expect(reaches(Date.UTC(2024, 3, 22, 18, 17), 'moon', 'earth')).toBe(false);
    // New moon with no eclipse: the shadow passes south of Earth.
    expect(reaches(Date.UTC(2024, 4, 8, 3, 22), 'moon', 'earth')).toBe(false);
  });

  it("Earth's penumbra reaches the Moon only during a lunar eclipse", () => {
    expect(reaches(Date.UTC(2026, 2, 3, 11, 33, 43), 'earth', 'moon')).toBe(true);
    expect(reaches(Date.UTC(2026, 2, 10, 11, 33, 43), 'earth', 'moon')).toBe(false);
  });

  it('New York, 2024-04-08: obscuration matches astronomy-engine, and the limb-darkened Sun is dimmer still', () => {
    const lat = 40.7128;
    const lon = -74.006;
    const e = A.SearchLocalSolarEclipse(new Date(Date.UTC(2024, 2, 20)), new A.Observer(lat, lon, 0));
    expect(e.peak.time.date.toISOString().slice(0, 10)).toBe('2024-04-08');
    const w = new World();
    w.update(e.peak.time.date.getTime());
    const earth = w.get('earth');
    // WGS84 site -> Earth-fixed -> EQJ (body -> EQJ is m·v).
    const a = 6_378_137;
    const e2 = 0.00669437999014;
    const phi = lat / DEG;
    const lam = lon / DEG;
    const n = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    const b: Vec3 = [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)];
    const m = earth.orient;
    const p: Vec3 = [
      earth.pos[0] + m[0] * b[0] + m[1] * b[1] + m[2] * b[2],
      earth.pos[1] + m[3] * b[0] + m[4] * b[1] + m[5] * b[2],
      earth.pos[2] + m[6] * b[0] + m[7] * b[1] + m[8] * b[2],
    ];
    const sun = w.get('sun').pos;
    const moon = w.get('moon').pos;
    // Uniform-disk obscuration from the same geometry the shader uses.
    const S = sub(sun, p);
    const O = sub(moon, p);
    const aS = Math.asin(R_SUN / Math.hypot(...S));
    const aO = Math.asin(radius('moon') / Math.hypot(...O));
    const sep = Math.acos(dot(norm(S), norm(O)));
    const obscuration = diskOverlap(1, aO / aS, sep / aS) / Math.PI;
    expect(Math.abs(obscuration - e.obscuration), `ours ${obscuration.toFixed(3)} vs ${e.obscuration.toFixed(3)}`).toBeLessThan(0.03);
    // Most of the bright center is covered, so less light is left than the uncovered area suggests.
    const [, g] = sunVisibleFrom(p, sun, R_SUN, moon, radius('moon'));
    expect(g).toBeLessThan(1 - e.obscuration);
    expect(g).toBeGreaterThan(0);
  });
});

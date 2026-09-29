// Two-body orbits about a planet or moon, for spacecraft with no flown
// trajectory on file (Sputnik, Apollo in lunar orbit, Hubble at launch). An
// orbit is its shape (a, e), its orientation as two EQJ unit vectors (toward
// periapsis, and 90° ahead of it in the direction of motion) and the time of a
// periapsis passage. Around Earth, the J2 oblateness term turns the node and
// the periapsis steadily, a few degrees a day in low orbit.

import { cross, dot, length, normalize, rotateAxisAngle, scale, sub, type Vec3 } from './vec.ts';

export interface Oblateness {
  j2: number;
  /** Equatorial radius (m). */
  radius: number;
  /** Unit north pole (EQJ). */
  pole: Vec3;
}

export interface Orbit {
  /** Gravitational parameter of the central body (m³/s²). */
  mu: number;
  /** Semi-major axis (m). */
  a: number;
  e: number;
  /** Unit vector toward periapsis (EQJ). */
  p: Vec3;
  /** Unit vector 90° past periapsis, in the direction of motion (EQJ). */
  q: Vec3;
  /** A periapsis passage (UTC ms). */
  tpMs: number;
  j2?: Oblateness;
  /** Correction to the mean motion (rad/s), e.g. fitted to a later observed position. */
  dn?: number;
}

/** Earth's J2 (EGM2008) and equatorial radius. */
export const EARTH_J2 = 1.08263e-3;
export const EARTH_RADIUS_EQ = 6_378_137;

export const period = (o: Orbit): number => 2 * Math.PI * Math.sqrt(o.a ** 3 / o.mu);

/** Orbit from its shape, plane (unit angular-momentum vector) and periapsis direction. */
export function orbitFromApsides(mu: number, periR: number, apoR: number, normal: Vec3, periDir: Vec3, tpMs: number, j2?: Oblateness): Orbit {
  const h = normalize(normal);
  // Project the periapsis direction into the plane.
  const p = normalize(sub(periDir, scale(h, dot(periDir, h))));
  return { mu, a: (periR + apoR) / 2, e: (apoR - periR) / (apoR + periR), p, q: cross(h, p), tpMs, j2 };
}

/** Osculating orbit from a state vector (m, m/s) at `ms`. */
export function orbitFromState(mu: number, r: Vec3, v: Vec3, ms: number, j2?: Oblateness): Orbit {
  const rl = length(r);
  const h = cross(r, v);
  const ev = sub(scale(cross(v, h), 1 / mu), scale(r, 1 / rl));
  const e = length(ev);
  const a = 1 / (2 / rl - dot(v, v) / mu);
  const hn = normalize(h);
  const p = e > 1e-9 ? scale(ev, 1 / e) : normalize(r);
  const q = cross(hn, p);
  // Time since periapsis from the true anomaly.
  const nu = Math.atan2(dot(r, q), dot(r, p));
  const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
  const M = E - e * Math.sin(E);
  const n = Math.sqrt(mu / a ** 3);
  return { mu, a, e, p, q, tpMs: ms - (M / n) * 1000, j2 };
}

/** Secular J2 rates (rad/s) of the node, the argument of periapsis and the mean anomaly. */
function j2Rates(o: Orbit): { node: number; peri: number; mean: number; pole: Vec3 } | null {
  if (!o.j2) return null;
  const n = Math.sqrt(o.mu / o.a ** 3);
  const semiLatus = o.a * (1 - o.e * o.e);
  const k = 1.5 * n * o.j2.j2 * (o.j2.radius / semiLatus) ** 2;
  const cosI = dot(cross(o.p, o.q), o.j2.pole);
  const sin2 = 1 - cosI * cosI;
  return { node: -k * cosI, peri: k * (2 - 2.5 * sin2), mean: k * Math.sqrt(1 - o.e * o.e) * (1 - 1.5 * sin2), pole: o.j2.pole };
}

/** Periapsis and in-plane directions at `ms`, turned by J2 since the reference passage. */
function axesAt(o: Orbit, ms: number): { p: Vec3; q: Vec3 } {
  const r = j2Rates(o);
  if (!r) return { p: o.p, q: o.q };
  const dt = (ms - o.tpMs) / 1000;
  const h = cross(o.p, o.q);
  let p = rotateAxisAngle(o.p, h, r.peri * dt);
  let q = rotateAxisAngle(o.q, h, r.peri * dt);
  p = rotateAxisAngle(p, r.pole, r.node * dt);
  q = rotateAxisAngle(q, r.pole, r.node * dt);
  return { p, q };
}

/** Position (m) relative to the central body at `ms`. */
export function orbitPosition(o: Orbit, ms: number): Vec3 {
  const n = Math.sqrt(o.mu / o.a ** 3) + (j2Rates(o)?.mean ?? 0) + (o.dn ?? 0);
  const M = (((n * (ms - o.tpMs)) / 1000) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  let E = M;
  for (let k = 0; k < 30; k++) {
    const d = (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  const x = o.a * (Math.cos(E) - o.e);
  const y = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  const { p, q } = axesAt(o, ms);
  return [p[0] * x + q[0] * y, p[1] * x + q[1] * y, p[2] * x + q[2] * y];
}

/** Unit direction of a planetocentric latitude/longitude (degrees) in a body frame. */
export function latLonDir(latDeg: number, lonDeg: number): Vec3 {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

/**
 * Unit normal (body frame) of the orbit with inclination `incDeg` to the
 * body's equator whose ground track passes over the given point northbound
 * (inclinations over 90° are retrograde and pass it heading west).
 */
export function normalThrough(latDeg: number, lonDeg: number, incDeg: number): Vec3 {
  const i = (incDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const u = Math.asin(Math.max(-1, Math.min(1, Math.sin(lat) / Math.sin(i))));
  const node = (lonDeg * Math.PI) / 180 - Math.atan2(Math.sin(u) * Math.cos(i), Math.cos(u));
  return [Math.sin(i) * Math.sin(node), -Math.sin(i) * Math.cos(node), Math.cos(i)];
}

/**
 * The orbit with its mean motion corrected so it reaches `r` (m) at `ms`: an
 * osculating orbit's semi-major axis is off by the oblateness wobble, which
 * adds up to hundreds of km along track in a day.
 */
export function fitAlongTrack(o: Orbit, r: Vec3, ms: number): Orbit {
  return { ...o, dn: (o.dn ?? 0) + angleAlong(o, r, ms) / ((ms - o.tpMs) / 1000) };
}

/** The same orbit, moved along itself so that at `ms` it is over direction `r`. */
export function phaseTo(o: Orbit, r: Vec3, ms: number): Orbit {
  const n = Math.sqrt(o.mu / o.a ** 3) + (o.dn ?? 0);
  return { ...o, tpMs: o.tpMs - (angleAlong(o, r, ms) / n) * 1000 };
}

/** Angle (rad) along the orbit from where it is at `ms` to where it passes `r`. */
function angleAlong(o: Orbit, r: Vec3, ms: number): number {
  const m = orbitPosition(o, ms);
  const h = normalize(cross(o.p, o.q));
  return Math.atan2(dot(cross(m, r), h), dot(m, r));
}

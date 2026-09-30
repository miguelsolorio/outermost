// Cockpit instrument math: the attitude ball, the radar scope, the point on a
// body under the ship, and the throttle lever's travel. Pure functions, no
// DOM, so they can be tested.

import { clamp, cross, dot, length, normalize, scale, sub, type Vec3 } from '../astro/vec.ts';

const DEG = Math.PI / 180;

/**
 * The ship's attitude against a local "level" up (a body's pole up close,
 * ecliptic or galactic north farther out): pitch of the nose above the level
 * plane and bank (right wing down +), in radians.
 */
export function attitude(fwd: Vec3, up: Vec3, level: Vec3): { pitch: number; bank: number } {
  const pitch = Math.asin(clamp(dot(fwd, level), -1, 1));
  // Level up as seen along the heading; straight up or down, bank is undefined: call it level.
  const t = sub(level, scale(fwd, dot(level, fwd)));
  if (length(t) < 1e-9) return { pitch, bank: 0 };
  return { pitch, bank: Math.atan2(dot(cross(fwd, t), up), dot(up, t)) };
}

/** Radar range, in pace units (distance to the nearest surface): 0.1 P at the center, 10⁴ P at the rim. */
export const RADAR_NEAR = 0.1;
export const RADAR_FAR = 1e4;

export interface RadarBlip {
  /** On a unit disc, seen from above the ship: ahead is up (−y), right is right (+x). */
  x: number;
  y: number;
  /** Elevation above the ship's wings (rad): the scope marks contacts above or below. */
  el: number;
  /** Past the rim, pinned to it. */
  clipped: boolean;
}

/** Where a contact at `d` (target minus ship, m) sits on the scope, for a ship heading `fwd` with `up`, at pace `pace`. */
export function radarBlip(d: Vec3, fwd: Vec3, up: Vec3, pace: number): RadarBlip {
  const right = normalize(cross(fwd, up));
  const x = dot(d, right);
  const z = dot(d, fwd);
  const y = dot(d, up);
  const dist = length(d);
  const bearing = Math.atan2(x, z);
  const lo = Math.log(RADAR_NEAR);
  const hi = Math.log(RADAR_FAR);
  const k = (Math.log(Math.max(dist, 1e-9) / pace) - lo) / (hi - lo);
  const r = clamp(k, 0, 1);
  return { x: Math.sin(bearing) * r, y: -Math.cos(bearing) * r, el: dist > 0 ? Math.asin(clamp(y / dist, -1, 1)) : 0, clipped: k > 1 };
}

/**
 * Latitude and longitude (degrees) of the point under the ship on a body:
 * `q` is ship minus body center, `pole` the body's north, and `sun` the
 * direction to the Sun from it. Longitude counts east from the subsolar
 * meridian, so 0 is noon and ±180 midnight.
 */
export function subPoint(q: Vec3, pole: Vec3, sun: Vec3): { lat: number; lon: number } {
  const n = length(q);
  if (n === 0) return { lat: 0, lon: 0 };
  const u = scale(q, 1 / n);
  const z = dot(u, pole);
  const lat = Math.atan2(z, length(sub(u, scale(pole, z)))) / DEG;
  const noon = sub(sun, scale(pole, dot(sun, pole)));
  if (length(noon) < 1e-9) return { lat, lon: 0 };
  const e = normalize(noon);
  const east = cross(pole, e);
  return { lat, lon: Math.atan2(dot(u, east), dot(u, e)) / DEG };
}

/**
 * The throttle lever's travel (0 at full reverse, 1 at full boost) against the
 * forward drift it holds (pace units per second). Straight through reverse,
 * stop and fine; spread out logarithmically above, so the cruise range gets
 * room and boost is a long pull.
 */
export const LEVER_DETENTS = [
  { name: 'Rev', pos: 0, drift: -1 },
  { name: 'Stop', pos: 0.2, drift: 0 },
  { name: 'Fine', pos: 0.42, drift: 0.2 },
  { name: 'Cruise', pos: 0.68, drift: 1 },
  { name: 'Boost', pos: 1, drift: 4 },
] as const;

/** A lever within this much travel of a detent drops into it. */
export const LEVER_SNAP = 0.03;

export function leverDrift(pos: number): number {
  const p = clamp(pos, 0, 1);
  const d = LEVER_DETENTS;
  for (let i = 0; i + 1 < d.length; i++) {
    const a = d[i];
    const b = d[i + 1];
    if (p > b.pos) continue;
    const t = (p - a.pos) / (b.pos - a.pos);
    // Log-linear between positive detents, linear through zero.
    return a.drift > 0 ? Math.exp(Math.log(a.drift) + t * (Math.log(b.drift) - Math.log(a.drift))) : a.drift + t * (b.drift - a.drift);
  }
  return d[d.length - 1].drift;
}

export function leverPos(drift: number): number {
  const d = LEVER_DETENTS;
  const u = clamp(drift, d[0].drift, d[d.length - 1].drift);
  for (let i = 0; i + 1 < d.length; i++) {
    const a = d[i];
    const b = d[i + 1];
    if (u > b.drift) continue;
    const t = a.drift > 0 ? (Math.log(u) - Math.log(a.drift)) / (Math.log(b.drift) - Math.log(a.drift)) : (u - a.drift) / (b.drift - a.drift);
    return a.pos + t * (b.pos - a.pos);
  }
  return 1;
}

/** The detent a lever position snaps into, if it's close enough to one. */
export function leverDetent(pos: number): (typeof LEVER_DETENTS)[number] | null {
  for (const d of LEVER_DETENTS) if (Math.abs(pos - d.pos) <= LEVER_SNAP) return d;
  return null;
}

// Black hole geometry for a non-spinning (Schwarzschild) hole.
//
// Horizon r_s = 2GM/c². The shadow seen by a static observer at radius r has
// angular radius sin θ = (3√3/2)(r_s/r)·√(1 − r_s/r) (Synge 1966, MNRAS 131,
// 463), which tends to 2.598 r_s/r far away. Light passing at impact parameter
// b ≫ r_s bends by α = 2r_s/b (Einstein 1915), so a source far behind the hole
// seen at angle θ from it really sits at β = θ − θ_E²/θ, with the Einstein
// angle θ_E = √(2r_s/D) for an observer at distance D (the point-lens
// equation, e.g. Schneider, Ehlers & Falco 1992).

import { C, GM_SUN } from './units.ts';
import { add, cross, dot, normalize, scale, type Vec3 } from './vec.ts';

/** Schwarzschild radius of one solar mass (m): 2953.25 m. */
export const RS_PER_MSUN = (2 * GM_SUN) / (C * C);

export const schwarzschildRadius = (msun: number): number => msun * RS_PER_MSUN;

/** Angular radius (rad) of the shadow of a hole of horizon rs seen from radius r. */
export function shadowAngularRadius(rs: number, r: number): number {
  if (r <= rs) return Math.PI;
  const x = rs / r;
  const s = Math.min(1, ((3 * Math.sqrt(3)) / 2) * x * Math.sqrt(1 - x));
  // Inside the photon sphere (r < 1.5 rs) the shadow covers more than half the sky.
  return r >= 1.5 * rs ? Math.asin(s) : Math.PI - Math.asin(s);
}

/** Einstein angle (rad) for a source at infinity, observer at distance D. */
export const einsteinAngle = (rs: number, D: number): number => Math.sqrt((2 * rs) / D);

/**
 * Where a ray seen at angle θ from the hole really comes from (rad). Negative
 * means the far side of the hole (the second image).
 */
export const sourceAngle = (theta: number, thetaE: number): number => theta - (thetaE * thetaE) / theta;

/** Weak-field deflection (rad) of light passing at impact parameter b. */
export const weakDeflection = (rs: number, b: number): number => (2 * rs) / b;

/** Semi-major axis (m) of a binary of total mass (M☉) and period (days), Kepler's third law. */
export function keplerSeparation(totalMsun: number, periodDays: number): number {
  const P = periodDays * 86_400;
  return Math.cbrt((GM_SUN * totalMsun * P * P) / (4 * Math.PI * Math.PI));
}

// ---- exact bending --------------------------------------------------------
// A static observer at radius r_o (units of r_s) sees a ray at angle θ from the
// hole; its impact parameter is b = r_o·sin θ / √(1 − 1/r_o). With u = 1/r the
// orbit obeys (du/dφ)² = G(u) = u³ − u² + 1/b². Rays with b below the critical
// 3√3/2 that head inward are captured (the shadow). Others sweep through
// Δφ = ∫du/√G on the way out to infinity, so the source sits at β = π − Δφ
// from the hole's direction, which wraps past −π near the shadow: the whole
// sky is imaged again and again in rings that outline it.

/** Critical impact parameter in units of r_s: the photon sphere's. */
export const B_CRIT = (3 * Math.sqrt(3)) / 2;

/** Inverse periapsis radius: the root of G in (0, 2/3), for b > B_CRIT. */
function periapsisU(b: number): number {
  const k = 1 / (b * b);
  let lo = 0;
  let hi = 2 / 3;
  for (let i = 0; i < 52; i++) {
    const m = 0.5 * (lo + hi);
    if (m * m * m - m * m + k > 0) lo = m;
    else hi = m;
  }
  return 0.5 * (lo + hi);
}

/**
 * ∫ du/√G from u = m − S² up to the periapsis m. With u = m − s², G factors as
 * s²·Q(u), Q = m(1 − m) + (1 − m)u − u², leaving the smooth ∫ 2 ds/√Q (Simpson).
 */
function toPeriapsis(m: number, S: number, n = 64): number {
  if (S <= 0) return 0;
  const a = m * (1 - m);
  const c = 1 - m;
  const f = (s: number) => {
    const u = m - s * s;
    return 2 / Math.sqrt(a + c * u - u * u);
  };
  const h = S / n;
  let sum = f(0) + f(S);
  for (let i = 1; i < n; i++) sum += f(i * h) * (i % 2 ? 4 : 2);
  return (sum * h) / 3;
}

/**
 * Exact Schwarzschild lensing of a source at infinity: the angle β (rad) from
 * the hole's direction that a ray seen at θ comes from, for an observer at r_o
 * horizon radii. NaN inside the shadow.
 */
export function exactSourceAngle(theta: number, ro: number): number {
  const uo = 1 / ro;
  const b = (ro * Math.sin(theta)) / Math.sqrt(1 - uo);
  const inward = theta < Math.PI / 2;
  let dphi: number;
  if (b > B_CRIT) {
    const m = periapsisU(b);
    const full = toPeriapsis(m, Math.sqrt(m));
    const here = toPeriapsis(m, Math.sqrt(Math.max(0, m - uo)));
    // Inward rays pass periapsis on the way out; outward ones are already past it.
    dphi = inward ? full + here : full - here;
  } else {
    if (inward) return NaN;
    // Outward with no turning point: straight out along ∫₀^u_o du/√G.
    const k = 1 / (b * b);
    const n = 64;
    const h = uo / n;
    const f = (u: number) => 1 / Math.sqrt(u * u * u - u * u + k);
    let sum = f(0) + f(uo);
    for (let i = 1; i < n; i++) sum += f(i * h) * (i % 2 ? 4 : 2);
    dphi = (sum * h) / 3;
  }
  return Math.PI - dphi;
}

/**
 * Layout of the exact-bending table the GPU samples: one row per observer
 * radius r_o (log-spaced, in r_s), one column per q = ln(θ/θ_sh − 1). Each
 * entry is the exact β minus the weak-field θ − θ_E²/θ, which is small far
 * out and varies slowly from row to row, so rows interpolate cleanly.
 * Beyond the last row the weak field alone is within a pixel.
 */
export const LENS_LUT = {
  n: 512,
  rows: 40,
  lnRo0: Math.log(3),
  lnRo1: Math.log(1e4),
  q0: Math.log(1e-6),
  q1: Math.log(12_100),
} as const;

/** Observer radius (r_s) of a table row. */
export const lensRowRadius = (row: number): number =>
  Math.exp(LENS_LUT.lnRo0 + ((LENS_LUT.lnRo1 - LENS_LUT.lnRo0) * row) / (LENS_LUT.rows - 1));

/** Fractional table row for an observer at r_o (r_s); −1 when the weak field suffices. */
export function lensRow(ro: number): number {
  const x = ((Math.log(ro) - LENS_LUT.lnRo0) / (LENS_LUT.lnRo1 - LENS_LUT.lnRo0)) * (LENS_LUT.rows - 1);
  return x > LENS_LUT.rows - 1 ? -1 : Math.max(0, x);
}

/** One table row: exact minus weak-field source angle (rad) across q. */
export function lensResidualRow(row: number): Float32Array {
  const { n, q0, q1 } = LENS_LUT;
  const ro = lensRowRadius(row);
  const sh = shadowAngularRadius(1, ro);
  const tE = einsteinAngle(1, ro);
  const out = new Float32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    const theta = Math.min(sh * (1 + Math.exp(q0 + ((q1 - q0) * i) / (n - 1))), Math.PI - 1e-9);
    const b = exactSourceAngle(theta, ro);
    // Rounding can land the innermost samples inside the shadow; extend the last good value.
    out[i] = Number.isFinite(b) ? b - sourceAngle(theta, tE) : out[Math.min(i + 1, n - 1)];
  }
  return out;
}

// ---- accretion disks --------------------------------------------------------
// Units r_s = 1 (M = ½). The orbit equation (du/dφ)² = u³ − u² + 1/b² gives,
// differentiated, u'' = 1.5u² − u, which RK4 steps along a ray traced back
// from the camera. The camera sits at −l·r_o from the hole; the photon is at
// p(φ) = (1/u)(−l cos φ + t sin φ), l the unit vector to the hole and t the
// unit tangent toward the ray in their plane. The GPU mirrors these functions
// (engine/lensingPass.ts).

/** One RK4 step of u'' = 1.5u² − u over dφ = h: [u, du/dφ] → [u, du/dφ]. */
export function orbitRk4(u: number, du: number, h: number): [number, number] {
  const f = (x: number) => 1.5 * x * x - x;
  const k1u = du;
  const k1v = f(u);
  const k2u = du + 0.5 * h * k1v;
  const k2v = f(u + 0.5 * h * k1u);
  const k3u = du + 0.5 * h * k2v;
  const k3v = f(u + 0.5 * h * k2u);
  const k4u = du + h * k3v;
  const k4v = f(u + h * k3u);
  return [u + (h / 6) * (k1u + 2 * k2u + 2 * k3u + k4u), du + (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)];
}

/** Starting [u, du/dφ] for a ray seen at angle θ from the hole by a static observer at r_o. */
export function rayStart(theta: number, ro: number): [number, number] {
  const uo = 1 / ro;
  return [uo, (uo * Math.sqrt(1 - uo) * Math.cos(theta)) / Math.max(Math.sin(theta), 1e-12)];
}

/** Photon position relative to the hole at azimuth φ along the traced ray. */
export const rayPoint = (l: Vec3, t: Vec3, u: number, phi: number): Vec3 =>
  scale(add(scale(l, -Math.cos(phi)), scale(t, Math.sin(phi))), 1 / u);

/** Azimuths where the traced ray crosses the plane through the hole with normal n. */
export function diskCrossings(l: Vec3, t: Vec3, n: Vec3, count = 3): number[] {
  let phi0 = Math.atan2(dot(l, n), dot(t, n));
  if (phi0 <= 0) phi0 += Math.PI;
  return Array.from({ length: count }, (_, k) => phi0 + k * Math.PI);
}

/**
 * The first place a ray seen at θ from the hole meets a thin disk (normal n,
 * radii rIn..rOut in r_s), for an observer at r_o: k counts the crossing
 * (0 direct, 1 lifted over the top, 2 the photon-ring image). Null when it
 * falls in or escapes first. RK4 with `steps` steps per crossing.
 */
export function traceToDisk(
  theta: number,
  ro: number,
  l: Vec3,
  t: Vec3,
  n: Vec3,
  rIn: number,
  rOut: number,
  steps = 32,
): { r: number; phi: number; k: number } | null {
  let [u, du] = rayStart(theta, ro);
  let phi = 0;
  const crossings = diskCrossings(l, t, n);
  for (let k = 0; k < crossings.length; k++) {
    const h = (crossings[k] - phi) / steps;
    for (let s = 0; s < steps; s++) {
      [u, du] = orbitRk4(u, du, h);
      if (u >= 1 || u <= 0) return null;
    }
    phi = crossings[k];
    const r = 1 / u;
    if (r >= rIn && r <= rOut) return { r, phi, k };
  }
  return null;
}

/** Keplerian angular velocity at radius r (r_s units, G = c = 1, M = ½). */
export const keplerOmega = (r: number): number => 1 / Math.sqrt(2 * r * r * r);

/**
 * Redshift g = ν_obs/ν_emit for gas rotating at Ω about the disk axis, at
 * radius r and cylindrical radius R, seen by a static observer at r_o. λ is
 * the photon's angular momentum about the axis per unit energy, conserved
 * along the ray: b·(l × t)·n for the photon heading to the camera.
 */
export function flowRedshift(r: number, R: number, omega: number, lambda: number, ro: number): number {
  const ut = 1 / Math.sqrt(Math.max(1e-9, 1 - 1 / r - R * R * omega * omega));
  return 1 / (Math.sqrt(1 - 1 / ro) * ut * (1 - omega * lambda));
}

/** Redshift of a thin Keplerian disk at radius r for a photon of angular momentum λ (see flowRedshift). */
export const diskRedshift = (r: number, lambda: number, ro: number): number => flowRedshift(r, r, keplerOmega(r), lambda, ro);

/**
 * Thin-disk temperature with zero torque at the inner edge (Shakura &
 * Sunyaev 1973; Page & Thorne 1974 in the Newtonian limit),
 * T ∝ (r_in/r)^¾ (1 − √(r_in/r))^¼, scaled so its peak (at 49/36 r_in) is 1.
 */
export function thinDiskTemperature(r: number, rIn: number): number {
  if (r <= rIn) return 0;
  const y = Math.sqrt(rIn / r);
  const peak = Math.pow(6 / 7, 6) / 7;
  return Math.pow((Math.pow(y, 6) * (1 - y)) / peak, 0.25);
}

/**
 * Disk axis (unit angular-momentum vector) for a hole whose direction toward
 * the observer is e, with sky north N there, at inclination i from e. With a
 * measured position angle (deg east of north) the axis leans toward it;
 * otherwise toward east, so the line of nodes runs north–south. `away` flips
 * the axis (clockwise rotation on the sky).
 */
export function diskAxis(e: Vec3, north: Vec3, inclDeg: number, paDeg?: number, away = false): Vec3 {
  const i = (inclDeg * Math.PI) / 180;
  let side: Vec3;
  if (paDeg === undefined) side = cross(north, e);
  else {
    const east = normalize(cross([0, 0, 1], scale(e, -1)));
    const pa = (paDeg * Math.PI) / 180;
    side = add(scale(north, Math.cos(pa)), scale(east, Math.sin(pa)));
  }
  const n = normalize(add(scale(e, Math.cos(i)), scale(side, Math.sin(i))));
  return away ? scale(n, -1) : n;
}

// Fly-to path: how far along the trip the pivot is and how far back the camera
// sits, as one curve.
//
// This is van Wijk & Nuij's optimal pan/zoom path ("Smooth and efficient
// zooming and panning", 2003; d3.interpolateZoom). It couples the pan to the
// view width, so the destination drifts into view at a steady perceived speed
// instead of whipping in as the camera zooms back down. Scales here span
// meters to 1e27 m, so every formula is in a scaled, cancellation-free form.

import { clamp } from '../../astro/vec.ts';

/** Pan/zoom trade-off. Lower is a shallower pull-back. */
export const RHO = Math.SQRT2;
/** How long the path lingers at its zoomed-out peak (0 = none). */
export const PEAK_DWELL = 2;

export interface ZoomPath {
  /** Perceptual path length (van Wijk's S). */
  S: number;
  /** Length of the dwell-warped parameter that `at` takes, 0..L. */
  L: number;
  /** ln of the farthest camera distance along the way. */
  peakLnR: number;
  /** Fraction of the pan done (`f`) and still to go (`g`), and ln(camera distance). */
  at(y: number): { f: number; g: number; lnR: number };
}

/** ln(cosh x) without overflow. */
const lncosh = (x: number): number => {
  const a = Math.abs(x);
  return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2;
};

/** Gudermannian: the integral of sech. */
const gd = (x: number): number => 2 * Math.atan(Math.tanh(x / 2));


/**
 * Path from camera distance r0 to r1 while the pivot moves d meters.
 * `fov` is the vertical field of view; the view height at the pivot is 2·r·tan(fov/2).
 */
export function zoomPath(r0: number, r1: number, d: number, fov: number, rho = RHO, beta = PEAK_DWELL): ZoomPath {
  const k = 2 * Math.tan(fov / 2);
  const w0 = k * r0;
  const w1 = k * r1;
  const ln0 = Math.log(r0);
  const ln1 = Math.log(r1);

  // Hardly any pan: a pure zoom, straight in log distance. (min, not max: a 1 AU
  // pan out of a 2e7 m view toward the whole universe is still a real pan.)
  if (!(d > 1e-9 * Math.min(w0, w1))) {
    const S = Math.abs(ln1 - ln0) / rho;
    // With no zoom either, still hand back a parameter to follow the easing.
    const L = S > 0 ? S : 1;
    return {
      S,
      L,
      peakLnR: Math.max(ln0, ln1),
      at(y) {
        const u = clamp(y / L, 0, 1);
        return { f: u, g: 1 - u, lnR: ln0 + (ln1 - ln0) * u };
      },
    };
  }

  // Everything divided by ρ²d so nothing squares a 1e27 m value.
  const r2 = rho * rho;
  const q0 = w0 / (r2 * d);
  const q1 = w1 / (r2 * d);
  const b0 = (q1 * q1 - q0 * q0 + 1) / (2 * q0);
  const b1 = (q1 * q1 - q0 * q0 - 1) / (2 * q1);
  // asinh, not d3's ln(√(b²+1) − b), which cancels to −∞ once b ≳ 1e8.
  const R0 = Math.asinh(-b0);
  const R1 = Math.asinh(-b1);
  const S = (R1 - R0) / rho;

  // Dwell warp σ(s) = s + (β/ρ)(gd(R0+ρs) − gd(R0)): dσ/ds = 1 + β·sech peaks
  // where the view is widest, so uniform steps in σ linger there.
  const gd0 = gd(R0);
  const sigma = (s: number): number => s + (beta / rho) * (gd(R0 + rho * s) - gd0);
  const L = sigma(S);
  const invert = (y: number): number => {
    if (y <= 0) return 0;
    if (y >= L) return S;
    let s = (y * S) / L;
    for (let i = 0; i < 8; i++) {
      const slope = 1 + beta / Math.cosh(R0 + rho * s);
      s = clamp(s - (sigma(s) - y) / slope, 0, S);
    }
    return s;
  };

  // The view is widest where R0 + ρs = 0, if that falls within the path.
  const peakLnR = R0 < 0 && R1 > 0 ? ln0 + lncosh(R0) : Math.max(ln0, ln1);

  return {
    S,
    L,
    peakLnR,
    at(y) {
      const s = invert(y);
      const d0 = rho * s;
      const d1 = rho * (S - s);
      const c = Math.cosh(R0 + d0);
      // Done and remaining are each computed directly, so both ends are exact
      // (f + g = 1 only to rounding; the pivot anchors on the nearer end).
      const f = s >= S ? 1 : (q0 * Math.sinh(d0)) / c;
      const g = s >= S ? 0 : (q1 * Math.sinh(d1)) / c;
      const lnR = s < S / 2 ? ln0 + lncosh(R0) - lncosh(R0 + d0) : ln1 + lncosh(R1) - lncosh(R1 - d1);
      return { f, g, lnR };
    },
  };
}

/** ∫ smootherstep: 0 → 0.5 over [0, 1]. */
const H = (x: number): number => x * x * x * x * (2.5 - 3 * x + x * x);

const RAMP_IN = 0.25;
const RAMP_OUT = 0.4;

/**
 * Trip easing: speed ramps up over the first quarter, holds steady, then
 * settles over the last 40%. Continuous through the third derivative, and the
 * top speed is only 1.48× the average. `rampIn` 0 starts at cruising speed
 * (a trip taken over mid-flight, already moving).
 */
export function glide(t: number, rampIn = RAMP_IN): number {
  const x = clamp(t, 0, 1);
  const area = 1 - (rampIn + RAMP_OUT) / 2;
  if (x < rampIn) return (rampIn * H(x / rampIn)) / area;
  if (x <= 1 - RAMP_OUT) return (rampIn / 2 + x - rampIn) / area;
  return 1 - (RAMP_OUT * H((1 - x) / RAMP_OUT)) / area;
}

/** Trip length in seconds from the path length and the angle the view swings through. */
export function flightDuration(S: number, swing: number, rho = RHO, beta = PEAK_DWELL): number {
  const travel = 0.27 * Math.pow(S + (beta * Math.PI) / rho, 0.86);
  return clamp(Math.max(travel, 1 + 0.5 * swing), 1.6, 8);
}

/**
 * An offset x0 moving at v0 (per second), eased to rest at zero over T
 * seconds; `t` is the fraction of T elapsed. Position, velocity and
 * acceleration match at both ends (quintic inertialization).
 */
export function settleCurve(x0: number, v0: number, t: number, T: number): number {
  const u = clamp(t, 0, 1);
  const smoother = u * u * u * (u * (u * 6 - 15) + 10);
  const w = 1 - u;
  return x0 * (1 - smoother) + v0 * T * u * w * w * w * (1 + 3 * u);
}

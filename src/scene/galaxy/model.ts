// Milky Way structure model (face-on surface-density maps), built from:
//  - Spiral arms: Reid et al. 2019, ApJ 885, 131, Table 2 (log-periodic
//    spirals with a kink; R0 = 8.15 kpc in their fits). Galactocentric azimuth
//    β = 0 toward the Sun, increasing in the direction of Galactic rotation:
//        ln(R / R_kink) = −(β − β_kink) · tan ψ,  ψ = ψ< (β ≤ β_kink), ψ> (β > β_kink)
//    Arm width (Gaussian 1σ) grows as w(R) = w(R_kink) + 0.042 (R − R_kink) kpc.
//    Arms are drawn at full strength over the measured β range and fade over
//    their extrapolated continuation (an explicit modeling choice).
//  - Disk: exponential, thin-disk scale length 2.6 kpc (Bland-Hawthorn &
//    Gerhard 2016, ARA&A 54, 529).
//  - Dust: lanes on the inner edge of the arms, a smooth disk cut into
//    spiral filaments, and feathers across the inter-arm gaps.
//  - Fine texture (clusters, filaments) is procedural noise styled on
//    face-on spirals such as M101; it is illustrative, not measured.
// Frame (kpc): +x from the Galactic Center toward the Sun, +z north; rotation
// is clockwise seen from +z, so a point at azimuth β is (R cos β, −R sin β).

export interface ArmSpec {
  name: string;
  betaKink: number; // deg
  rKink: number; // kpc
  psiIn: number; // deg, for β ≤ β_kink
  psiOut: number; // deg, for β > β_kink
  width: number; // kpc, Gaussian 1σ at R_kink
  measured: [number, number]; // β range with parallax data (deg)
  drawn: [number, number]; // β range rendered, including extrapolation (deg)
  young: number; // relative young-star strength
}

export const ARMS: ArmSpec[] = [
  { name: '3-kpc arm', betaKink: 15, rKink: 3.52, psiIn: -4.2, psiOut: -4.2, width: 0.18, measured: [15, 18], drawn: [-180, 180], young: 0.35 },
  { name: 'Norma arm', betaKink: 18, rKink: 4.46, psiIn: -1.0, psiOut: 19.5, width: 0.14, measured: [5, 54], drawn: [-120, 60], young: 0.8 },
  { name: 'Scutum–Centaurus arm', betaKink: 23, rKink: 4.91, psiIn: 14.1, psiOut: 12.1, width: 0.23, measured: [0, 104], drawn: [-210, 110], young: 1.0 },
  { name: 'Sagittarius–Carina arm', betaKink: 24, rKink: 6.04, psiIn: 17.1, psiOut: 1.0, width: 0.27, measured: [2, 97], drawn: [-150, 170], young: 1.0 },
  { name: 'Local arm', betaKink: 9, rKink: 8.26, psiIn: 11.4, psiOut: 11.4, width: 0.31, measured: [-8, 34], drawn: [-30, 55], young: 0.7 },
  { name: 'Perseus arm', betaKink: 40, rKink: 8.87, psiIn: 10.3, psiOut: 8.7, width: 0.35, measured: [-23, 115], drawn: [-150, 200], young: 0.9 },
  { name: 'Outer arm', betaKink: 18, rKink: 12.24, psiIn: 3.0, psiOut: 9.4, width: 0.65, measured: [-16, 71], drawn: [-120, 200], young: 0.6 },
];

export const MAP_SIZE = 1024;
/** Half-width of the map (kpc). */
export const MAP_EXTENT = 20;

const DEG = Math.PI / 180;

export function armRadius(a: ArmSpec, betaDeg: number): number {
  const psi = (betaDeg <= a.betaKink ? a.psiIn : a.psiOut) * DEG;
  return a.rKink * Math.exp(-(betaDeg - a.betaKink) * DEG * Math.tan(psi));
}

/** Arm centerline sampled every 0.5°, with a strength weight per point. */
function armPolyline(a: ArmSpec): Array<{ x: number; y: number; w: number; width: number }> {
  const pts = [];
  for (let b = a.drawn[0]; b <= a.drawn[1]; b += 0.5) {
    const R = armRadius(a, b);
    // Full strength over the measured range; fade over the extrapolation.
    const outside = b < a.measured[0] ? a.measured[0] - b : b > a.measured[1] ? b - a.measured[1] : 0;
    const span = b < a.measured[0] ? a.measured[0] - a.drawn[0] : a.drawn[1] - a.measured[1];
    const fade = outside === 0 ? 1 : Math.max(0, 1 - outside / Math.max(span, 1)) ** 0.7 * 0.8 + 0.0;
    const width = Math.max(0.12, a.width + 0.042 * (R - a.rKink));
    pts.push({ x: R * Math.cos(b * DEG), y: -R * Math.sin(b * DEG), w: fade, width });
  }
  return pts;
}

// Deterministic value noise (integer hash, so it is fast and identical everywhere).
function hash3(i: number, j: number, k: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/**
 * 3D value noise. The first axis wraps with integer period `px` (0 = no wrap),
 * which keeps spiral-aligned noise seamless across β = ±180°.
 */
function noise3(x: number, y: number, z: number, px = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const x0 = px ? ((xi % px) + px) % px : xi;
  const x1 = px ? (x0 + 1) % px : xi + 1;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(lerp(hash3(x0, yi, zi), hash3(x1, yi, zi), u), lerp(hash3(x0, yi + 1, zi), hash3(x1, yi + 1, zi), u), v),
    lerp(lerp(hash3(x0, yi, zi + 1), hash3(x1, yi, zi + 1), u), lerp(hash3(x0, yi + 1, zi + 1), hash3(x1, yi + 1, zi + 1), u), v),
    w,
  );
}
/** Fractal sum with lacunarity 2 (so a wrapped axis stays periodic at every octave). */
function fbm3(x: number, y: number, z: number, octaves: number, px = 0): number {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0, f = 1; i < octaves; i++, f *= 2) {
    s += amp * noise3(x * f, y * f, z * f + i * 7.31, px * f);
    norm += amp;
    amp *= 0.5;
  }
  return s / norm;
}
/** Ridged noise: thin bright lines where the noise crosses its midpoint. */
function ridged(n: number, sharp: number): number {
  return (1 - Math.abs(2 * n - 1)) ** sharp;
}

// Spiral-aligned texture coordinate. Along a log spiral of pitch ψ,
// ln R + β·tan ψ is constant, so noise stretched in the other two axes streaks
// along the arms like the dust lanes and star chains in face-on spirals (M101,
// M51). K is chosen so a full turn in β is a whole number of noise cells.
const PITCH_ARMS = Math.tan(12 * DEG);
const PERIOD_ARMS = 56;
const K_ARMS = PERIOD_ARMS / (2 * Math.PI * PITCH_ARMS);
// Dust feathers/spurs leave the arms at a much larger pitch angle.
const PITCH_SPURS = Math.tan(48 * DEG);
const PERIOD_SPURS = 24;
const K_SPURS = PERIOD_SPURS / (2 * Math.PI * PITCH_SPURS);

/**
 * RGBA float map, row-major, MAP_SIZE² texels spanning ±MAP_EXTENT kpc:
 *   R young-star arm density, G old-disk surface density, B dust, A HII clumps.
 */
export function buildGalaxyMaps(): Float32Array {
  const N = MAP_SIZE;
  const out = new Float32Array(N * N * 4);
  const kpcPerPx = (2 * MAP_EXTENT) / N;
  const young = new Float32Array(N * N);
  // Dust lanes run along the inner (concave) edge of trailing arms.
  const lane = new Float32Array(N * N);

  const splat = (dst: Float32Array, px: number, py: number, width: number, value: number) => {
    const rad = Math.ceil((3 * width) / kpcPerPx);
    const cx = (px + MAP_EXTENT) / kpcPerPx;
    const cy = (py + MAP_EXTENT) / kpcPerPx;
    for (let j = Math.floor(cy - rad); j <= cy + rad; j++) {
      if (j < 0 || j >= N) continue;
      for (let i = Math.floor(cx - rad); i <= cx + rad; i++) {
        if (i < 0 || i >= N) continue;
        const dx = (i + 0.5 - cx) * kpcPerPx;
        const dy = (j + 0.5 - cy) * kpcPerPx;
        const g = Math.exp(-(dx * dx + dy * dy) / (2 * width * width));
        const idx = j * N + i;
        dst[idx] = Math.max(dst[idx], g * value);
      }
    }
  };

  // Splat arms: for each centerline point, add a Gaussian across its width.
  for (const a of ARMS) {
    for (const p of armPolyline(a)) {
      if (p.w <= 0) continue;
      const R = Math.hypot(p.x, p.y);
      // 0.5° steps along the arm: normalize by the step length.
      const step = (0.5 * DEG * R) / (Math.sqrt(2 * Math.PI) * p.width);
      splat(young, p.x, p.y, p.width, p.w * a.young * Math.min(1, step * 2));
      const k = Math.max(0.2, R - 0.8 * p.width) / R;
      splat(lane, p.x * k, p.y * k, 0.55 * p.width, p.w * Math.min(1, 0.4 + a.young) * Math.min(1, step * 2));
    }
  }

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * kpcPerPx - MAP_EXTENT;
      const y = (j + 0.5) * kpcPerPx - MAP_EXTENT;
      const R = Math.max(0.05, Math.hypot(x, y));
      const beta = Math.atan2(-y, x);
      const lnR = Math.log(R);
      const idx = j * N + i;
      // Old stellar disk: exponential with scale length 2.6 kpc, a central
      // deficit where the bar dominates, and a soft edge beyond ~16 kpc.
      const edge = 1 / (1 + Math.exp((R - 16) / 1.2));
      const hole = 0.35 + 0.65 * smooth(1.5, 4.0, R);
      const disk = Math.exp(-R / 2.6) * hole * edge;
      const arm = young[idx];
      const uA = (lnR + beta * PITCH_ARMS) * K_ARMS;
      const uS = (lnR + beta * PITCH_SPURS) * K_SPURS;
      // Star-forming complexes (~0.5 kpc) and chains of them along the arms.
      const clump = fbm3(x * 1.7, y * 1.7, 0.5, 3);
      const chain = fbm3(uA * 0.5, x * 0.9, y * 0.9, 3, PERIOD_ARMS / 2);
      // Individual clusters and thin dust filaments are finer than this map;
      // the shader adds them from the detail texture (buildDetailMap).
      const yng = (0.15 * arm + arm ** 1.4 * (0.3 + 1.6 * smooth(0.35, 0.75, chain) * (0.5 + clump))) * edge;
      // HII regions: sparse bright knots inside the arms.
      const hii = arm * Math.max(0, fbm3(x * 5.3 + 17, y * 5.3 - 9, 1.7, 3) - 0.62) * 6 * edge;
      // Dust: a smooth disk (scale length ~3.3 kpc) cut into thin spiral
      // filaments, lanes on the inner edge of each arm, and feathers across the
      // inter-arm gaps.
      const fil = ridged(fbm3(uA * 0.5, x * 2.4, y * 2.4, 3, PERIOD_ARMS / 2), 3);
      const spur = ridged(fbm3(uS, x * 1.1, y * 1.1, 2, PERIOD_SPURS), 5);
      const patchy = fbm3(x * 3.1, y * 3.1, 9.2, 3);
      const dust =
        (Math.exp(-R / 3.3) * (0.1 + 2.2 * fil * patchy + 0.9 * spur * patchy) + lane[idx] * (0.8 + 2.5 * fil) + arm * 0.25 * patchy) *
        edge *
        (0.45 + 0.55 * smooth(0.6, 2.2, R));
      out[idx * 4] = yng;
      out[idx * 4 + 1] = disk;
      out[idx * 4 + 2] = dust;
      out[idx * 4 + 3] = hii;
    }
  }
  return out;
}

// Fine detail, sampled by the shader in log-polar spiral coordinates
//   u = (ln R + β·tan ψ) · DETAIL_KU   (across the arms)
//   v = β / 2π · DETAIL_M             (along the arms)
// so it streaks along the spiral and resolves ~5 pc features at the Sun's
// radius however close the camera gets. Both axes tile seamlessly across
// β = ±180°: a full turn shifts u by exactly DETAIL_U_TURNS tiles and v by
// DETAIL_M tiles.
export const DETAIL_SIZE = 512;
export const DETAIL_U_TURNS = 4;
export const DETAIL_PITCH = PITCH_ARMS;
export const DETAIL_KU = DETAIL_U_TURNS / (2 * Math.PI * PITCH_ARMS);
export const DETAIL_M = 20;

/** Value noise on a lattice that wraps every (px, py) cells. */
function tileNoise(x: number, y: number, px: number, py: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % px) + px) % px;
  const y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const a = hash3(x0, y0, seed);
  const b = hash3(x1, y0, seed);
  const c = hash3(x0, y1, seed);
  const d = hash3(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Tileable fbm over the unit square with (px, py) base cells. */
function tileFbm(x: number, y: number, px: number, py: number, octaves: number, seed: number): number {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0, f = 1; i < octaves; i++, f *= 2) {
    s += amp * tileNoise(x * px * f, y * py * f, px * f, py * f, seed + i);
    norm += amp;
    amp *= 0.5;
  }
  return s / norm;
}

/**
 * RGBA8 detail tile (DETAIL_SIZE², row-major, x = u across arms, y = v along):
 *   R star clusters (sparse sharp knots), G dust filaments along the arms,
 *   B dust mottling and feathers, A star chains along the arms.
 */
export function buildDetailMap(): Uint8Array {
  const N = DETAIL_SIZE;
  const out = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / N;
      const y = (j + 0.5) / N;
      // Domain warp so filaments wander instead of running dead straight.
      const wx = x + 0.035 * (tileFbm(x, y, 6, 6, 3, 11) - 0.5);
      const wy = y + 0.05 * (tileFbm(x, y, 5, 5, 3, 23) - 0.5);
      // Clusters: two populations of knots, a few pixels and ~10 pixels wide.
      const k1 = Math.max(0, tileFbm(x, y, 128, 128, 2, 31) - 0.62) / 0.38;
      const k2 = Math.max(0, tileFbm(x, y, 40, 40, 2, 41) - 0.66) / 0.34;
      const knots = Math.min(1, 1.6 * k1 * k1 + 1.2 * k2 * k2);
      // Filaments: ridged noise, long along v (the arm direction).
      const fil = ridged(tileFbm(wx, wy, 24, 5, 4, 51), 5);
      const fil2 = ridged(tileFbm(wx, wy, 56, 9, 3, 61), 6);
      const dust = Math.min(1, 0.85 * fil + 0.5 * fil2);
      const mottle = tileFbm(wx, wy, 14, 14, 5, 71);
      const chain = smooth(0.3, 0.75, tileFbm(wx, wy, 20, 6, 4, 81));
      const o = (j * N + i) * 4;
      out[o] = Math.round(knots * 255);
      out[o + 1] = Math.round(dust * 255);
      out[o + 2] = Math.round(mottle * 255);
      out[o + 3] = Math.round(chain * 255);
    }
  }
  return out;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

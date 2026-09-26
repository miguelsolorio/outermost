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
//  - Dust: follows the young arms plus a smooth disk.
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

// Deterministic value noise for clumpy star-forming regions.
function hash(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number): number {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < 4; i++) {
    s += amp * noise(x * f, y * f);
    f *= 2.07;
    amp *= 0.5;
  }
  return s;
}

/**
 * RGBA float map, row-major, MAP_SIZE² texels spanning ±MAP_EXTENT kpc:
 *   R young-star arm density, G old-disk surface density, B dust, A HII clumps.
 */
export function buildGalaxyMaps(): Float32Array {
  const N = MAP_SIZE;
  const out = new Float32Array(N * N * 4);
  const kpcPerPx = (2 * MAP_EXTENT) / N;
  const young = new Float32Array(N * N);

  // Splat arms: for each centerline point, add a Gaussian across its width.
  for (const a of ARMS) {
    for (const p of armPolyline(a)) {
      if (p.w <= 0) continue;
      const rad = Math.ceil((3 * p.width) / kpcPerPx);
      const cx = (p.x + MAP_EXTENT) / kpcPerPx;
      const cy = (p.y + MAP_EXTENT) / kpcPerPx;
      for (let j = Math.floor(cy - rad); j <= cy + rad; j++) {
        if (j < 0 || j >= N) continue;
        for (let i = Math.floor(cx - rad); i <= cx + rad; i++) {
          if (i < 0 || i >= N) continue;
          const dx = (i + 0.5 - cx) * kpcPerPx;
          const dy = (j + 0.5 - cy) * kpcPerPx;
          const g = Math.exp(-(dx * dx + dy * dy) / (2 * p.width * p.width));
          // 0.5° steps along the arm: normalize by the step length.
          const step = (0.5 * DEG * Math.hypot(p.x, p.y)) / (Math.sqrt(2 * Math.PI) * p.width);
          const idx = j * N + i;
          young[idx] = Math.max(young[idx], g * p.w * a.young * Math.min(1, step * 2));
        }
      }
    }
  }

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * kpcPerPx - MAP_EXTENT;
      const y = (j + 0.5) * kpcPerPx - MAP_EXTENT;
      const R = Math.hypot(x, y);
      const idx = j * N + i;
      // Old stellar disk: exponential with scale length 2.6 kpc, a central
      // deficit where the bar dominates, and a soft edge beyond ~16 kpc.
      const edge = 1 / (1 + Math.exp((R - 16) / 1.2));
      const hole = 0.35 + 0.65 * smooth(1.5, 4.0, R);
      const disk = Math.exp(-R / 2.6) * hole * edge;
      const arm = young[idx];
      const clump = fbm(x * 1.7, y * 1.7);
      const clump2 = fbm(x * 5.3 + 17, y * 5.3 - 9);
      // Young stars concentrate in the arms, broken into star-forming complexes.
      const yng = arm * (0.45 + 0.9 * clump) * edge;
      // HII regions: sparse bright knots inside the arms.
      const hii = arm * Math.max(0, clump2 - 0.62) * 6 * edge;
      // Dust: smooth disk plus lanes along the arms (scale length ~3.3 kpc).
      const dust = (Math.exp(-R / 3.3) * 0.5 + arm * (0.6 + 0.8 * clump)) * edge * (0.5 + 0.5 * smooth(0.8, 2.5, R));
      out[idx * 4] = yng;
      out[idx * 4 + 1] = disk;
      out[idx * 4 + 2] = dust;
      out[idx * 4 + 3] = hii;
    }
  }
  return out;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

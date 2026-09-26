// Star catalog, constellation figures and boundaries.
//
// Inputs (see data/sources.json): HYG v4.4 (CC BY-SA 4.0), Stellarium modern_iau
// figures (CC BY-SA 4.0), VizieR VI/49 J2000 boundaries.
// Outputs under assets/stars/ are derived data and carry CC BY-SA 4.0.
//
// stars.bin layout (little-endian):
//   header  : "STR1", uint32 count, uint32 stride (32), float32 epoch (2000.0)
//   per star: float32 x, y, z (pc, ICRS/J2000 equatorial; +x toward RA 0, +z north)
//             float32 absmag (V)
//             float32 vx, vy, vz (pc / Julian year)
//             uint8 r, g, b (sRGB of the blackbody color), uint8 flags
// Stars are sorted by apparent magnitude from Earth, brightest first.

import * as A from 'astronomy-engine';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { ensureFile } from '../fetch.ts';
import { blackbodyLinearRgb, bvToTemperature, linearToSrgb } from '../../../src/astro/color.ts';
import type { StepContext } from '../run.ts';
import { ROOT } from '../../bake/util.ts';

export interface HygStar {
  id: number;
  /** AT-HYG only: the matching HYG id. */
  hyg?: number;
  /** Where the distance came from: Hipparcos (HYG), Gaia DR3 (AT-HYG) or a cited override. */
  distSrc?: 'hip' | 'gaia' | 'override';
  hip: number | null;
  proper: string;
  bayer: string;
  flam: string;
  con: string;
  ra: number; // hours
  dec: number; // deg
  dist: number; // pc
  mag: number;
  absmag: number;
  spect: string;
  ci: number | null;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  lum: number;
  base: string;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export async function readHyg(path: string): Promise<HygStar[]> {
  const rl = createInterface({ input: createReadStream(path).pipe(createGunzip()) });
  let header: string[] | null = null;
  const stars: HygStar[] = [];
  for await (const line of rl) {
    const cols = parseCsvLine(line);
    if (!header) {
      header = cols;
      continue;
    }
    const r = Object.fromEntries(header.map((h, i) => [h, cols[i] ?? '']));
    const num = (k: string) => (r[k] === '' ? NaN : Number(r[k]));
    stars.push({
      id: num('id'),
      hyg: r.hyg !== undefined && r.hyg !== '' ? Number(r.hyg) : undefined,
      hip: r.hip ? Number(r.hip) : null,
      proper: r.proper,
      bayer: r.bayer,
      flam: r.flam,
      con: r.con,
      ra: num('ra'),
      dec: num('dec'),
      dist: num('dist'),
      mag: num('mag'),
      absmag: num('absmag'),
      spect: r.spect,
      ci: r.ci === '' ? null : Number(r.ci),
      x: num('x'),
      y: num('y'),
      z: num('z'),
      vx: num('vx'),
      vy: num('vy'),
      vz: num('vz'),
      lum: num('lum'),
      base: r.base,
    });
  }
  return stars;
}

const GREEK: Record<string, string> = {
  Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ', Iot: 'ι', Kap: 'κ', Lam: 'λ', Mu: 'μ',
  Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π', Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ', Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω',
};
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';

export function bayerDesignation(bayer: string, con: string): string {
  if (!bayer || !con) return '';
  const m = bayer.match(/^([A-Za-z]+)(?:-?(\d+))?$/);
  if (!m) return `${bayer} ${con}`;
  const letter = GREEK[m[1]] ?? m[1];
  const idx = m[2] ? [...m[2]].map((d) => SUP[Number(d)]).join('') : '';
  return `${letter}${idx} ${con}`;
}

/** Spectral class fallback when B−V is missing (rough class temperatures). */
function tempFromSpectral(spect: string): number {
  const cls = spect.trim().charAt(0).toUpperCase();
  return ({ O: 35000, B: 18000, A: 8750, F: 6750, G: 5600, K: 4450, M: 3200 } as Record<string, number>)[cls] ?? 5800;
}

export async function processStars(ctx: StepContext): Promise<void> {
  const out = join(ctx.outDir, 'stars');
  await mkdir(out, { recursive: true });
  const hygPath = await ensureFile('hyg-v44', 'hyg_v44.csv.gz');
  const all = await readHyg(hygPath);
  const overrides = JSON.parse(await readFile(join(ROOT, 'data', 'star-overrides.json'), 'utf8')) as {
    aliases: Array<{ hip: number; hygId: number }>;
    distances: Array<{ hip: number; dist_pc: number }>;
    names?: Array<{ hip: number; name: string }>;
  };
  for (const a of overrides.aliases) {
    const s = all.find((x) => x.id === a.hygId);
    if (s) s.hip = a.hip;
  }
  for (const n of overrides.names ?? []) {
    const s = all.find((x) => x.hip === n.hip);
    if (!s) throw new Error(`name override HIP ${n.hip} not found`);
    s.proper = n.name;
  }
  // HYG's visual luminosity (× Sun) from absolute magnitude; recomputed wherever the distance changes.
  const lumOf = (absmag: number) => 10 ** ((4.85 - absmag) / 2.5);
  // Unknown HYG distances (flagged 100000 pc) fall back to AT-HYG Gaia DR3 distances.
  const athyg = new Map<number, HygStar>();
  for (const s of await readHyg(await ensureFile('athyg-v40', 'hyglike_from_athyg_v40.csv.gz'))) {
    if (s.hyg !== undefined && s.dist > 0 && s.dist < 100_000) athyg.set(s.hyg, s);
  }
  let gaiaFilled = 0;
  for (const s of all) {
    s.distSrc = 'hip';
    if (s.dist > 0 && s.dist < 100_000) continue;
    const g = athyg.get(s.id);
    if (!g) continue;
    // Everything derived from the distance comes along: HYG computed luminosity and
    // space velocity for these stars at its 100,000 pc placeholder.
    Object.assign(s, { dist: g.dist, x: g.x, y: g.y, z: g.z, vx: g.vx, vy: g.vy, vz: g.vz, absmag: g.absmag, lum: lumOf(g.absmag), distSrc: 'gaia' as const });
    gaiaFilled++;
  }
  // Cited literature distances: where every parallax is consistent with zero,
  // or where a newer measurement replaces the Hipparcos one.
  for (const o of overrides.distances) {
    const s = all.find((x) => x.hip === o.hip);
    if (!s) throw new Error(`override HIP ${o.hip} not found`);
    const ra = s.ra * 15 * (Math.PI / 180);
    const dec = s.dec * (Math.PI / 180);
    const u = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
    // Proper motion is an angle: the tangential velocity scales with distance (HYG
    // derived it at s.dist, even the 100,000 pc placeholder), the radial one doesn't.
    const k = s.dist > 0 ? o.dist_pc / s.dist : 1;
    const v = [s.vx, s.vy, s.vz].map((c) => (Number.isFinite(c) ? c : 0));
    const vr = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
    const absmag = s.mag - 5 * Math.log10(o.dist_pc / 10);
    Object.assign(s, {
      dist: o.dist_pc,
      x: o.dist_pc * u[0],
      y: o.dist_pc * u[1],
      z: o.dist_pc * u[2],
      vx: vr * u[0] + (v[0] - vr * u[0]) * k,
      vy: vr * u[1] + (v[1] - vr * u[1]) * k,
      vz: vr * u[2] + (v[2] - vr * u[2]) * k,
      absmag,
      lum: lumOf(absmag),
      distSrc: 'override' as const,
    });
  }
  // Drop the Sun (rendered separately) and stars still without a usable distance.
  const stars = all.filter((s) => s.id !== 0 && s.dist > 0 && s.dist < 100_000 && Number.isFinite(s.absmag));
  stars.sort((a, b) => a.mag - b.mag);
  const index = new Map<number, number>();
  stars.forEach((s, i) => s.hip && !index.has(s.hip) && index.set(s.hip, i));

  // ---- binary -----------------------------------------------------------------
  const STRIDE = 32;
  const buf = Buffer.alloc(16 + stars.length * STRIDE);
  buf.write('STR1', 0, 'ascii');
  buf.writeUInt32LE(stars.length, 4);
  buf.writeUInt32LE(STRIDE, 8);
  buf.writeFloatLE(2000.0, 12);
  let missingCi = 0;
  stars.forEach((s, i) => {
    const o = 16 + i * STRIDE;
    buf.writeFloatLE(s.x, o);
    buf.writeFloatLE(s.y, o + 4);
    buf.writeFloatLE(s.z, o + 8);
    buf.writeFloatLE(s.absmag, o + 12);
    buf.writeFloatLE(Number.isFinite(s.vx) ? s.vx : 0, o + 16);
    buf.writeFloatLE(Number.isFinite(s.vy) ? s.vy : 0, o + 20);
    buf.writeFloatLE(Number.isFinite(s.vz) ? s.vz : 0, o + 24);
    let T: number;
    if (s.ci !== null && Number.isFinite(s.ci)) T = bvToTemperature(s.ci);
    else {
      T = tempFromSpectral(s.spect);
      missingCi++;
    }
    const rgb = blackbodyLinearRgb(T).map((c) => Math.round(255 * linearToSrgb(c)));
    buf.writeUInt8(rgb[0], o + 28);
    buf.writeUInt8(rgb[1], o + 29);
    buf.writeUInt8(rgb[2], o + 30);
    buf.writeUInt8((s.proper ? 1 : 0) | (s.distSrc === 'gaia' ? 2 : 0) | (s.distSrc === 'override' ? 4 : 0), o + 31);
  });
  await writeFile(join(out, 'stars.bin'), buf);

  // ---- constellation figures ------------------------------------------------------
  const sky = JSON.parse(await readFile(await ensureFile('stellarium-modern-iau', 'index.json'), 'utf8'));
  const missing: number[] = [];
  const figureStars = new Set<number>();
  const constellations = (sky.constellations as Array<{ id: string; lines: number[][]; common_name: { english: string; native?: string } }>).map(
    (c) => {
      const abbr = c.id.split(' ').pop()!;
      const lines = c.lines.map((poly) =>
        poly
          .map((hip) => {
            const i = index.get(hip);
            if (i === undefined) missing.push(hip);
            else figureStars.add(i);
            return i ?? -1;
          })
          .filter((i) => i >= 0),
      );
      return { abbr, name: c.common_name.native ?? c.common_name.english, english: c.common_name.english, hips: c.lines, lines };
    },
  );

  // ---- boundaries -------------------------------------------------------------------
  // Delporte (1930) boundaries are arcs of constant right ascension (M) or
  // declination (P) in the B1875.0 frame. Sample each edge in that frame and
  // precess to J2000 (astronomy-engine, IAU 2006 precession; nutation < 20").
  const B1875 = new A.AstroTime(2405889.258550475 - 2451545.0);
  const toJ2000 = A.Rotation_EQD_EQJ(B1875);
  const hms = (t: string) => {
    const [h, m, sec] = t.split(':').map(Number);
    return (h + m / 60 + sec / 3600) * 15;
  };
  const dms = (t: string) => {
    const sign = t.startsWith('-') ? -1 : 1;
    const [d, m, sec] = t.replace(/^[+-]/, '').split(':').map(Number);
    return sign * (d + m / 60 + sec / 3600);
  };
  const boundaries: Array<{ cons: [string, string]; points: number[][] }> = [];
  for (const edge of sky.edges as string[]) {
    const [, type, ra1s, de1s, ra2s, de2s, c1, c2] = edge.split(/\s+/);
    let ra1 = hms(ra1s);
    let ra2 = hms(ra2s);
    const de1 = dms(de1s);
    const de2 = dms(de2s);
    if (type.startsWith('P') && ra2 < ra1) ra2 += 360; // parallels run eastward through 0h
    const span = type.startsWith('M') ? Math.abs(de2 - de1) : Math.abs(ra2 - ra1) * Math.cos((de1 * Math.PI) / 180);
    const n = Math.max(1, Math.ceil(span / 0.5));
    const points: number[][] = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const ra = ((type.startsWith('M') ? ra1 : ra1 + (ra2 - ra1) * t) * Math.PI) / 180;
      const de = ((type.startsWith('M') ? de1 + (de2 - de1) * t : de1) * Math.PI) / 180;
      const v = A.RotateVector(toJ2000, new A.Vector(Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de), B1875));
      let raJ = (Math.atan2(v.y, v.x) * 180) / Math.PI;
      if (raJ < 0) raJ += 360;
      const deJ = (Math.asin(v.z) * 180) / Math.PI;
      points.push([Math.round(raJ * 1e5) / 1e5, Math.round(deJ * 1e5) / 1e5]);
    }
    boundaries.push({ cons: [c1, c2], points });
  }

  // ---- metadata for search, labels and info cards -----------------------------------
  const meta = stars
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => s.proper || s.mag <= 6.5 || s.dist <= 20 || figureStars.has(i))
    .map(({ s, i }) => ({
      i,
      hip: s.hip,
      name: s.proper || undefined,
      bayer: bayerDesignation(s.bayer, s.con) || undefined,
      flam: s.flam && s.con ? `${s.flam} ${s.con}` : undefined,
      con: s.con || undefined,
      spect: s.spect || undefined,
      dist: Math.round(s.dist * 1000) / 1000,
      mag: s.mag,
      absmag: Math.round(s.absmag * 100) / 100,
      ci: s.ci ?? undefined,
      lum: Math.round(s.lum * 1000) / 1000,
      distSrc: s.distSrc,
    }));

  const license = {
    license: 'CC BY-SA 4.0',
    attribution: [
      'HYG Stellar Database v4.4, David Nash (astronexus), CC BY-SA 4.0',
      'AT-HYG v4.0 (Gaia DR3 distances for stars without Hipparcos distances), CC BY-SA 4.0',
      'Constellation figures: Stellarium modern_iau sky culture (CC BY-SA 4.0), after IAU / Sky & Telescope',
      'Constellation boundaries: Delporte (1930) B1875 edges via Stellarium/pbarbier.com, precessed to J2000',
    ],
  };
  await writeFile(join(out, 'stars-meta.json'), JSON.stringify({ ...license, count: meta.length, stars: meta }));
  await writeFile(join(out, 'constellations.json'), JSON.stringify({ ...license, missingHip: missing, constellations, boundaries }));
  await writeFile(
    join(out, 'LICENSE.txt'),
    `The files in this directory are derived from CC BY-SA 4.0 data and are licensed CC BY-SA 4.0.\n\n${license.attribution.join('\n')}\n`,
  );
  for (const f of ['stars.bin', 'stars-meta.json', 'constellations.json', 'LICENSE.txt']) {
    await ctx.record(`stars/${f}`, join(out, f), ['hyg-v44', 'athyg-v40', 'stellarium-modern-iau']);
  }
  console.log(
    `  stars: ${stars.length} (${missingCi} without B−V, ${gaiaFilled} Gaia-filled distances), meta ${meta.length}, constellations ${constellations.length}, ` +
      `boundaries ${boundaries.length}, missing HIP ${missing.length}`,
  );
}

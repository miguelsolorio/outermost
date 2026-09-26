// Galaxy catalogs -> assets/galaxies/.
//  local.json   Local Volume: UNGC (Karachentsev et al. 2013, 869 galaxies to
//               ~11 Mpc, distances from TRGB/Cepheids/etc.) + LVDB (Pace 2025,
//               CC0) dwarfs not already in UNGC.
//  2mrs.bin     2MASS Redshift Survey (44,599 galaxies, full sky outside the
//               Galactic plane). Distances are comoving, from redshifts
//               corrected to the CMB frame (Planck 2018 dipole) with Planck18
//               cosmology; peculiar velocities make clusters look stretched
//               along the line of sight ("fingers of God").
//  sdss.bin     SDSS DR17 spectroscopic galaxies (subsample) to z ≈ 0.8.
//  qso.bin      SDSS DR17 quasars (subsample) to z ≈ 5.
// Binary layout: header "GAL1", uint32 count, uint32 stride(20), then per
// object float32 x, y, z (Mpc, ICRS/J2000 axes, origin at the Sun), float32 size
// (kpc diameter, or 0), int16 type (T-type, 99 unknown, -9 QSO), int16 spare.

import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { join } from 'node:path';
import { ensureFile } from '../fetch.ts';
import { fetchText } from '../../bake/util.ts';
import { comovingDistanceMpc } from '../../../src/astro/cosmology.ts';
import type { StepContext } from '../run.ts';

const DEG = Math.PI / 180;
const C_KMS = 299_792.458;
// CMB dipole (Planck 2018 I, A&A 641, A1): 369.82 km/s toward l = 264.021°, b = 48.253°.
const DIPOLE_V = 369.82;
const DIPOLE_L = 264.021;
const DIPOLE_B = 48.253;

const unit = (raDeg: number, decDeg: number): [number, number, number] => [
  Math.cos(decDeg * DEG) * Math.cos(raDeg * DEG),
  Math.cos(decDeg * DEG) * Math.sin(raDeg * DEG),
  Math.sin(decDeg * DEG),
];
const galUnit = (l: number, b: number): [number, number, number] => [Math.cos(b * DEG) * Math.cos(l * DEG), Math.cos(b * DEG) * Math.sin(l * DEG), Math.sin(b * DEG)];

// Comoving distance lookup table (fast for 10^5–10^6 objects).
const DC_Z: number[] = [];
const DC_D: number[] = [];
for (let i = 0; i <= 4000; i++) {
  const z = (i / 4000) ** 2 * 7.5;
  DC_Z.push(z);
  DC_D.push(comovingDistanceMpc(z, 1024));
}
function dc(z: number): number {
  let lo = 0;
  let hi = DC_Z.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (DC_Z[m] < z) lo = m;
    else hi = m;
  }
  const t = (z - DC_Z[lo]) / (DC_Z[hi] - DC_Z[lo]);
  return DC_D[lo] + t * (DC_D[hi] - DC_D[lo]);
}

interface Gal {
  xyz: [number, number, number];
  size: number;
  type: number;
}

function pack(list: Gal[]): Buffer {
  const STRIDE = 20;
  const b = Buffer.alloc(12 + list.length * STRIDE);
  b.write('GAL1', 0, 'ascii');
  b.writeUInt32LE(list.length, 4);
  b.writeUInt32LE(STRIDE, 8);
  list.forEach((g, i) => {
    const o = 12 + i * STRIDE;
    b.writeFloatLE(g.xyz[0], o);
    b.writeFloatLE(g.xyz[1], o + 4);
    b.writeFloatLE(g.xyz[2], o + 8);
    b.writeFloatLE(g.size, o + 12);
    b.writeInt16LE(g.type, o + 16);
  });
  return b;
}

async function gunzip(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    createReadStream(path).pipe(createGunzip()).on('data', (d: Buffer) => chunks.push(d)).on('end', () => resolve(Buffer.concat(chunks).toString('latin1'))).on('error', reject);
  });
}

function csvRows(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const parse = (l: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (const c of l) {
      if (c === '"') q = !q;
      else if (c === ',' && !q) {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out;
  };
  const head = parse(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(parse(l).map((v, i) => [head[i], v])));
}

async function sdssQuery(sql: string): Promise<Array<Record<string, string>>> {
  const url = `https://skyserver.sdss.org/dr17/SkyServerWS/SearchTools/SqlSearch?format=csv&cmd=${encodeURIComponent(sql)}`;
  const text = await fetchText(url);
  return csvRows(text.replace(/^#Table1\r?\n/, ''));
}

export async function processGalaxies(ctx: StepContext): Promise<void> {
  const out = join(ctx.outDir, 'galaxies');
  await mkdir(out, { recursive: true });

  // ---- Local Volume ------------------------------------------------------------------
  const t1 = (await readFile(await ensureFile('ungc', 'table1.dat'), 'latin1')).split('\n');
  const t2 = (await readFile(await ensureFile('ungc', 'table2.dat'), 'latin1')).split('\n');
  const f = (l: string, a: number, b: number) => l.slice(a - 1, b).trim();
  const n = (s: string) => (s === '' ? null : Number(s));
  const local: Array<Record<string, unknown>> = [];
  for (let i = 0; i < t1.length; i++) {
    const l = t1[i];
    if (l.length < 100) continue;
    const l2 = t2[i] ?? '';
    const ra = (Number(f(l, 20, 21)) + Number(f(l, 23, 24)) / 60 + Number(f(l, 26, 29)) / 3600) * 15;
    const dec = (f(l, 31, 31) === '-' ? -1 : 1) * (Number(f(l, 32, 33)) + Number(f(l, 35, 36)) / 60 + Number(f(l, 38, 39)) / 3600);
    local.push({
      name: f(l, 1, 18),
      ra: Math.round(ra * 1e5) / 1e5,
      dec: Math.round(dec * 1e5) / 1e5,
      dist_mpc: n(f(l, 115, 119)),
      dist_method: f(l, 121, 124),
      T: n(f(l, 99, 100)),
      morph: f(l, 102, 106) || undefined,
      a26_arcmin: n(f(l, 41, 46)),
      ba: n(f(l, 48, 51)),
      diam_kpc: n(f(l2, 41, 45)),
      incl_deg: n(f(l2, 47, 48)),
      BMag: n(f(l2, 59, 63)),
      hrv_kms: n(f(l, 110, 113)),
      src: 'UNGC',
    });
  }
  const lv = csvRows(await readFile(await ensureFile('lvdb', 'comb_all.csv'), 'utf8'));
  // Cross-match: same name, or a position inside the UNGC galaxy's own extent.
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^messier0*/, 'm').replace(/^ngc0*/, 'ngc');
  const match = (name: string, key: string, ra: number, dec: number) =>
    local.find((g) => norm(g.name as string) === norm(name) || norm(g.name as string) === norm(key)) ??
    local.find((g) => {
      // Positional matches only for UNGC entries not already matched (keeps
      // companions like NGC 5195 from overwriting M51).
      if (g.lvdb) return false;
      const tol = Math.max(0.05, (((g.a26_arcmin as number) ?? 0) / 60) * 0.3);
      return Math.abs((g.dec as number) - dec) < tol && Math.abs(((((g.ra as number) - ra) + 540) % 360) - 180) * Math.cos(dec * DEG) < tol;
    });
  let lvAdded = 0;
  for (const r of lv) {
    if (!r.ra || !r.distance || r.table?.startsWith('gc') || r.table === 'candidate') continue;
    if (r.confirmed_galaxy === '0') continue;
    const ra = Number(r.ra);
    const dec = Number(r.dec);
    const dist = Number(r.distance) / 1000;
    if (!Number.isFinite(dist) || dist <= 0) continue;
    const pa = r.position_angle ? Number(r.position_angle) : null;
    const g = match(r.name, r.key, ra, dec);
    if (g) {
      // Keep UNGC's entry (types, diameters) but prefer LVDB's more precise distance and PA.
      if (pa !== null && g.pa_deg === undefined) g.pa_deg = pa;
      g.dist_mpc = Math.round(dist * 1e5) / 1e5;
      g.dist_method = `${g.dist_method}; LVDB`;
      g.lvdb = r.key;
      continue;
    }
    const rh = r.rhalf_physical ? Number(r.rhalf_physical) / 1000 : null;
    local.push({
      name: r.name,
      ra,
      dec,
      dist_mpc: Math.round(dist * 1e5) / 1e5,
      dist_method: 'LVDB',
      T: 10, // dwarf
      diam_kpc: rh ? 4 * rh : null,
      ba: r.ellipticity ? 1 - Number(r.ellipticity) : null,
      pa_deg: pa,
      MV: r.M_V ? Number(r.M_V) : null,
      host: r.host || undefined,
      src: 'LVDB',
      lvdb: r.key,
    });
    lvAdded++;
  }
  await writeFile(join(out, 'local.json'), JSON.stringify({ count: local.length, galaxies: local }));
  await ctx.record('galaxies/local.json', join(out, 'local.json'), ['ungc', 'lvdb']);
  console.log(`  local volume: ${local.length} galaxies (${lvAdded} from LVDB)`);

  // ---- 2MRS ---------------------------------------------------------------------------
  const dip = galUnit(DIPOLE_L, DIPOLE_B);
  const mrs: Gal[] = [];
  for (const l of (await gunzip(await ensureFile('2mrs', 'table3.dat.gz'))).split('\n')) {
    if (l.length < 180) continue;
    const cz = Number(f(l, 174, 178));
    if (!Number.isFinite(cz) || cz <= 0) continue;
    const ra = Number(f(l, 18, 26));
    const dec = Number(f(l, 28, 36));
    const gl = Number(f(l, 38, 46));
    const gb = Number(f(l, 48, 56));
    const g = galUnit(gl, gb);
    const vcmb = cz + DIPOLE_V * (g[0] * dip[0] + g[1] * dip[1] + g[2] * dip[2]);
    if (vcmb < 800) continue; // the Local Volume catalog covers these better
    const z = vcmb / C_KMS;
    const d = dc(z);
    const u = unit(ra, dec);
    const rext = Number(f(l, 148, 152)); // log10 arcsec, semi-major
    const sizeKpc = Number.isFinite(rext) ? (2 * 10 ** rext * (Math.PI / 648000)) * (d / (1 + z)) * 1000 : 0;
    const tt = parseInt(f(l, 165, 169), 10);
    mrs.push({ xyz: [u[0] * d, u[1] * d, u[2] * d], size: sizeKpc, type: Number.isFinite(tt) ? tt : 99 });
  }
  await writeFile(join(out, '2mrs.bin'), pack(mrs));
  await ctx.record('galaxies/2mrs.bin', join(out, '2mrs.bin'), ['2mrs']);
  console.log(`  2MRS: ${mrs.length} galaxies`);

  // ---- SDSS DR17 --------------------------------------------------------------------
  const sdss: Gal[] = [];
  for (const [lo, hi] of [
    [0.02, 0.3],
    [0.3, 0.8],
  ]) {
    const rows = await sdssQuery(
      `SELECT ra, dec, z FROM SpecObj WHERE class='GALAXY' AND zWarning=0 AND z BETWEEN ${lo} AND ${hi} AND (fiberID % 4)=0`,
    );
    for (const r of rows) {
      const z = Number(r.z);
      const d = dc(z);
      const u = unit(Number(r.ra), Number(r.dec));
      sdss.push({ xyz: [u[0] * d, u[1] * d, u[2] * d], size: 0, type: 99 });
    }
  }
  await writeFile(join(out, 'sdss.bin'), pack(sdss));
  await ctx.record('galaxies/sdss.bin', join(out, 'sdss.bin'), ['sdss-dr17']);
  console.log(`  SDSS galaxies: ${sdss.length}`);

  const qso: Gal[] = [];
  for (const [lo, hi] of [
    [0.1, 2.0],
    [2.0, 5.5],
  ]) {
    const rows = await sdssQuery(`SELECT ra, dec, z FROM SpecObj WHERE class='QSO' AND zWarning=0 AND z BETWEEN ${lo} AND ${hi} AND (fiberID % 3)=0`);
    for (const r of rows) {
      const z = Number(r.z);
      const d = dc(z);
      const u = unit(Number(r.ra), Number(r.dec));
      qso.push({ xyz: [u[0] * d, u[1] * d, u[2] * d], size: 0, type: -9 });
    }
  }
  await writeFile(join(out, 'qso.bin'), pack(qso));
  await ctx.record('galaxies/qso.bin', join(out, 'qso.bin'), ['sdss-dr17']);
  console.log(`  SDSS quasars: ${qso.length}`);
}

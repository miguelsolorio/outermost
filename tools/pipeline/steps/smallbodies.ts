// Asteroids and trans-Neptunian objects from the JPL Small-Body Database
// (SBDB Query API, full precision osculating elements, heliocentric ecliptic
// J2000). Selection:
//   - numbered asteroids with H < 16 (main belt, Hildas, Trojans, ...)
//   - all numbered near-Earth objects
//   - all trans-Neptunian objects and Centaurs with an orbit condition code
//     of 5 or better (numbered or not)
// Mean anomalies are propagated to one common epoch; the app solves Kepler's
// equation per object on the GPU.
//
// smallbodies/elements.bin: "SMB1", uint32 count, float64 epoch (JD TDB),
//   then count × float32 [a (AU), e, i, Ω, ω, M0 (rad), n (rad/day), H],
//   then count × uint8 class code (index into CLASSES).
// smallbodies/names.json: named objects bright enough to label, with index.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchText } from '../../bake/util.ts';
import type { StepContext } from '../run.ts';

export const CLASSES = ['MBA', 'IMB', 'OMB', 'MCA', 'AMO', 'APO', 'ATE', 'IEO', 'TJN', 'CEN', 'TNO', 'PAA', 'HYA', 'AST'];
const DEG = Math.PI / 180;
const GAUSS_K = 0.01720209895; // rad/day, AU^1.5
const EPOCH = 2461200.5; // 2026-Jun-09 TDB (the SBDB's current standard epoch)

const API = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api';
const FIELDS = 'spkid,full_name,name,a,e,i,om,w,ma,epoch,H,class';

function query(params: Record<string, string>): string {
  const q = new URLSearchParams({ fields: FIELDS, 'full-prec': 'true', ...params });
  return `${API}?${q}`;
}

interface Row {
  spkid: number;
  full: string;
  name: string | null;
  a: number;
  e: number;
  i: number;
  om: number;
  w: number;
  ma: number;
  epoch: number;
  H: number;
  cls: string;
}

async function rows(url: string): Promise<Row[]> {
  const doc = JSON.parse(await fetchText(url)) as { fields: string[]; data: (string | number | null)[][] };
  const f = (k: string) => doc.fields.indexOf(k);
  const idx = Object.fromEntries(FIELDS.split(',').map((k) => [k, f(k)]));
  return doc.data.map((r) => ({
    spkid: Number(r[idx.spkid]),
    full: String(r[idx.full_name]).trim(),
    name: r[idx.name] ? String(r[idx.name]) : null,
    a: Number(r[idx.a]),
    e: Number(r[idx.e]),
    i: Number(r[idx.i]),
    om: Number(r[idx.om]),
    w: Number(r[idx.w]),
    ma: Number(r[idx.ma]),
    epoch: Number(r[idx.epoch]),
    H: r[idx.H] === null ? NaN : Number(r[idx.H]),
    cls: String(r[idx.class]),
  }));
}

/**
 * Osculating heliocentric ecliptic elements at `jdTdb` from JPL Horizons, for
 * the few objects whose SBDB solution has a different epoch (e.g. Bennu's
 * OSIRIS-REx orbit at 2011): propagating those two-body over years would drift.
 */
async function horizonsElements(spkid: number, jdTdb: number): Promise<Pick<Row, 'a' | 'e' | 'i' | 'om' | 'w' | 'ma' | 'epoch'> | null> {
  const params = {
    format: 'json',
    COMMAND: `'DES=${spkid};'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'ELEMENTS',
    CENTER: "'500@10'",
    TLIST: jdTdb.toFixed(6),
    TLIST_TYPE: 'JD',
    TIME_TYPE: 'TDB',
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'J2000',
    OUT_UNITS: 'AU-D',
    CSV_FORMAT: 'YES',
  };
  const url = `https://ssd.jpl.nasa.gov/api/horizons.api?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
  const json = JSON.parse(await fetchText(url)) as { result?: string };
  const m = json.result?.match(/\$\$SOE([\s\S]*?)\$\$EOE/);
  if (!m) return null;
  // JDTDB, Calendar, EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR
  const c = m[1].trim().split(',').map((x) => x.trim());
  return { e: Number(c[2]), i: Number(c[4]), om: Number(c[5]), w: Number(c[6]), ma: Number(c[9]), a: Number(c[11]), epoch: Number(c[0]) };
}

export async function processSmallBodies(ctx: StepContext): Promise<void> {
  const outDir = join(ctx.outDir, 'smallbodies');
  await mkdir(outDir, { recursive: true });
  const sets = await Promise.all([
    rows(query({ 'sb-kind': 'a', 'sb-ns': 'n', 'sb-cdata': JSON.stringify({ AND: ['H|LT|16'] }) })),
    rows(query({ 'sb-kind': 'a', 'sb-ns': 'n', 'sb-group': 'neo' })),
    rows(query({ 'sb-kind': 'a', 'sb-class': 'TNO,CEN,PAA,HYA', 'sb-cdata': JSON.stringify({ AND: ['condition_code|LE|5'] }) })),
  ]);
  const byId = new Map<number, Row>();
  for (const set of sets) for (const r of set) byId.set(r.spkid, r);
  for (const r of byId.values()) {
    if (Math.abs(r.epoch - EPOCH) < 300) continue;
    const h = await horizonsElements(r.spkid, EPOCH);
    if (h && Number.isFinite(h.a)) {
      Object.assign(r, h);
      console.log(`  ${r.full}: elements from Horizons at the common epoch`);
    } else {
      byId.delete(r.spkid);
      console.log(`  ${r.full}: dropped (epoch ${r.epoch}, no Horizons elements)`);
    }
  }
  // Bound elliptic orbits only (a few TNO-class objects are near-parabolic).
  const all = [...byId.values()].filter((r) => r.a > 0 && r.e < 0.98 && Number.isFinite(r.ma)).sort((p, q) => p.spkid - q.spkid);
  const n = all.length;
  const buf = Buffer.alloc(16 + n * 32 + n);
  buf.write('SMB1', 0, 'ascii');
  buf.writeUInt32LE(n, 4);
  buf.writeDoubleLE(EPOCH, 8);
  const counts: Record<string, number> = {};
  const names: Array<{ i: number; name: string; H: number; cls: string }> = [];
  all.forEach((r, k) => {
    const mm = GAUSS_K / Math.pow(r.a, 1.5);
    const M0 = (((r.ma * DEG + mm * (EPOCH - r.epoch)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const o = 16 + k * 32;
    [r.a, r.e, r.i * DEG, r.om * DEG, r.w * DEG, M0, mm, Number.isFinite(r.H) ? r.H : 20].forEach((v, j) => buf.writeFloatLE(v, o + j * 4));
    const c = CLASSES.indexOf(r.cls);
    buf.writeUInt8(c < 0 ? CLASSES.length - 1 : c, 16 + n * 32 + k);
    counts[r.cls] = (counts[r.cls] ?? 0) + 1;
    // Label candidates: named, and either bright or of a distinct population.
    if (r.name && (r.H < 8.5 || ['TNO', 'CEN', 'PAA', 'HYA'].includes(r.cls) || ['APO', 'ATE', 'AMO', 'IEO'].includes(r.cls))) {
      names.push({ i: k, name: r.full.replace(/\s*\([^)]*\)\s*$/, ''), H: r.H, cls: r.cls });
    }
  });
  const bin = join(outDir, 'elements.bin');
  await writeFile(bin, buf);
  await ctx.record('smallbodies/elements.bin', bin, ['jpl-sbdb'], { count: n, epochJD: EPOCH, classes: CLASSES });
  names.sort((p, q) => p.H - q.H);
  const namesPath = join(outDir, 'names.json');
  await writeFile(namesPath, JSON.stringify({ classes: CLASSES, names }));
  await ctx.record('smallbodies/names.json', namesPath, ['jpl-sbdb']);
  console.log(`  small bodies: ${n} objects`, counts, `${names.length} named label candidates`);
}

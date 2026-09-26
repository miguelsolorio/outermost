// Rotation models for Ceres and Vesta. Pole and period come from JPL SBDB
// (Dawn results); the prime-meridian angle W0 at J2000 is anchored to the IAU
// cartographic longitudes that JPL Horizons reports as sub-observer points.
// The same Horizons points at other epochs are kept as test fixtures.

import { join } from 'node:path';
import * as A from 'astronomy-engine';
import { readFile } from 'node:fs/promises';
import { fetchText, today, writeJson, ROOT } from './util.ts';
import { EPOCHS_JD_UT } from './horizons.ts';
import { registerTable, tableState, type StateTable } from '../../src/astro/tables.ts';
import { iauMatrix, bodyFixedLonLat } from '../../src/astro/orientation.ts';
import { C, DEG } from '../../src/astro/units.ts';
import { normalize, sub, length, type Vec3 } from '../../src/astro/vec.ts';

interface Spec {
  id: string;
  command: string;
  sbdb: string;
}
const SPECS: Spec[] = [
  { id: 'ceres', command: '1;', sbdb: '1' },
  { id: 'vesta', command: '4;', sbdb: '4' },
];

const msFromJd = (jd: number) => (jd - 2440587.5) * 86_400_000;

export async function bakeRotation(outPath: string, fixtureDir: string): Promise<void> {
  const out: Record<string, unknown> = {};
  const fixtures: Record<string, unknown> = {};
  for (const s of SPECS) {
    const sb = JSON.parse(await fetchText(`https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=${s.sbdb}&phys-par=1`));
    const par = Object.fromEntries((sb.phys_par as Array<{ name: string; value: string }>).map((p) => [p.name, p.value]));
    const [ra, dec] = String(par.pole).split('/').map(Number);
    const rate = (360 * 24) / Number(par.rot_per); // deg/day
    const extent = String(par.extent).split(' x ').map(Number);
    const q = {
      format: 'json', MAKE_EPHEM: 'YES', OBJ_DATA: 'NO', COMMAND: `'${s.command}'`, EPHEM_TYPE: 'OBSERVER', CENTER: "'500@399'",
      TLIST: EPOCHS_JD_UT.map((j) => j.toFixed(6)).join(' '), TLIST_TYPE: 'JD', TIME_TYPE: 'UT', QUANTITIES: "'14'", ANG_FORMAT: 'DEG', CSV_FORMAT: 'YES', EXTRA_PREC: 'YES',
    };
    const url = `https://ssd.jpl.nasa.gov/api/horizons.api?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
    const res = JSON.parse(await fetchText(url)) as { result: string };
    const footer = res.result.split('$$EOE')[1] ?? '';
    const west = /positive longitude is to the WEST|longitude is to the WEST/i.test(footer);
    const rows = (res.result.match(/\$\$SOE([\s\S]*?)\$\$EOE/)?.[1] ?? '')
      .trim()
      .split('\n')
      .map((l) => l.split(',').map((x) => x.trim()))
      .map((c, i) => ({ jd_ut: EPOCHS_JD_UT[i], lon: Number(c[3]), lat: Number(c[4]) }));
    const table = JSON.parse(await readFile(join(ROOT, 'data', 'baked', 'ephemerides', `${s.id}.json`), 'utf8')) as StateTable;
    registerTable(table);

    // Our sub-observer longitude with W0 = 0 at each epoch; W0 = ref − ours at J2000.
    const subLon = (jdUt: number, w0: number) => {
      const t = A.MakeTime(new Date(msFromJd(jdUt)));
      const earth = A.HelioVector(A.Body.Earth, t);
      const e: Vec3 = [earth.x * 1.495978707e11, earth.y * 1.495978707e11, earth.z * 1.495978707e11];
      let jd = t.tt + 2451545.0;
      let p: Vec3 = tableState(s.id, jd)!.pos.map((x) => x * 1e3) as Vec3;
      for (let k = 0; k < 3; k++) {
        const tau = length(sub(p, e)) / C;
        jd = t.tt + 2451545.0 - tau / 86_400;
        p = tableState(s.id, jd)!.pos.map((x) => x * 1e3) as Vec3;
      }
      const d = jd - 2451545.0;
      const m = iauMatrix(ra * DEG, dec * DEG, (w0 + rate * d) * DEG);
      return bodyFixedLonLat(m, normalize(sub(e, p)));
    };
    const refLonEast = (lon: number) => (west ? -lon : lon);
    // Rotating the body by W moves the sub-observer longitude by −W, so
    // W0 = (our longitude with W0 = 0) − (Horizons' longitude) at J2000.
    const j2000 = rows[0];
    const w0 = ((subLon(j2000.jd_ut, 0).lon - refLonEast(j2000.lon)) % 360 + 360) % 360;
    const worst = Math.max(...rows.map((r) => Math.abs(((subLon(r.jd_ut, w0).lon - refLonEast(r.lon) + 540) % 360) - 180)));
    console.log(`  rotation ${s.id}: worst sub-observer longitude error over 2000–2035 = ${worst.toFixed(3)}°`);
    out[s.id] = {
      pole_ra_deg: ra,
      pole_dec_deg: dec,
      w0_deg: w0,
      rate_deg_per_day: rate,
      radii_km: [extent[0] / 2, extent[1] / 2, extent[2] / 2],
      gm_km3_s2: Number(par.GM),
      sources: {
        pole_period_shape: `JPL SBDB (${sb.object.fullname})`,
        w0: 'Anchored to JPL Horizons IAU sub-observer longitude at J2000',
      },
    };
    fixtures[s.id] = { lonPositive: west ? 'west' : 'east', rows };
    console.log(`  rotation ${s.id}: pole ${ra}/${dec}, W0 ${w0.toFixed(3)}°, ${rate.toFixed(4)}°/d`);
  }
  await writeJson(outPath, { source: 'JPL SBDB + JPL Horizons', retrieved: today(), bodies: out });
  await writeJson(join(fixtureDir, 'dwarf-subpoints.json'), { source: 'JPL Horizons quantity 14 from Earth geocenter', retrieved: today(), bodies: fixtures });
}

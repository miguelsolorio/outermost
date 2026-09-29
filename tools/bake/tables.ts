// Bakes JPL Horizons state-vector tables for bodies astronomy-engine does not
// cover well: dwarf planets, Vesta, and spacecraft. Evaluated in the app with
// cubic Hermite interpolation (positions + velocities), which is accurate to
// well under a kilometer at these step sizes.

import { join } from 'node:path';
import { fetchText, today, writeJson } from './util.ts';

interface TableSpec {
  id: string;
  name: string;
  command: string;
  center: string; // Horizons center code
  start: string;
  stop: string;
  step: string;
}

export const TABLES: TableSpec[] = [
  // The Pluto–Charon barycenter moves smoothly; Pluto's own 6.4-day wobble
  // (~2,100 km) is added back in the app from Charon's orbit.
  { id: 'pluto-barycenter', name: 'Pluto system barycenter', command: '9', center: '500@10', start: '1900-01-01', stop: '2150-01-01', step: '20 d' },
  { id: 'ceres', name: 'Ceres', command: '1;', center: '500@10', start: '1950-01-01', stop: '2100-01-01', step: '5 d' },
  { id: 'vesta', name: 'Vesta', command: '4;', center: '500@10', start: '1950-01-01', stop: '2100-01-01', step: '5 d' },
  { id: 'eris', name: 'Eris', command: '136199;', center: '500@10', start: '1900-01-01', stop: '2150-01-01', step: '30 d' },
  { id: 'haumea', name: 'Haumea', command: '136108;', center: '500@10', start: '1900-01-01', stop: '2150-01-01', step: '30 d' },
  { id: 'makemake', name: 'Makemake', command: '136472;', center: '500@10', start: '1900-01-01', stop: '2150-01-01', step: '30 d' },
  // Spacecraft: from launch to the end of JPL's predicted trajectory (clamped).
  { id: 'voyager-1', name: 'Voyager 1', command: '-31', center: '500@10', start: '1977-09-06', stop: '2100-01-01', step: '5 d' },
  { id: 'voyager-2', name: 'Voyager 2', command: '-32', center: '500@10', start: '1977-08-21', stop: '2100-01-01', step: '5 d' },
  { id: 'new-horizons', name: 'New Horizons', command: '-98', center: '500@10', start: '2006-01-20', stop: '2100-01-01', step: '5 d' },
  { id: 'jwst', name: 'James Webb Space Telescope', command: '-170', center: '500@399', start: '2022-01-25', stop: '2030-01-01', step: '1 d' },
  // Cassini's last orbit and its plunge into Saturn, finely sampled for the
  // fast periapsis passes. The trajectory ends at entry; past it Horizons rides
  // the impact point around with the planet.
  { id: 'cassini', name: 'Cassini', command: '-82', center: '500@699', start: '2017-09-09 10:35', stop: '2017-09-15 10:35', step: '5 m' },
];

const CENTERS: Record<string, string> = { '500@10': 'sun', '500@399': 'earth', '500@699': 'saturn' };

async function horizonsVectors(spec: TableSpec, start: string, stop: string): Promise<string> {
  const q = {
    format: 'json',
    MAKE_EPHEM: 'YES',
    OBJ_DATA: 'NO',
    COMMAND: `'${spec.command}'`,
    EPHEM_TYPE: 'VECTORS',
    CENTER: `'${spec.center}'`,
    START_TIME: `'${start}'`,
    STOP_TIME: `'${stop}'`,
    STEP_SIZE: `'${spec.step}'`,
    TIME_TYPE: 'TDB',
    REF_PLANE: 'FRAME',
    REF_SYSTEM: 'ICRF',
    VEC_TABLE: '2',
    VEC_CORR: 'NONE',
    OUT_UNITS: 'KM-S',
    CSV_FORMAT: 'YES',
  };
  const url = `https://ssd.jpl.nasa.gov/api/horizons.api?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
  const res = JSON.parse(await fetchText(url)) as { result?: string; error?: string };
  return res.result ?? res.error ?? '';
}

/** Bake every table, or only those named. */
export async function bakeTables(dir: string, ids?: string[]): Promise<void> {
  for (const spec of TABLES.filter((t) => !ids?.length || ids.includes(t.id))) {
    let text = await horizonsVectors(spec, spec.start, spec.stop);
    // Spacecraft kernels end at some date: Horizons reports the available span; retry within it.
    const span = text.match(/(?:prior to|after) A\.D\. (\d{4}-[A-Z]{3}-\d{2})/i) ?? text.match(/No ephemeris for target .* (?:after|prior to) A\.D\. (\d{4}-[A-Z]{3}-\d{2})/i);
    if (!text.includes('$$SOE') && span) {
      const d = new Date(span[1].replace(/-/g, ' ') + ' UTC');
      const limit = new Date(d.getTime() - 86_400_000).toISOString().slice(0, 10);
      text = /prior to/i.test(span[0]) ? await horizonsVectors(spec, limit, spec.stop) : await horizonsVectors(spec, spec.start, limit);
    }
    const block = text.match(/\$\$SOE([\s\S]*?)\$\$EOE/)?.[1];
    if (!block) throw new Error(`Horizons table for ${spec.id} failed:\n${text.slice(0, 1500)}`);
    const rows = block
      .trim()
      .split('\n')
      .map((l) => l.split(',').map((x) => x.trim()))
      .filter((c) => c.length > 7);
    const jd0 = Number(rows[0][0]);
    const step = Number(rows[1][0]) - jd0;
    const data: number[] = [];
    for (const c of rows) for (let k = 2; k <= 7; k++) data.push(Number(Number(c[k]).toPrecision(12)));
    await writeJson(join(dir, `${spec.id}.json`), {
      id: spec.id,
      name: spec.name,
      source: 'JPL Horizons, geometric state vectors (ICRF, km, km/s), TDB',
      horizons_command: spec.command,
      center: CENTERS[spec.center] ?? spec.center,
      retrieved: today(),
      jd0_tdb: jd0,
      step_days: step,
      count: rows.length,
      data,
    });
    console.log(`  table ${spec.id}: ${rows.length} samples from JD ${jd0} every ${step} d`);
  }
}

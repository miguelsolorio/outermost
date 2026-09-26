// Horizons reference positions for a sample of asteroids and trans-Neptunian
// objects, to fact-check the small-body layer's two-body propagation of JPL
// SBDB elements (tests/factcheck/smallbodies.test.ts).

import { join } from 'node:path';
import { fetchText, today, writeJson } from './util.ts';

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

export const SAMPLE = [
  { number: 2, name: 'Pallas' },
  { number: 433, name: 'Eros' },
  { number: 624, name: 'Hektor' },
  { number: 101955, name: 'Bennu' },
  { number: 162173, name: 'Ryugu' },
  { number: 2060, name: 'Chiron' },
  { number: 50000, name: 'Quaoar' },
  { number: 90377, name: 'Sedna' },
  { number: 486958, name: 'Arrokoth' },
];

/** UT epochs within about a year of the SBDB element epoch (2026-06-09). */
export const EPOCHS = [2461041.5 /* 2026-01-01 */, 2461308.5 /* 2026-09-25 */, 2461557.5 /* 2027-06-01 */];

export async function bakeSmallBodyFixtures(dir: string): Promise<void> {
  const out: Record<string, Array<{ jd_ut: number; pos_km: number[] }>> = {};
  for (const b of SAMPLE) {
    const params = {
      format: 'json',
      COMMAND: `'${b.number};'`,
      OBJ_DATA: 'NO',
      MAKE_EPHEM: 'YES',
      EPHEM_TYPE: 'VECTORS',
      CENTER: "'500@10'",
      TLIST: EPOCHS.map((j) => j.toFixed(6)).join(' '),
      TLIST_TYPE: 'JD',
      TIME_TYPE: 'UT',
      REF_PLANE: 'FRAME',
      REF_SYSTEM: 'ICRF',
      VEC_TABLE: '1',
      VEC_CORR: 'NONE',
      OUT_UNITS: 'KM-S',
      CSV_FORMAT: 'YES',
    };
    const url = `${API}?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
    const json = JSON.parse(await fetchText(url)) as { result: string };
    const m = json.result.match(/\$\$SOE([\s\S]*?)\$\$EOE/);
    if (!m) throw new Error(`Horizons: no data for ${b.name}\n${json.result.slice(0, 800)}`);
    out[b.number] = m[1]
      .trim()
      .split('\n')
      .map((line) => {
        const c = line.split(',').map((s) => s.trim());
        return { jd_ut: Number(c[0]), pos_km: [Number(c[2]), Number(c[3]), Number(c[4])] };
      });
  }
  await writeJson(join(dir, 'smallbodies.json'), {
    source: 'JPL Horizons API, heliocentric (Sun center) geometric vectors, ICRF, km',
    retrieved: today(),
    bodies: SAMPLE,
    vectors: out,
  });
}

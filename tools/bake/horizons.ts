// Bakes JPL Horizons reference data used by the fact-check tests:
//  - heliocentric geometric state vectors (ICRF, km) for Sun-orbiting bodies
//  - geocentric vectors for the Moon
//  - apparent sub-observer and sub-solar planetodetic lon/lat seen from Earth's
//    geocenter (quantities 14 and 15), which pin down texture orientation.
// Horizons has no CORS headers, so this only ever runs at build time.
// API docs: https://ssd-api.jpl.nasa.gov/doc/horizons.html

import { join } from 'node:path';
import { fetchText, today, writeJson } from './util.ts';

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

/** Test epochs (UT). Spread over decades to catch drift in rotation models. */
export const EPOCHS_JD_UT = [
  2451545.0, // 2000-01-01 12:00
  2455362.75, // 2010-06-15 06:00
  2458928.5, // 2020-03-20 00:00
  2461308.5, // 2026-09-25 00:00
  2464643.25, // 2035-11-11 18:00
];

const PLANETS: Record<string, string> = {
  mercury: '199',
  venus: '299',
  earth: '399',
  mars: '499',
  jupiter: '599',
  saturn: '699',
  uranus: '799',
  neptune: '899',
  pluto: '999',
};

const ORIENTED: Record<string, string> = {
  sun: '10',
  moon: '301',
  mercury: '199',
  venus: '299',
  mars: '499',
  jupiter: '599',
  saturn: '699',
  uranus: '799',
  neptune: '899',
  pluto: '999',
};

function query(params: Record<string, string>): string {
  const q = Object.entries({ format: 'json', MAKE_EPHEM: 'YES', OBJ_DATA: 'NO', ...params })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${API}?${q}`;
}

async function horizons(params: Record<string, string>): Promise<string> {
  const text = await fetchText(query(params));
  const json = JSON.parse(text) as { result?: string; error?: string };
  if (json.error) throw new Error(`Horizons error: ${json.error}`);
  if (!json.result) throw new Error('Horizons: empty result');
  return json.result;
}

function between(result: string): string[] {
  const m = result.match(/\$\$SOE([\s\S]*?)\$\$EOE/);
  if (!m) throw new Error('Horizons: no $$SOE block\n' + result.slice(0, 2000));
  return m[1].trim().split('\n').map((l) => l.trim()).filter(Boolean);
}

const tlist = EPOCHS_JD_UT.map((j) => j.toFixed(6)).join(' ');

async function vectors(command: string, center: string) {
  const result = await horizons({
    COMMAND: `'${command}'`,
    EPHEM_TYPE: 'VECTORS',
    CENTER: `'${center}'`,
    TLIST: tlist,
    TLIST_TYPE: 'JD',
    TIME_TYPE: 'UT',
    REF_PLANE: 'FRAME',
    REF_SYSTEM: 'ICRF',
    VEC_TABLE: '2',
    VEC_CORR: 'NONE',
    OUT_UNITS: 'KM-S',
    CSV_FORMAT: 'YES',
  });
  // CSV: JDUT, Calendar, X, Y, Z, VX, VY, VZ,
  return between(result).map((line) => {
    const c = line.split(',').map((s) => s.trim());
    return {
      jd_ut: Number(c[0]),
      calendar: c[1],
      pos_km: [Number(c[2]), Number(c[3]), Number(c[4])],
      vel_km_s: [Number(c[5]), Number(c[6]), Number(c[7])],
    };
  });
}

async function subPoints(command: string, center = '500@399') {
  const result = await horizons({
    COMMAND: `'${command}'`,
    EPHEM_TYPE: 'OBSERVER',
    CENTER: `'${center}'`,
    TLIST: tlist,
    TLIST_TYPE: 'JD',
    TIME_TYPE: 'UT',
    QUANTITIES: "'14,15'",
    ANG_FORMAT: 'DEG',
    CSV_FORMAT: 'YES',
    EXTRA_PREC: 'YES',
  });
  // The footer states whether longitude is positive east or west for this target.
  const footer = result.split('$$EOE')[1] ?? '';
  const lonLine = footer.split('\n').find((l) => /longitude/i.test(l) && /(east|west)/i.test(l)) ?? '';
  const positive = /positive to the east|east-positive|\(E\)|EAST/i.test(lonLine) ? 'east' : /west/i.test(lonLine) ? 'west' : 'unknown';
  const rows = between(result).map((line) => {
    const c = line.split(',').map((s) => s.trim());
    // Date, (solar-presence flag), (lunar-presence flag), ObsSub-LON, ObsSub-LAT, SunSub-LON, SunSub-LAT,
    return { calendar: c[0], obsLon: Number(c[3]), obsLat: Number(c[4]), sunLon: Number(c[5]), sunLat: Number(c[6]) };
  });
  return { lonPositive: positive, lonNote: lonLine.trim(), rows };
}

export async function bakeHorizonsFixtures(dir: string): Promise<void> {
  const meta = {
    source: 'JPL Horizons System, Solar System Dynamics Group, NASA/JPL-Caltech',
    url: 'https://ssd.jpl.nasa.gov/horizons/',
    license: 'Public domain (U.S. Government work)',
    retrieved: today(),
    epochs_jd_ut: EPOCHS_JD_UT,
  };

  const helio: Record<string, unknown> = {};
  for (const [name, id] of Object.entries(PLANETS)) {
    helio[name] = await vectors(id, '500@10');
    console.log(`  horizons vectors ${name}`);
  }
  const moonGeo = await vectors('301', '500@399');
  await writeJson(join(dir, 'vectors.json'), { ...meta, frame: 'ICRF, geometric, km', heliocentric: helio, moon_geocentric: moonGeo });

  const sub: Record<string, unknown> = {};
  for (const [name, id] of Object.entries(ORIENTED)) {
    sub[name] = await subPoints(id);
    console.log(`  horizons sub-points ${name}`);
  }
  // Earth seen from the Sun's center: the sub-observer point is the subsolar point.
  const earthFromSun = await subPoints('399', '500@10');
  console.log('  horizons subsolar earth');
  await writeJson(join(dir, 'earth-subsolar.json'), { ...meta, observer: 'Sun center (500@10)', quantities: '14 (Obs sub-lon/lat = subsolar point)', earth: earthFromSun });
  await writeJson(join(dir, 'subpoints.json'), { ...meta, observer: 'Earth geocenter (500@399)', quantities: '14 (Obs sub-lon/lat), 15 (Sun sub-lon/lat)', bodies: sub });
}

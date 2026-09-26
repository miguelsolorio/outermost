// Runs build-time data bakers. Output is committed under data/baked/ so the
// app and the fact-check tests never need network access.
//   node tools/bake/run.ts            # all
//   node tools/bake/run.ts nssdca     # one

import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ROOT } from './util.ts';
import { bakeNssdca } from './nssdca.ts';
import { bakeHorizonsFixtures } from './horizons.ts';
import { bakeRings } from './rings.ts';
import { bakeSimbad } from './simbad.ts';
import { bakeSatellites } from './satellites.ts';
import { bakeTables } from './tables.ts';
import { bakeRotation } from './rotation.ts';
import { bakeSmallBodyFixtures } from './smallbodies.ts';
import { bakeTle } from './tle.ts';

const OUT = join(ROOT, 'data', 'baked');

const BAKERS: Record<string, () => Promise<void>> = {
  nssdca: () => bakeNssdca(join(OUT, 'nssdca.json')),
  horizons: () => bakeHorizonsFixtures(join(ROOT, 'tests', 'fixtures', 'horizons')),
  rings: () => bakeRings(join(OUT, 'saturn-rings-pps.json')),
  simbad: () => bakeSimbad(join(ROOT, 'tests', 'fixtures', 'simbad-stars.json')),
  tables: () => bakeTables(join(OUT, 'ephemerides')),
  rotation: () => bakeRotation(join(OUT, 'dwarf-rotation.json'), join(ROOT, 'tests', 'fixtures', 'horizons')),
  tle: () => bakeTle(join(OUT, 'iss-tle.json')),
  smallbodies: () => bakeSmallBodyFixtures(join(ROOT, 'tests', 'fixtures', 'horizons')),
  satellites: () => bakeSatellites(join(OUT, 'satellites.json'), join(ROOT, 'tests', 'fixtures', 'horizons')),
};

const wanted = process.argv.slice(2);
await mkdir(OUT, { recursive: true });
for (const [name, fn] of Object.entries(BAKERS)) {
  if (wanted.length && !wanted.includes(name)) continue;
  console.log(`bake: ${name}`);
  await fn();
}

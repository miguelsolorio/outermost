// A recent two-line element set for the ISS from CelesTrak, used when the app
// can't fetch a fresh one at runtime (SGP4 accuracy degrades by ~km per day).

import { fetchText, today, writeJson } from './util.ts';

export async function bakeTle(path: string): Promise<void> {
  const text = await fetchText('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE', { cache: false });
  const [name, line1, line2] = text.trim().split('\n').map((l) => l.trim());
  if (!line1?.startsWith('1 25544') || !line2?.startsWith('2 25544')) throw new Error(`unexpected TLE: ${text}`);
  await writeJson(path, { name, line1, line2, source: 'celestrak', retrieved: today() });
}

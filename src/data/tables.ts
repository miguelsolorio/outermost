// Loads the JPL Horizons state tables (data/baked/ephemerides/*.json) after
// startup. Bodies using them fall back or stay hidden until they arrive.

import { registerTable, type StateTable } from '../astro/tables.ts';

const urls = import.meta.glob('../../data/baked/ephemerides/*.json', { query: '?url', import: 'default' }) as Record<
  string,
  () => Promise<string>
>;

export async function loadEphemerisTables(): Promise<string[]> {
  const ids: string[] = [];
  await Promise.all(
    Object.values(urls).map(async (getUrl) => {
      const res = await fetch(await getUrl());
      if (!res.ok) return;
      const t = (await res.json()) as StateTable;
      registerTable(t);
      ids.push(t.id);
    }),
  );
  return ids;
}

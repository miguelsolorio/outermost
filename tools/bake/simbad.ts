// Bakes independent reference values from SIMBAD (CDS) for fact-checking the
// star catalog: ICRS positions, parallaxes and V magnitudes of the brightest
// stars and the nearest star systems. SIMBAD's TAP service is queried at build
// time only.

import { fetchText, today, writeJson } from './util.ts';

const TAP = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';

/** Brightest naked-eye stars (V < ~2) plus the nearest systems, by Hipparcos number. */
export const BRIGHT_HIP = [
  32349, 30438, 71683, 69673, 91262, 24608, 24436, 37279, 27989, 7588, 68702, 97649, 60718, 21421, 65474, 80763, 37826,
  113368, 62434, 102098, 49669, 33579, 61084, 85927, 26311, 26727, 25336, 25428, 45238, 109268, 15863, 34444, 39953,
  54061, 82273, 67301, 41037, 31681, 86228, 100751, 11767, 3179, 677, 57632, 46390, 5447, 9884, 14576, 36850,
];
export const NEAR_HIP = [70890, 71681, 87937, 54035, 32349, 16537, 114046, 57548, 36208, 104214, 108870, 8102, 37279, 1475];

function csv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split('\n');
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

async function query(adql: string): Promise<Array<Record<string, string>>> {
  const url = `${TAP}?request=doQuery&lang=adql&format=csv&query=${encodeURIComponent(adql)}`;
  const text = await fetchText(url);
  if (text.includes('QUERY_STATUS" value="ERROR')) throw new Error(`SIMBAD error: ${text.slice(0, 500)}`);
  return csv(text);
}

export async function bakeSimbad(outPath: string): Promise<void> {
  const ids = [...new Set([...BRIGHT_HIP, ...NEAR_HIP])].map((h) => `'HIP ${h}'`).join(',');
  const rows = await query(
    `SELECT i.id, b.main_id, b.ra, b.dec, b.plx_value, b.plx_err, b.plx_bibcode, f.V ` +
      `FROM ident AS i JOIN basic AS b ON b.oid = i.oidref LEFT JOIN allfluxes AS f ON f.oidref = b.oid ` +
      `WHERE i.id IN (${ids})`,
  );
  const stars = rows.map((r) => ({
    hip: Number(r.id.replace('HIP ', '')),
    main_id: r.main_id,
    ra_deg: Number(r.ra),
    dec_deg: Number(r.dec),
    plx_mas: r.plx_value ? Number(r.plx_value) : null,
    plx_err_mas: r.plx_err ? Number(r.plx_err) : null,
    plx_bibcode: r.plx_bibcode || null,
    V: r.V ? Number(r.V) : null,
    near: NEAR_HIP.includes(Number(r.id.replace('HIP ', ''))),
  }));
  stars.sort((a, b) => a.hip - b.hip);
  await writeJson(outPath, {
    source: 'SIMBAD astronomical database, CDS Strasbourg (Wenger et al. 2000)',
    url: 'https://simbad.cds.unistra.fr/simbad/',
    retrieved: today(),
    note: 'Positions ICRS epoch J2000; parallaxes mostly Gaia DR3 (2020yCat.1350....0G) or Hipparcos 2007.',
    stars,
  });
  console.log(`  simbad: ${stars.length} stars`);
}

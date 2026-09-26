// Bakes NASA NSSDCA planetary fact sheets into data/baked/nssdca.json.
// Source: https://nssdc.gsfc.nasa.gov/planetary/factsheet/ (NASA, public domain).
// Values are copied verbatim with their original labels and units, then
// normalized to SI in a separate `si` block so tests can cite either.

import { writeFile } from 'node:fs/promises';
import { fetchText, stripHtml, today } from './util.ts';

const BASE = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/';
const SHEETS: Record<string, string> = {
  sun: 'sunfact.html',
  mercury: 'mercuryfact.html',
  venus: 'venusfact.html',
  earth: 'earthfact.html',
  moon: 'moonfact.html',
  mars: 'marsfact.html',
  jupiter: 'jupiterfact.html',
  saturn: 'saturnfact.html',
  uranus: 'uranusfact.html',
  neptune: 'neptunefact.html',
  pluto: 'plutofact.html',
};

// NSSDCA label (after HTML stripping, superscripts flattened) -> [key, multiplier to SI]
const LABELS: Array<[RegExp, string, number]> = [
  [/^Mass \(1024 kg\)/, 'mass_kg', 1e24],
  [/^Mass \(1030 kg\)/, 'mass_kg', 1e30],
  [/^Equatorial radius (?:\(1 bar level\) )?\(km\)/, 'radius_equatorial_m', 1e3],
  [/^Polar radius (?:\(1 bar level\) )?\(km\)/, 'radius_polar_m', 1e3],
  [/^Ellipticity \(Flattening\)/, 'flattening', 1],
  [/^Volumetric mean radius \(km\)/, 'radius_mean_m', 1e3],
  [/^Mean density \(kg\/m3\)/, 'density_kg_m3', 1],
  [/^(?:Surface gravity|Gravity)(?: \((?:mean|eq\.|mean, 1 bar)\))? \(m\/s2\)/i, 'surface_gravity_m_s2', 1],
  [/^Escape velocity \(km\/s\)/, 'escape_velocity_m_s', 1e3],
  [/^GM \(x 106 km3\/s2\)/, 'gm_m3_s2', 1e6 * 1e9],
  [/^Bond albedo/, 'bond_albedo', 1],
  [/^Geometric albedo/, 'geometric_albedo', 1],
  [/^V-band magnitude V\(1,0\)/, 'v10_mag', 1],
  [/^Black-body temperature \(K\)/, 'blackbody_temperature_k', 1],
  [/^Number of natural satellites/, 'natural_satellites', 1],
  [/^Semimajor axis \(106 km\)/, 'semimajor_axis_m', 1e9],
  [/^Semimajor axis \(km\)/, 'semimajor_axis_m', 1e3],
  [/^Sidereal orbit period \(days\)/, 'sidereal_orbit_period_days', 1],
  [/^Perihelion \(106 km\)/, 'perihelion_m', 1e9],
  [/^Aphelion \(106 km\)/, 'aphelion_m', 1e9],
  [/^Perigee \(106 km\)/, 'perigee_m', 1e9],
  [/^Apogee \(106 km\)/, 'apogee_m', 1e9],
  [/^Mean orbital velocity \(km\/s\)/, 'mean_orbital_velocity_m_s', 1e3],
  [/^Orbit inclination \(deg\)/, 'orbit_inclination_deg', 1],
  [/^Orbit eccentricity/, 'orbit_eccentricity', 1],
  [/^Sidereal rotation period \(hrs\)/, 'sidereal_rotation_period_hours', 1],
  [/^Length of day \(hrs\)/, 'length_of_day_hours', 1],
  [/^Obliquity to orbit \(deg\)/, 'obliquity_deg', 1],
  [/^Luminosity \(1024 J\/s\)/, 'luminosity_w', 1e24],
  [/^Visual magnitude V\(1,0\)/, 'apparent_v_mag', 1],
  [/^Effective temperature \(K\)/, 'effective_temperature_k', 1],
  [/^Spectral type/, 'spectral_type', 1],
  [/^Absolute magnitude/, 'absolute_v_mag', 1],
];

interface SheetOut {
  url: string;
  lastUpdated: string | null;
  raw: Record<string, string>;
  si: Record<string, number | string>;
}

/** Label/value pairs: HTML table rows (most sheets) or preformatted lines (Earth). */
function pairs(html: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((c) =>
      stripHtml(c).replace(/\s+/g, ' ').trim(),
    );
    if (cells.length >= 2 && cells[0] && cells[1]) out.push([cells[0], cells[1]]);
  }
  for (const line of stripHtml(html).split('\n')) {
    const m = line.match(/^\s*(.+?)\s{2,}([-+]?[\d,]*\.?\d+(?:[eE][-+]?\d+)?\.?|[A-Z][0-9.]*\s?[IV]*)\s*$/);
    if (m) out.push([m[1], m[2]]);
  }
  return out;
}

function parseSheet(html: string): Omit<SheetOut, 'url'> {
  const text = stripHtml(html);
  const raw: Record<string, string> = {};
  const si: Record<string, number | string> = {};
  for (const [rawLabel, rawValue] of pairs(html)) {
    const label = rawLabel.trim().replace(/\s+/g, ' ');
    const value = rawValue.trim().replace(/\*+$/, '').replace(/\.$/, '');
    for (const [re, key, mult] of LABELS) {
      if (!re.test(label) || key in si) continue;
      raw[label] = value;
      if (key === 'spectral_type') si[key] = value;
      else {
        const n = Number(value.replace(/,/g, ''));
        if (Number.isFinite(n)) si[key] = n * mult;
      }
    }
  }
  const upd = text.match(/Last Updated:\s*([^,\n]+)/);
  return { raw, si, lastUpdated: upd ? upd[1].trim() : null };
}

export async function bakeNssdca(outPath: string): Promise<void> {
  const out: Record<string, SheetOut> = {};
  for (const [id, page] of Object.entries(SHEETS)) {
    const url = BASE + page;
    out[id] = { url, ...parseSheet(await fetchText(url)) };
    // Satellite tables share the page; only the Sun sheet's visual magnitude is the body's own.
    if (id !== 'sun') delete out[id].si.apparent_v_mag;
    console.log(`  nssdca ${id}: ${Object.keys(out[id].si).length} values`);
  }
  const doc = {
    source: 'NASA NSSDCA Planetary Fact Sheets, D. R. Williams, NASA GSFC',
    license: 'Public domain (U.S. Government work)',
    retrieved: today(),
    bodies: out,
  };
  await writeFile(outPath, JSON.stringify(doc, null, 2) + '\n');
}

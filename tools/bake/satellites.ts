// Bakes mean orbital elements and physical parameters for major moons from
// JPL Solar System Dynamics (public domain):
//   https://ssd.jpl.nasa.gov/sats/elem/     (mean elements, epoch 2000-01-01.5 TDB)
//   https://ssd.jpl.nasa.gov/sats/phys_par/ (GM, mean radius)
// plus Horizons reference vectors (planet-centered, ICRF) for the fact-check tests.

import { join } from 'node:path';
import { fetchText, stripHtml, today, writeJson } from './util.ts';
import { EPOCHS_JD_UT } from './horizons.ts';

/** NAIF id -> our body id. The Galilean moons come from astronomy-engine instead. */
export const MOONS: Record<string, string> = {
  '401': 'phobos',
  '402': 'deimos',
  '601': 'mimas',
  '602': 'enceladus',
  '603': 'tethys',
  '604': 'dione',
  '605': 'rhea',
  '606': 'titan',
  '608': 'iapetus',
  '701': 'ariel',
  '702': 'umbriel',
  '703': 'titania',
  '704': 'oberon',
  '705': 'miranda',
  '801': 'triton',
  '901': 'charon',
};
const GALILEAN: Record<string, string> = { '501': 'io', '502': 'europa', '503': 'ganymede', '504': 'callisto' };

function rows(html: string): string[][] {
  return (html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []).map((r) =>
    (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((c) => stripHtml(c).replace(/\s+/g, ' ').trim()),
  );
}

const num = (s: string) => (s === '' || s === '-' ? null : Number(s));

export async function bakeSatellites(outPath: string, fixtureDir: string): Promise<void> {
  const elemHtml = await fetchText('https://ssd.jpl.nasa.gov/sats/elem/');
  const physHtml = await fetchText('https://ssd.jpl.nasa.gov/sats/phys_par/');
  const elems: Record<string, unknown> = {};
  for (const c of rows(elemHtml)) {
    const code = c[3];
    const id = MOONS[code];
    if (!id || elems[id]) continue;
    elems[id] = {
      naif: Number(code),
      planet: c[1].toLowerCase(),
      name: c[2],
      ephemeris: c[4],
      frame: c[5],
      epoch: c[6],
      a_km: num(c[7]),
      e: num(c[8]),
      w_deg: num(c[9]),
      M_deg: num(c[10]),
      i_deg: num(c[11]),
      node_deg: num(c[12]),
      P_days: num(c[13]),
      Papsis_yr: num(c[14]),
      Pnode_yr: num(c[15]),
      laplace_ra_deg: num(c[16]),
      laplace_dec_deg: num(c[17]),
    };
  }
  const phys: Record<string, unknown> = {};
  for (const c of rows(physHtml)) {
    const code = c[2];
    const id = MOONS[code] ?? GALILEAN[code];
    if (!id || phys[id]) continue;
    phys[id] = {
      naif: Number(code),
      name: c[1],
      gm_km3_s2: Number(c[3].split(' ')[0]),
      radius_km: Number(c[4].split(' ')[0]),
      density_g_cm3: Number(c[5].split(' ')[0]),
    };
  }
  // Refit mean elements to Horizons over 1995–2045 so rates are precise enough
  // for decades of propagation (the published table is rounded).
  const fits: Record<string, unknown> = {};
  const gmPlanet: Record<string, number> = { mars: 42828.37, jupiter: 126686531.9, saturn: 37931206.23, uranus: 5793951.3, neptune: 6835099.97, pluto: 869.6 };
  for (const [code, id] of Object.entries(MOONS)) {
    const el = elems[id] as { planet: string; frame: string; laplace_ra_deg: number | null; laplace_dec_deg: number | null; P_days: number; e: number; i_deg: number };
    const center = { mars: '499', saturn: '699', uranus: '799', neptune: '899', pluto: '999' }[el.planet as 'mars'];
    const q = {
      format: 'json', MAKE_EPHEM: 'YES', OBJ_DATA: 'NO', COMMAND: `'${code}'`, EPHEM_TYPE: 'VECTORS', CENTER: `'500@${center}'`,
      START_TIME: "'1995-01-01'", STOP_TIME: "'2045-01-01'", STEP_SIZE: "'2 d'", TIME_TYPE: 'TDB',
      REF_PLANE: 'FRAME', REF_SYSTEM: 'ICRF', VEC_TABLE: '2', VEC_CORR: 'NONE', OUT_UNITS: 'KM-S', CSV_FORMAT: 'YES',
    };
    const url = `https://ssd.jpl.nasa.gov/api/horizons.api?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
    const res = JSON.parse(await fetchText(url)) as { result: string };
    const samples = (res.result.match(/\$\$SOE([\s\S]*?)\$\$EOE/)?.[1] ?? '')
      .trim()
      .split('\n')
      .map((l) => l.split(',').map((x) => x.trim()))
      .filter((c) => c.length > 7)
      .map((c) => ({ jd: Number(c[0]), r: [Number(c[2]), Number(c[3]), Number(c[4])], v: [Number(c[5]), Number(c[6]), Number(c[7])] }));
    const gm = gmPlanet[el.planet] + ((phys[id] as { gm_km3_s2: number })?.gm_km3_s2 ?? 0);
    fits[id] = fitMeanElements(samples, el, gm);
    console.log(`  refit ${id}: ${samples.length} samples`);
  }

  await writeJson(outPath, {
    fits,
    source: 'JPL Solar System Dynamics: Planetary Satellite Mean Elements and Physical Parameters',
    urls: ['https://ssd.jpl.nasa.gov/sats/elem/', 'https://ssd.jpl.nasa.gov/sats/phys_par/'],
    license: 'Public domain (U.S. Government work)',
    retrieved: today(),
    elements: elems,
    physical: phys,
  });
  console.log(`  satellites: ${Object.keys(elems).length} element sets, ${Object.keys(phys).length} physical`);

  // Horizons reference: moon positions relative to their planet's center.
  const planetCenter: Record<string, string> = { mars: '499', jupiter: '599', saturn: '699', uranus: '799', neptune: '899', pluto: '999' };
  const refs: Record<string, unknown> = {};
  const all = { ...Object.fromEntries(Object.entries(MOONS)), ...GALILEAN };
  for (const [code, id] of Object.entries(all)) {
    const planet = code.startsWith('4') ? 'mars' : code.startsWith('5') ? 'jupiter' : code.startsWith('6') ? 'saturn' : code.startsWith('7') ? 'uranus' : code.startsWith('8') ? 'neptune' : 'pluto';
    const q = {
      format: 'json',
      MAKE_EPHEM: 'YES',
      OBJ_DATA: 'NO',
      COMMAND: `'${code}'`,
      EPHEM_TYPE: 'VECTORS',
      CENTER: `'500@${planetCenter[planet]}'`,
      TLIST: EPOCHS_JD_UT.map((j) => j.toFixed(6)).join(' '),
      TLIST_TYPE: 'JD',
      TIME_TYPE: 'UT',
      REF_PLANE: 'FRAME',
      REF_SYSTEM: 'ICRF',
      VEC_TABLE: '2',
      VEC_CORR: 'NONE',
      OUT_UNITS: 'KM-S',
      CSV_FORMAT: 'YES',
    };
    const url = `https://ssd.jpl.nasa.gov/api/horizons.api?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
    const res = JSON.parse(await fetchText(url)) as { result: string };
    const block = res.result.match(/\$\$SOE([\s\S]*?)\$\$EOE/)?.[1] ?? '';
    refs[id] = block
      .trim()
      .split('\n')
      .map((l) => l.split(',').map((x) => x.trim()))
      .filter((c) => c.length > 7)
      .map((c) => ({ jd_ut: Number(c[0]), pos_km: [Number(c[2]), Number(c[3]), Number(c[4])], vel_km_s: [Number(c[5]), Number(c[6]), Number(c[7])] }));
    console.log(`  horizons moon ${id}`);
  }
  await writeJson(join(fixtureDir, 'moons.json'), {
    source: 'JPL Horizons, planet-centered geometric ICRF vectors',
    retrieved: today(),
    epochs_jd_ut: EPOCHS_JD_UT,
    moons: refs,
  });
}

// ---- mean-element fitting ---------------------------------------------------

type V3 = [number, number, number];
const cross3 = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: number[]): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

function linfit(t: number[], y: number[], quad = false): number[] {
  // Least squares for y = c0 + c1 t (+ c2 t²).
  const k = quad ? 3 : 2;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let i = 0; i < t.length; i++) {
    const row = quad ? [1, t[i], t[i] * t[i]] : [1, t[i]];
    for (let r = 0; r < k; r++) {
      b[r] += row[r] * y[i];
      for (let c = 0; c < k; c++) A[r][c] += row[r] * row[c];
    }
  }
  // Gaussian elimination.
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const f = A[j][i] / A[i][i];
      for (let c = i; c < k; c++) A[j][c] -= f * A[i][c];
      b[j] -= f * b[i];
    }
  }
  const x = new Array(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < k; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}

function unwrap(angles: number[], rateGuess: number, t: number[]): number[] {
  const out = [angles[0]];
  for (let i = 1; i < angles.length; i++) {
    const pred = out[i - 1] + rateGuess * (t[i] - t[i - 1]);
    const k = Math.round((pred - angles[i]) / (2 * Math.PI));
    out.push(angles[i] + 2 * Math.PI * k);
  }
  return out;
}

/**
 * Fit a, e, i (means) and linear rates for the node Ω, longitude of periapsis
 * ϖ and mean longitude λ (quadratic for secularly accelerating Phobos) from
 * osculating elements computed in the moon's reference plane.
 */
function fitMeanElements(
  samples: Array<{ jd: number; r: number[]; v: number[] }>,
  el: { frame: string; laplace_ra_deg: number | null; laplace_dec_deg: number | null; P_days: number },
  gm: number,
) {
  const DEG = Math.PI / 180;
  let pole: V3;
  if (el.frame === 'Laplace' && el.laplace_ra_deg !== null && el.laplace_dec_deg !== null) {
    const ra = el.laplace_ra_deg * DEG;
    const dec = el.laplace_dec_deg * DEG;
    pole = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  } else {
    // Mean orbit normal over the window (planet equator for these moons).
    const h = samples.reduce((acc, s) => {
      const c = cross3(s.r, s.v);
      return [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]] as V3;
    }, [0, 0, 0] as V3);
    pole = norm3(h);
  }
  // Make the motion prograde in the fit frame (Triton orbits retrograde).
  const hSum = samples.reduce((acc, s) => {
    const c = cross3(s.r, s.v);
    return [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]] as V3;
  }, [0, 0, 0] as V3);
  if (dot3(hSum, pole) < 0) pole = [-pole[0], -pole[1], -pole[2]];
  const x = norm3(cross3([0, 0, 1], pole));
  const y = cross3(pole, x);
  const toPlane = (v: number[]): V3 => [dot3(v, x), dot3(v, y), dot3(v, pole)];
  const t0 = samples[Math.floor(samples.length / 2)].jd;
  const ts: number[] = [];
  const as: number[] = [];
  const es: number[] = [];
  const is: number[] = [];
  const nodes: number[] = [];
  const varpis: number[] = [];
  const lambdas: number[] = [];
  const eVecs: Array<[number, number]> = [];
  for (const s of samples) {
    const r = toPlane(s.r);
    const v = toPlane(s.v);
    const rl = Math.hypot(...r);
    const h = cross3(r, v);
    const hl = Math.hypot(...h);
    const n = [-h[1], h[0], 0];
    const nl = Math.hypot(n[0], n[1]);
    const ev = cross3(v, h).map((c, k) => c / gm - r[k] / rl);
    const e = Math.hypot(...ev);
    const a = 1 / (2 / rl - dot3(v, v) / gm);
    const inc = Math.acos(h[2] / hl);
    const node = nl > 1e-12 ? Math.atan2(n[1], n[0]) : 0;
    // Longitude of periapsis and mean longitude, measured in the plane.
    const varpi = Math.atan2(ev[1], ev[0]) + (h[2] < 0 ? Math.PI : 0);
    const cosE = (1 - rl / a) / Math.max(e, 1e-12);
    const sinE = dot3(r, v) / (e * Math.sqrt(gm * a) || 1);
    const E = Math.atan2(sinE, cosE);
    const M = E - e * Math.sin(E);
    const trueLon = Math.atan2(r[1], r[0]);
    const lambda = e > 1e-4 ? varpi + M : trueLon;
    ts.push(s.jd - t0);
    as.push(a);
    es.push(e);
    is.push(inc);
    nodes.push(node);
    varpis.push(varpi);
    lambdas.push(lambda);
    eVecs.push([e * Math.cos(varpi), e * Math.sin(varpi)]);
  }
  const mean = (a: number[]) => a.reduce((p, c) => p + c, 0) / a.length;
  const n0 = (2 * Math.PI) / el.P_days;
  const lam = unwrap(lambdas, n0, ts);
  const quad = el.P_days < 0.5; // Phobos: tidal secular acceleration
  const lamFit = linfit(ts, lam, quad);
  // Resonant libration in mean longitude: Mimas–Tethys (period ≈ 70.8 yr,
  // amplitude ≈ 44°; e.g. Vienne & Duriez 1995). Fit its sine/cosine terms.
  let libC = 0;
  let libS = 0;
  let libW = 0;
  if (Math.abs(n0 - (2 * Math.PI) / 0.942422) < 1e-3) {
    // Joint fit: λ = c0 + c1 t + S sin(ωt) + C cos(ωt), scanning the libration
    // period around the published ~70.8 yr to find the best fit.
    let best = Infinity;
    for (let years = 60; years <= 82; years += 0.2) {
      const w = (2 * Math.PI) / (years * 365.25);
      const A = Array.from({ length: 4 }, () => new Array(4).fill(0));
      const bb = new Array(4).fill(0);
      for (let k = 0; k < ts.length; k++) {
        const row = [1, ts[k], Math.sin(w * ts[k]), Math.cos(w * ts[k])];
        for (let r = 0; r < 4; r++) {
          bb[r] += row[r] * lam[k];
          for (let c = 0; c < 4; c++) A[r][c] += row[r] * row[c];
        }
      }
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
        const f = A[j][i] / A[i][i];
        for (let c = i; c < 4; c++) A[j][c] -= f * A[i][c];
        bb[j] -= f * bb[i];
      }
      const xs = new Array(4).fill(0);
      for (let i = 3; i >= 0; i--) {
        let sum = bb[i];
        for (let c = i + 1; c < 4; c++) sum -= A[i][c] * xs[c];
        xs[i] = sum / A[i][i];
      }
      let err = 0;
      for (let k = 0; k < ts.length; k++) {
        const m = xs[0] + xs[1] * ts[k] + xs[2] * Math.sin(w * ts[k]) + xs[3] * Math.cos(w * ts[k]);
        err += (lam[k] - m) ** 2;
      }
      if (err < best) {
        best = err;
        lamFit[0] = xs[0];
        lamFit[1] = xs[1];
        libS = xs[2];
        libC = xs[3];
        libW = w;
      }
    }
  }
  // Precession rates from slowly varying angles (unwrap with no rate guess).
  const nodeFit = linfit(ts, unwrap(nodes, 0, ts));
  const varpiFit = linfit(ts, unwrap(varpis, 0, ts));
  // Mean eccentricity from the averaged eccentricity vector in a frame
  // rotating with the fitted apsidal precession (removes short-period noise).
  let ec = 0;
  for (let k = 0; k < ts.length; k++) {
    const w = varpiFit[0] + varpiFit[1] * ts[k];
    ec += eVecs[k][0] * Math.cos(w) + eVecs[k][1] * Math.sin(w);
  }
  ec /= ts.length;
  return {
    epoch_jd_tdb: t0,
    pole_icrf: pole,
    a_km: mean(as),
    e: Math.max(0, ec),
    i_rad: mean(is),
    node_rad: nodeFit[0],
    node_rate: nodeFit[1],
    varpi_rad: varpiFit[0],
    varpi_rate: varpiFit[1],
    lambda_rad: lamFit[0],
    lambda_rate: lamFit[1],
    lambda_accel: quad ? lamFit[2] : 0,
    lib_omega: libW,
    lib_sin: libS,
    lib_cos: libC,
    window: [samples[0].jd, samples[samples.length - 1].jd],
  };
}

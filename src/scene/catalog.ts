// Solar-system body catalog. Physical values come straight from the baked
// NSSDCA fact sheets (data/baked/nssdca.json); nothing is hand-typed here
// except rendering choices, which are labelled as such.

import * as A from 'astronomy-engine';
import nssdca from '../../data/baked/nssdca.json';
import satellites from '../../data/baked/satellites.json';
import dwarfRotation from '../../data/baked/dwarf-rotation.json';
import type { FittedElements } from '../astro/satellites.ts';
import type { EphemerisModel } from '../astro/ephemeris.ts';
import type { OrientationModel } from '../astro/orientation.ts';
import { AU } from '../astro/units.ts';
import { EARTH_ATMOSPHERE, MARS_ATMOSPHERE, type AtmosphereParams } from './shaders/atmosphere.ts';

export type BodyKind = 'star' | 'planet' | 'dwarf-planet' | 'moon';

export type ShadingModel =
  /**
   * Lunar-Lambert: L=1 is pure Lommel-Seeliger, L=0 Lambert. L = 'mcewen' uses
   * McEwen's (1996) phase-dependent L(α) for the Moon, as implemented in USGS ISIS.
   */
  | { type: 'lunar'; L: number | 'mcewen' }
  /** Minnaert limb darkening for cloud-covered giants. */
  | { type: 'minnaert'; k: number }
  | { type: 'earth' }
  | { type: 'sun' };

export interface Appearance {
  /** Texture key under assets/textures/<key>/, or null for procedural. */
  texture: string | null;
  /** Width of the best texture (px) — sets the closest zoom: 1 texel per screen pixel. */
  textureWidth: number;
  shading: ShadingModel;
  /** Approximate disk-averaged sRGB color, used for far-away markers. */
  color: [number, number, number];
  /** Procedural cloud/haze color when no texture is used (sRGB). */
  tint?: [number, number, number];
  atmosphere?: AtmosphereParams;
  /** Where the colors/photometry come from (shown in info cards). */
  appearanceSource?: string;
}

export interface BodyDef {
  id: string;
  name: string;
  kind: BodyKind;
  parent: string | null;
  ephem: EphemerisModel;
  orient: OrientationModel;
  /** Ellipsoid semi-axes (m): equatorial, equatorial, polar. */
  radii: [number, number, number];
  /** GM (m^3/s^2), used for osculating orbit lines. */
  gm: number;
  /** Semi-major axis of the orbit around the parent (m). */
  semiMajorAxis: number;
  appearance: Appearance;
  /** NSSDCA key for info-card facts. */
  factsKey?: string;
  /** JPL physical parameters for moons (info cards). */
  moonPhys?: { radius_km: number; gm_km3_s2: number; density_g_cm3: number };
}

type Si = Record<string, number>;
const SI = (id: string): Si => (nssdca.bodies as unknown as Record<string, { si: Si }>)[id].si;

function radii(id: string): [number, number, number] {
  const s = SI(id);
  const eq = s.radius_equatorial_m ?? s.radius_mean_m;
  const pol = s.radius_polar_m ?? eq;
  return [eq, eq, pol];
}

function planet(
  id: string,
  name: string,
  body: A.Body,
  appearance: Appearance,
  kind: BodyKind = 'planet',
): BodyDef {
  const s = SI(id);
  return {
    id,
    name,
    kind,
    parent: 'sun',
    ephem: { type: 'helio', body },
    orient: id === 'earth' ? { type: 'earth' } : { type: 'iau', body },
    radii: radii(id),
    gm: s.gm_m3_s2,
    semiMajorAxis: s.semimajor_axis_m,
    appearance,
    factsKey: id,
  };
}

const sunSi = SI('sun');

export const BODIES: BodyDef[] = [
  {
    id: 'sun',
    name: 'Sun',
    kind: 'star',
    parent: null,
    ephem: { type: 'origin' },
    orient: { type: 'iau', body: A.Body.Sun },
    radii: [sunSi.radius_mean_m, sunSi.radius_mean_m, sunSi.radius_mean_m],
    gm: sunSi.gm_m3_s2,
    semiMajorAxis: 0,
    appearance: { texture: null, textureWidth: 0, shading: { type: 'sun' }, color: [1, 1, 1] },
    factsKey: 'sun',
  },
  planet('mercury', 'Mercury', A.Body.Mercury, {
    texture: 'mercury',
    textureWidth: 8192,
    shading: { type: 'lunar', L: 'mcewen' },
    color: [0x70 / 255, 0x69 / 255, 0x5c / 255],
    appearanceSource:
      'MESSENGER MDIS luminance; hue from disk-integrated color indices (Mallama et al. 2017, derived sRGB #70695C).',
  }),
  planet('venus', 'Venus', A.Body.Venus, {
    // In visible light Venus is a bland, nearly featureless cloud deck
    // (Limaye et al. 2018; Hueso et al. 2024). Color from Mallama et al. 2017
    // indices (B-V 0.70, V-R 0.57), derived sRGB #DAD8D2.
    texture: null,
    textureWidth: 0,
    shading: { type: 'minnaert', k: 0.85 },
    color: [0xda / 255, 0xd8 / 255, 0xd2 / 255],
    tint: [0xda / 255, 0xd8 / 255, 0xd2 / 255],
    appearanceSource: 'Featureless cloud deck (Limaye et al. 2018); color from Mallama et al. 2017 photometry.',
  }),
  planet('earth', 'Earth', A.Body.Earth, {
    texture: 'earth',
    textureWidth: 16384,
    shading: { type: 'earth' },
    color: [0.45, 0.6, 0.85],
    appearanceSource:
      'Blue Marble Next Generation monthly imagery (2004), blended by date; MODIS cloud composite; Black Marble 2016 city lights; GEBCO land relief. Atmosphere: single-scattering Rayleigh and Mie model.',
    atmosphere: EARTH_ATMOSPHERE,
  }),
  planet('mars', 'Mars', A.Body.Mars, {
    texture: 'mars',
    textureWidth: 16384,
    shading: { type: 'lunar', L: 0.5 },
    color: [0x88 / 255, 0x72 / 255, 0x55 / 255],
    atmosphere: MARS_ATMOSPHERE,
    appearanceSource: 'Viking Orbiter color mosaic (USGS); terrain relief from MGS MOLA elevation (true slopes); dust haze at the limb (single-scattering model, typical dust optical depth 0.5); disk color from Mallama et al. 2017 photometry.',
  }),
  planet('jupiter', 'Jupiter', A.Body.Jupiter, {
    texture: 'jupiter',
    textureWidth: 4096,
    // Minnaert k = 1.0 over the disk (Binder & McCarthy 1973).
    shading: { type: 'minnaert', k: 1.0 },
    color: [0xc1 / 255, 0xc1 / 255, 0xb2 / 255],
    appearanceSource: 'Hubble OPAL global map, 11-12 Dec 2025 (Simon, Wong et al.). Clouds drift; this is a snapshot.',
  }),
  planet('saturn', 'Saturn', A.Body.Saturn, {
    texture: 'saturn',
    textureWidth: 4096,
    // Minnaert k = 0.75-0.90 by latitude (Binder & McCarthy 1973).
    shading: { type: 'minnaert', k: 0.85 },
    color: [0xc5 / 255, 0xb9 / 255, 0x9b / 255],
    appearanceSource: 'Cassini ISS RGB global map, 11 Aug 2011 (Li et al. 2023); south polar cap (no data) filled.',
  }),
  planet('uranus', 'Uranus', A.Body.Uranus, {
    texture: null,
    textureWidth: 0,
    // Pale greenish-blue (Irwin et al. 2024). Albedo color derived from
    // Karkoschka (1998) spectra, sRGB #9BC3CA. k assumed equal to Neptune's.
    shading: { type: 'minnaert', k: 0.78 },
    color: [0x9b / 255, 0xc3 / 255, 0xca / 255],
    tint: [0x9b / 255, 0xc3 / 255, 0xca / 255],
    appearanceSource: 'True color per Irwin et al. 2024 (MNRAS 527, 11521); albedo color from Karkoschka spectra.',
  }),
  planet('neptune', 'Neptune', A.Body.Neptune, {
    texture: null,
    textureWidth: 0,
    // Only slightly bluer than Uranus (Irwin et al. 2024); sRGB #87B7CB.
    // Minnaert k from Voyager ISS green channel (Irwin et al. 2022).
    shading: { type: 'minnaert', k: 0.78 },
    color: [0x87 / 255, 0xb7 / 255, 0xcb / 255],
    tint: [0x87 / 255, 0xb7 / 255, 0xcb / 255],
    appearanceSource: 'True color per Irwin et al. 2024: similar to Uranus, not the deep blue of enhanced Voyager images.',
  }),
  planet(
    'pluto',
    'Pluto',
    A.Body.Pluto,
    {
      texture: 'pluto',
      textureWidth: 8192,
      shading: { type: 'lunar', L: 0.7 },
      color: [0.8, 0.7, 0.58],
      appearanceSource: 'New Horizons LORRI/MVIC global mosaic (USGS), grayscale; the far side was imaged at low resolution.',
    },
    'dwarf-planet',
  ),
  {
    id: 'moon',
    name: 'Moon',
    kind: 'moon',
    parent: 'earth',
    ephem: { type: 'geomoon' },
    orient: { type: 'iau', body: A.Body.Moon },
    radii: radii('moon'),
    gm: SI('moon').gm_m3_s2,
    semiMajorAxis: SI('moon').semimajor_axis_m,
    appearance: {
      texture: 'moon',
      textureWidth: 16384,
      shading: { type: 'lunar', L: 'mcewen' },
      color: [0.6, 0.58, 0.55],
      appearanceSource: 'LRO LROC WAC color mosaic and LOLA terrain relief (NASA SVS CGI Moon Kit); McEwen (1996) lunar photometric function.',
    },
    factsKey: 'moon',
  },
];

// ---- dwarf planets and Vesta ---------------------------------------------------------
// Positions: JPL Horizons tables. Ceres/Vesta: pole, period and shape from JPL
// SBDB (Dawn), prime meridian anchored to Horizons. Eris, Haumea, Makemake:
// spin poles are unknown, so they are drawn spinning about ecliptic north.

type Rot = { pole_ra_deg: number; pole_dec_deg: number; w0_deg: number; rate_deg_per_day: number; radii_km: number[]; gm_km3_s2: number };
const ROT = dwarfRotation.bodies as unknown as Record<string, Rot>;

function dwarf(
  id: string,
  name: string,
  kind: BodyKind,
  aAu: number,
  radiiKm: [number, number, number],
  gm: number,
  orient: OrientationModel,
  appearance: Appearance,
): BodyDef {
  return {
    id,
    name,
    kind,
    parent: 'sun',
    ephem: { type: 'table', id },
    orient,
    radii: [radiiKm[0] * 1e3, radiiKm[1] * 1e3, radiiKm[2] * 1e3],
    gm: gm * 1e9,
    semiMajorAxis: aAu * AU,
    appearance,
  };
}

const rotFixed = (r: Rot): OrientationModel => ({ type: 'fixed', ra: r.pole_ra_deg, dec: r.pole_dec_deg, w0: r.w0_deg, wd: r.rate_deg_per_day });
// Unknown pole: spin about ecliptic north (RA 270°, Dec 66.56°) at the measured period.
const eclipticSpin = (periodHours: number): OrientationModel => ({ type: 'fixed', ra: 270, dec: 66.5607, w0: 0, wd: (360 * 24) / periodHours });

BODIES.push(
  dwarf('ceres', 'Ceres', 'dwarf-planet', 2.77, ROT.ceres.radii_km as [number, number, number], ROT.ceres.gm_km3_s2, rotFixed(ROT.ceres), {
    texture: 'ceres',
    textureWidth: 4096,
    shading: { type: 'lunar', L: 0.8 },
    color: [0.36, 0.35, 0.34],
    appearanceSource: 'Dawn Framing Camera global mosaic (DLR/USGS), grayscale. Shape and spin from JPL SBDB.',
  }),
  dwarf('vesta', 'Vesta', 'dwarf-planet', 2.36, ROT.vesta.radii_km as [number, number, number], ROT.vesta.gm_km3_s2, rotFixed(ROT.vesta), {
    texture: 'vesta',
    textureWidth: 8192,
    shading: { type: 'lunar', L: 0.8 },
    color: [0.6, 0.58, 0.55],
    appearanceSource: 'Dawn Framing Camera HAMO mosaic (USGS), grayscale, on a triaxial ellipsoid (JPL SBDB extent); Vesta is actually lumpier.',
  }),
  // Eris: diameter 2326 km (Sicardy et al. 2011, Nature 478, 493); mass 1.66e22 kg (Brown & Schaller 2007).
  dwarf('eris', 'Eris', 'dwarf-planet', 67.9, [1163, 1163, 1163], 1108, eclipticSpin(25.9), {
    texture: null,
    textureWidth: 0,
    shading: { type: 'lunar', L: 0.9 },
    color: [0.86, 0.86, 0.86],
    tint: [0.86, 0.86, 0.86],
    appearanceSource: 'Never visited by spacecraft: a uniform sphere with its measured size and very high albedo (~0.96). Spin axis unknown.',
  }),
  // Haumea: triaxial 2322 × 1704 × 1026 km (Ortiz et al. 2017, Nature 550, 219); mass 4.006e21 kg (Ragozzine & Brown 2009).
  dwarf('haumea', 'Haumea', 'dwarf-planet', 43.1, [1161, 852, 513], 267.4, eclipticSpin(3.9154), {
    texture: null,
    textureWidth: 0,
    shading: { type: 'lunar', L: 0.9 },
    color: [0.82, 0.82, 0.82],
    tint: [0.82, 0.82, 0.82],
    appearanceSource: 'Never visited: its measured elongated shape spinning every 3.9 hours; surface detail unknown. Its ring is not shown yet.',
  }),
  // Makemake: diameter ≈ 1430 km (Ortiz et al. 2012, Nature 491, 566).
  dwarf('makemake', 'Makemake', 'dwarf-planet', 45.6, [715, 715, 715], 0, eclipticSpin(22.8266), {
    texture: null,
    textureWidth: 0,
    shading: { type: 'lunar', L: 0.9 },
    color: [0.78, 0.62, 0.5],
    tint: [0.78, 0.62, 0.5],
    appearanceSource: 'Never visited: a sphere with its measured size and reddish-brown color. Spin axis unknown.',
  }),
);

// ---- moons -----------------------------------------------------------------------
// Orbits: astronomy-engine (Galilean moons) or mean elements refit to JPL
// Horizons (all others; see tests/factcheck/moons.test.ts). Radii and GM from
// JPL Planetary Satellite Physical Parameters. Rotation is synchronous: the
// prime meridian faces the planet, as for all these tidally locked moons.

type Phys = { gm_km3_s2: number; radius_km: number };
const SAT_PHYS = satellites.physical as unknown as Record<string, Phys>;
const SAT_FITS = satellites.fits as unknown as Record<string, FittedElements & { pole_icrf: number[] }>;
const ECL_NORTH: [number, number, number] = [0, -0.3977771559, 0.9174820621];

interface MoonSpec {
  id: string;
  name: string;
  parent: string;
  color: [number, number, number];
  texture?: string;
  textureWidth?: number;
  L?: number;
  note?: string;
}

const GALILEAN = new Set(['io', 'europa', 'ganymede', 'callisto']);
// Jupiter's pole (J2000, WGCCRE): the Galilean moons orbit within ~0.5° of its equator.
const JUPITER_POLE = { ra: 268.056595, dec: 64.495303 };

const MOON_SPECS: MoonSpec[] = [
  { id: 'phobos', name: 'Phobos', parent: 'mars', color: [0.3, 0.28, 0.26], texture: 'phobos', textureWidth: 8192, note: 'Viking Orbiter mosaic (USGS/DLR), grayscale, on a sphere (Phobos is irregular).' },
  { id: 'deimos', name: 'Deimos', parent: 'mars', color: [0.33, 0.31, 0.28] },
  { id: 'io', name: 'Io', parent: 'jupiter', color: [0.87, 0.8, 0.46], texture: 'io', textureWidth: 8192, note: 'Galileo SSI and Voyager color mosaic (USGS).' },
  { id: 'europa', name: 'Europa', parent: 'jupiter', color: [0.78, 0.72, 0.6], texture: 'europa', textureWidth: 8192, note: 'Galileo SSI and Voyager mosaic (USGS), grayscale.' },
  { id: 'ganymede', name: 'Ganymede', parent: 'jupiter', color: [0.55, 0.5, 0.44], texture: 'ganymede', textureWidth: 8192, note: 'Galileo SSI and Voyager color mosaic (USGS).' },
  { id: 'callisto', name: 'Callisto', parent: 'jupiter', color: [0.36, 0.33, 0.29], texture: 'callisto', textureWidth: 8192, note: 'Galileo SSI and Voyager mosaic (USGS), grayscale.' },
  { id: 'mimas', name: 'Mimas', parent: 'saturn', color: [0.78, 0.77, 0.75], texture: 'mimas', textureWidth: 4096, note: 'Cassini ISS global map (PIA17214), grayscale.' },
  { id: 'enceladus', name: 'Enceladus', parent: 'saturn', color: [0.95, 0.95, 0.95], texture: 'enceladus', textureWidth: 8192, note: 'Cassini ISS global mosaic (USGS), grayscale.' },
  { id: 'tethys', name: 'Tethys', parent: 'saturn', color: [0.85, 0.84, 0.82], texture: 'tethys', textureWidth: 8192, note: 'Cassini ISS global mosaic (USGS), grayscale.' },
  { id: 'dione', name: 'Dione', parent: 'saturn', color: [0.8, 0.79, 0.77], texture: 'dione', textureWidth: 8192, note: 'Cassini and Voyager global mosaic (USGS), grayscale.' },
  { id: 'rhea', name: 'Rhea', parent: 'saturn', color: [0.78, 0.77, 0.75], texture: 'rhea', textureWidth: 8192, note: 'Cassini and Voyager global mosaic (USGS), grayscale.' },
  // Titan in visible light is an opaque orange haze; color from Karkoschka 1995 spectrum (derived #917E5F).
  { id: 'titan', name: 'Titan', parent: 'saturn', color: [0x91 / 255, 0x7e / 255, 0x5f / 255], note: 'Visible-light appearance: opaque orange haze (Karkoschka 1995 albedo spectrum, derived color).' },
  { id: 'iapetus', name: 'Iapetus', parent: 'saturn', color: [0.5, 0.46, 0.4], texture: 'iapetus', textureWidth: 4096, note: 'Cassini and Voyager global mosaic (USGS), grayscale: note the dark leading hemisphere.' },
  { id: 'miranda', name: 'Miranda', parent: 'uranus', color: [0.55, 0.55, 0.55] },
  { id: 'ariel', name: 'Ariel', parent: 'uranus', color: [0.6, 0.6, 0.6] },
  { id: 'umbriel', name: 'Umbriel', parent: 'uranus', color: [0.38, 0.38, 0.38] },
  { id: 'titania', name: 'Titania', parent: 'uranus', color: [0.55, 0.53, 0.52] },
  { id: 'oberon', name: 'Oberon', parent: 'uranus', color: [0.5, 0.48, 0.46] },
  { id: 'triton', name: 'Triton', parent: 'neptune', color: [0.8, 0.76, 0.72], texture: 'triton', textureWidth: 8192, note: 'Voyager 2 mosaic in synthetic color (USGS, P. Schenk); much of the north was in darkness and is filled.' },
  { id: 'charon', name: 'Charon', parent: 'pluto', color: [0.55, 0.53, 0.51], texture: 'charon', textureWidth: 8192, note: 'New Horizons global mosaic (USGS), grayscale.' },
];

function moonDef(m: MoonSpec): BodyDef {
  const phys = SAT_PHYS[m.id];
  const R = phys.radius_km * 1000;
  let ephem: EphemerisModel;
  let pole: { ra: number; dec: number };
  let a: number;
  if (GALILEAN.has(m.id)) {
    ephem = { type: 'jupiterMoon', moon: m.id as 'io' };
    pole = JUPITER_POLE;
    a = { io: 421_800e3, europa: 671_100e3, ganymede: 1_070_400e3, callisto: 1_882_700e3 }[m.id as 'io'];
  } else {
    const fit = SAT_FITS[m.id];
    ephem = { type: 'fitted', elements: fit };
    let p = fit.pole_icrf;
    // IAU convention: body north is on the north side of the invariable plane (≈ ecliptic).
    if (p[0] * ECL_NORTH[0] + p[1] * ECL_NORTH[1] + p[2] * ECL_NORTH[2] < 0) p = [-p[0], -p[1], -p[2]];
    pole = { ra: (Math.atan2(p[1], p[0]) * 180) / Math.PI, dec: (Math.asin(p[2]) * 180) / Math.PI };
    a = fit.a_km * 1000;
  }
  return {
    id: m.id,
    name: m.name,
    kind: 'moon',
    parent: m.parent,
    ephem,
    orient: { type: 'synchronous', ra: pole.ra, dec: pole.dec },
    radii: [R, R, R],
    gm: phys.gm_km3_s2 * 1e9,
    semiMajorAxis: a,
    appearance: {
      texture: m.texture ?? null,
      textureWidth: m.textureWidth ?? 0,
      shading: { type: 'lunar', L: m.L ?? 0.6 },
      color: m.color,
      tint: m.color,
      appearanceSource: m.note,
    },
    moonPhys: { radius_km: phys.radius_km, gm_km3_s2: phys.gm_km3_s2, density_g_cm3: (phys as unknown as { density_g_cm3: number }).density_g_cm3 },
  };
}

// Pluto: Horizons table of the Pluto–Charon barycenter plus Pluto's own wobble
// around it (Charon/(Pluto+Charon) mass ratio from JPL GM values).
{
  const pluto = BODIES.find((b) => b.id === 'pluto')!;
  const ratio = SAT_PHYS.charon.gm_km3_s2 / (SAT_PHYS.charon.gm_km3_s2 + pluto.gm / 1e9);
  pluto.ephem = { type: 'table', id: 'pluto-barycenter', fallback: { type: 'helio', body: A.Body.Pluto }, companion: { elements: SAT_FITS.charon, ratio } };
}

// Insert moons right after their parents so BODIES stays parents-first.
for (const m of MOON_SPECS) {
  const idx = BODIES.findIndex((b) => b.id === m.parent);
  let j = idx + 1;
  while (j < BODIES.length && BODIES[j].parent === m.parent) j++;
  BODIES.splice(j, 0, moonDef(m));
}

export const BODY_BY_ID = new Map(BODIES.map((b) => [b.id, b]));

export const meanRadius = (b: BodyDef): number => (2 * b.radii[0] + b.radii[2]) / 3;

/** Parent chain from a body up to the root, e.g. moon -> earth -> sun. */
export function ancestry(id: string): string[] {
  const out: string[] = [];
  let cur: string | null = id;
  while (cur) {
    out.push(cur);
    cur = BODY_BY_ID.get(cur)?.parent ?? null;
  }
  return out;
}

export const REFERENCE_AU = AU;

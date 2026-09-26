// Registry provider for galaxies, clusters and cosmological scales.

import { ageGyr, comovingDistanceMpc, particleHorizonMpc, Z_STAR } from '../../astro/cosmology.ts';
import { EQJ_TO_GAL, galaxyFrame } from '../../astro/galactic.ts';
import { GLY, KPC, LY, MPC } from '../../astro/units.ts';
import { add, normalize, scale, type Vec3 } from '../../astro/vec.ts';
import type { FocusTarget } from '../../engine/camera/controller.ts';
import type { CosmosLayer, LocalGalaxy } from '../layers/cosmos.ts';
import type { GalaxySpritesLayer } from '../layers/galaxySprites.ts';
import sourcesDoc from '../../../data/sources.json';
import type { ObjectInfo, Provider, SearchEntry } from '../registry.ts';
import type { World } from '../world.ts';

const DEG = Math.PI / 180;
const UNGC = { name: 'Karachentsev et al. 2013, Updated Nearby Galaxy Catalog', url: 'https://cdsarc.cds.unistra.fr/viz-bin/cat/J/AJ/145/101' };
const LVDB = { name: 'Local Volume Database (Pace 2025)', url: 'https://github.com/apace7/local_volume_database' };
const PLANCK = { name: 'Planck 2018 results VI, A&A 641, A6', url: 'https://doi.org/10.1051/0004-6361/201833910' };
const FIXSEN = { name: 'Fixsen 2009, ApJ 707, 916', url: 'https://doi.org/10.1088/0004-637X/707/2/916' };
const TULLY = { name: 'Tully et al. 2014, Nature 513, 71', url: 'https://doi.org/10.1038/nature13674' };
const MEI = { name: 'Mei et al. 2007, ApJ 655, 144', url: 'https://doi.org/10.1086/509598' };
const DERIVED_Z = { name: 'Comoving distance from redshift, Planck 2018 cosmology', url: 'https://doi.org/10.1051/0004-6361/201833910' };

/** Friendly names for well-known galaxies (catalog name -> display, aliases). */
const FAMOUS: Record<string, { name: string; aliases: string[] }> = {
  MESSIER031: { name: 'Andromeda Galaxy', aliases: ['M31', 'NGC 224', 'Andromeda'] },
  MESSIER033: { name: 'Triangulum Galaxy', aliases: ['M33', 'NGC 598', 'Triangulum'] },
  LMC: { name: 'Large Magellanic Cloud', aliases: ['LMC'] },
  SMC: { name: 'Small Magellanic Cloud', aliases: ['SMC', 'NGC 292'] },
  MESSIER081: { name: "Bode's Galaxy", aliases: ['M81', 'NGC 3031'] },
  MESSIER082: { name: 'Cigar Galaxy', aliases: ['M82', 'NGC 3034'] },
  NGC0253: { name: 'Sculptor Galaxy', aliases: ['NGC 253', 'Silver Coin'] },
  NGC5128: { name: 'Centaurus A', aliases: ['NGC 5128', 'Cen A'] },
  NGC5194: { name: 'Whirlpool Galaxy', aliases: ['M51', 'M51a', 'NGC 5194'] },
  MESSIER101: { name: 'Pinwheel Galaxy', aliases: ['M101', 'NGC 5457'] },
  NGC4594: { name: 'Sombrero Galaxy', aliases: ['M104', 'NGC 4594'] },
  NGC5236: { name: 'Southern Pinwheel Galaxy', aliases: ['M83', 'NGC 5236'] },
  Maffei1: { name: 'Maffei 1', aliases: [] },
  Maffei2: { name: 'Maffei 2', aliases: [] },
};

interface Place {
  id: string;
  name: string;
  aliases: string[];
  ra: number;
  dec: number;
  /** Comoving distance (Mpc). */
  dist: number;
  kind: string;
  /** Contains the Milky Way, so it has no distance from us. */
  diffuse?: boolean;
  facts: ObjectInfo['facts'];
  note: string;
  framing: number;
}

const zDist = (z: number) => comovingDistanceMpc(z);

/** Galactic (l, b) in degrees -> ICRS RA/Dec in degrees. */
function galacticToRaDec(l: number, b: number): { ra: number; dec: number } {
  const g: Vec3 = [Math.cos(b * DEG) * Math.cos(l * DEG), Math.cos(b * DEG) * Math.sin(l * DEG), Math.sin(b * DEG)];
  const m = EQJ_TO_GAL;
  const x = m[0] * g[0] + m[3] * g[1] + m[6] * g[2];
  const y = m[1] * g[0] + m[4] * g[1] + m[7] * g[2];
  const z = m[2] * g[0] + m[5] * g[1] + m[8] * g[2];
  let ra = Math.atan2(y, x) / DEG;
  if (ra < 0) ra += 360;
  return { ra, dec: Math.asin(z) / DEG };
}

// Clusters and superclusters. Positions are catalog centers; distances either
// measured (Virgo) or derived from the mean redshift with Planck 2018 cosmology.
const PLACES: Place[] = [
  {
    id: 'virgo-cluster',
    name: 'Virgo Cluster',
    aliases: ['Virgo'],
    ra: 187.7059,
    dec: 12.3911,
    dist: 16.5,
    kind: 'Galaxy cluster',
    facts: [
      { label: 'Distance', value: '16.5 Mpc (54 million ly)', kind: 'measured', source: MEI },
      { label: 'Central galaxy', value: 'M87, home of the first imaged black hole', kind: 'measured', source: MEI },
    ],
    note: 'The nearest large galaxy cluster, about 1,300–2,000 galaxies. Marker at M87.',
    framing: 12 * MPC,
  },
  {
    id: 'coma-cluster',
    name: 'Coma Cluster',
    aliases: ['Abell 1656'],
    ra: 194.953,
    dec: 27.981,
    dist: zDist(0.0231),
    kind: 'Galaxy cluster',
    facts: [{ label: 'Redshift', value: 'z = 0.0231', kind: 'measured', source: DERIVED_Z }],
    note: 'A rich cluster of more than 1,000 galaxies; where Fritz Zwicky first inferred dark matter (1933).',
    framing: 25 * MPC,
  },
  {
    id: 'perseus-cluster',
    name: 'Perseus Cluster',
    aliases: ['Abell 426'],
    ra: 49.9505,
    dec: 41.5117,
    dist: zDist(0.0179),
    kind: 'Galaxy cluster',
    facts: [{ label: 'Redshift', value: 'z = 0.0179', kind: 'measured', source: DERIVED_Z }],
    note: 'One of the most massive objects in the nearby universe, at the heart of the Perseus–Pisces supercluster.',
    framing: 25 * MPC,
  },
  {
    id: 'norma-cluster',
    name: 'Norma Cluster',
    aliases: ['Abell 3627', 'Great Attractor'],
    ra: 243.593,
    dec: -60.874,
    dist: zDist(0.0163),
    kind: 'Galaxy cluster',
    facts: [{ label: 'Redshift', value: 'z = 0.0163', kind: 'measured', source: DERIVED_Z }],
    note: 'Near the Great Attractor, the gravitational focus of our Laniakea supercluster, partly hidden behind the Milky Way.',
    framing: 25 * MPC,
  },
  {
    id: 'shapley-supercluster',
    name: 'Shapley Supercluster',
    aliases: ['Abell 3558'],
    ra: 201.987,
    dec: -31.496,
    dist: zDist(0.048),
    kind: 'Supercluster',
    facts: [{ label: 'Redshift (core, Abell 3558)', value: 'z = 0.048', kind: 'measured', source: DERIVED_Z }],
    note: 'The most massive concentration of galaxies in the nearby universe.',
    framing: 120 * MPC,
  },
  {
    id: 'laniakea',
    name: 'Laniakea Supercluster',
    aliases: ['Laniakea', 'Our supercluster'],
    // Tully et al. 2014: basin of attraction centered near the Great Attractor (l ≈ 307°, b ≈ 9°).
    ...galacticToRaDec(307, 9),
    dist: 70,
    kind: 'Supercluster',
    diffuse: true,
    facts: [
      { label: 'Diameter', value: '≈ 160 Mpc (520 million ly)', kind: 'measured', source: TULLY },
      { label: 'Mass', value: '≈ 10¹⁷ Suns', kind: 'measured', source: TULLY },
      { label: 'Galaxies', value: '≈ 100,000', kind: 'measured', source: TULLY },
    ],
    note: 'Our home supercluster, defined by where galaxies flow (their peculiar velocities), not by a visible edge, so no boundary is drawn. Marker near the Great Attractor.',
    framing: 350 * MPC,
  },
];

const hubbleType = (T: number | null, morph?: string): string => {
  if (morph) return ({ Sph: 'dwarf spheroidal', Im: 'irregular', BCD: 'blue compact dwarf', dE: 'dwarf elliptical' } as Record<string, string>)[morph] ?? morph;
  if (T === null || T === undefined) return 'unknown';
  if (T <= -4) return 'elliptical';
  if (T <= -1) return 'lenticular';
  if (T <= 1) return 'early spiral (Sa)';
  if (T <= 3) return 'spiral (Sb)';
  if (T <= 5) return 'spiral (Sc)';
  if (T <= 8) return 'late spiral (Sd–Sm)';
  return 'irregular / dwarf';
};

const unit = (ra: number, dec: number): Vec3 => [Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG)];

export class CosmosProvider implements Provider {
  private mw = galaxyFrame();
  private cache = new Map<string, FocusTarget>();

  constructor(
    private world: World,
    private layer: CosmosLayer,
    private sprites: GalaxySpritesLayer,
  ) {}

  private sun(): Vec3 {
    return this.world.get('sun').pos;
  }

  private galaxy(id: string): LocalGalaxy | undefined {
    if (!id.startsWith('gal-')) return undefined;
    const name = id.slice(4);
    return this.layer.local.find((g) => g.name === name);
  }

  /** Andromeda's heliocentric position (m). */
  private m31(): Vec3 {
    const g = this.layer.local.find((x) => x.name === 'MESSIER031');
    const u = unit(g?.ra ?? 10.68542, g?.dec ?? 41.26917);
    return add(this.sun(), scale(u, (g?.dist_mpc ?? 0.776) * MPC));
  }

  target(id: string): FocusTarget | undefined {
    const hit = this.cache.get(id);
    if (hit) return hit;
    let t: FocusTarget | undefined;
    if (id === 'local-group') {
      // Mass-weighted MW–M31 barycenter (M31/MW mass ratio ≈ 1.3 assumed).
      t = {
        id,
        radius: 0.05 * MPC,
        minAltitude: 0.1 * MPC,
        pos: () => {
          const mw = add(this.sun(), this.mw.center);
          const m31 = this.m31();
          const k = 1.3 / 2.3;
          return [mw[0] + (m31[0] - mw[0]) * k, mw[1] + (m31[1] - mw[1]) * k, mw[2] + (m31[2] - mw[2]) * k];
        },
        pole: () => null,
        handoff: [20 * MPC, 200 * MPC],
        parent: 'observable-universe',
        framing: 1.6 * MPC,
      };
    } else if (id === 'observable-universe') {
      t = {
        id,
        radius: 0,
        minAltitude: 1,
        pos: () => this.sun(),
        pole: () => null,
        handoff: null,
        parent: null,
        framing: 2.4 * this.layer.dLs,
      };
    } else if (id.startsWith('gal-')) {
      const g = this.galaxy(id);
      if (!g) return undefined;
      const R = Math.max(((g.diam_kpc ?? 2) / 2) * KPC, 0.5 * KPC);
      const u = unit(g.ra, g.dec);
      t = {
        id,
        radius: R,
        minAltitude: R * 0.8,
        pos: () => add(this.sun(), scale(u, g.dist_mpc * MPC)),
        pole: () => null,
        handoff: [40 * R, 400 * R],
        parent: 'local-group',
        framing: R * 7,
      };
    } else {
      const p = PLACES.find((x) => x.id === id);
      if (!p) return undefined;
      const u = unit(p.ra, p.dec);
      t = {
        id,
        radius: 0,
        minAltitude: 0.2 * MPC,
        pos: () => add(this.sun(), scale(u, p.dist * MPC)),
        pole: () => null,
        handoff: [p.framing * 2, p.framing * 20],
        parent: 'observable-universe',
        framing: p.framing,
      };
    }
    this.cache.set(id, t);
    return t;
  }

  info(id: string): ObjectInfo | undefined {
    if (id === 'observable-universe') {
      const dls = (comovingDistanceMpc(Z_STAR) * MPC) / GLY;
      const ph = (particleHorizonMpc() * MPC) / GLY;
      return {
        id,
        name: 'Observable Universe',
        subtitle: 'Everything whose light has had time to reach us',
        facts: [
          { label: 'Age of the universe', value: `${ageGyr(0).toFixed(3)} billion years`, kind: 'derived', source: PLANCK },
          { label: 'Radius (comoving, today)', value: `≈ ${ph.toFixed(1)} billion light-years`, kind: 'derived', source: PLANCK },
          { label: 'Distance to the CMB (last scattering)', value: `≈ ${dls.toFixed(1)} billion light-years`, kind: 'derived', source: PLANCK },
          { label: 'CMB released', value: `redshift z ≈ ${Z_STAR}, ≈ 380,000 years after the Big Bang`, kind: 'measured', source: PLANCK },
          { label: 'CMB temperature today', value: '2.7255 K', kind: 'measured', source: FIXSEN },
        ],
        notes: [
          {
            text: "The CMB sphere shows Planck's map of tiny temperature differences (±300 millionths of a degree) in false color; the CMB itself is microwave light, invisible to the eye. The observable universe is centered on us: viewing it from outside is only a visualization.",
            kind: 'artistic',
          },
          {
            text: 'Galaxies are placed at comoving distances (where they are now). Empty wedges are regions no survey covered, and the band hidden behind the Milky Way.',
            kind: 'measured',
          },
        ],
      };
    }
    if (id === 'local-group') {
      return {
        id,
        name: 'Local Group',
        subtitle: 'Our group of ~100 galaxies',
        facts: [
          { label: 'Largest members', value: 'Andromeda (M31), Milky Way, Triangulum (M33)', kind: 'measured', source: LVDB },
          { label: 'Distance to Andromeda', value: `${((this.layer.local.find((g) => g.name === 'MESSIER031')?.dist_mpc ?? 0.776) * 1000).toFixed(0)} kpc (${(((this.layer.local.find((g) => g.name === 'MESSIER031')?.dist_mpc ?? 0.776) * MPC) / LY / 1e6).toFixed(2)} million ly)`, kind: 'measured', source: LVDB },
        ],
        notes: [{ text: 'The marker sits at an assumed MW–M31 barycenter (mass ratio 1.3); the true value is uncertain.', kind: 'model' }],
      };
    }
    const g = this.galaxy(id);
    if (g) {
      const f = FAMOUS[g.name];
      const src = g.src === 'LVDB' ? LVDB : UNGC;
      const facts: ObjectInfo['facts'] = [
        {
          label: 'Distance',
          value: `${g.dist_mpc < 1 ? `${(g.dist_mpc * 1000).toFixed(0)} kpc` : `${g.dist_mpc.toFixed(2)} Mpc`} (${((g.dist_mpc * MPC) / LY / 1e6).toLocaleString('en-US', { maximumSignificantDigits: 3 })} million ly)`,
          kind: 'measured',
          source: g.dist_method.includes('LVDB') ? LVDB : src,
        },
        { label: 'Distance method', value: g.dist_method.replace('Cep', 'Cepheids').replace('TRGB', 'tip of the red giant branch').replace('SBF', 'surface brightness fluctuations').replace('TF', 'Tully–Fisher'), kind: 'measured', source: src },
        { label: 'Type', value: hubbleType(g.T, g.morph), kind: 'measured', source: src },
      ];
      if (g.diam_kpc) facts.push({ label: 'Diameter (Holmberg)', value: `${g.diam_kpc.toFixed(1)} kpc (${Math.round((g.diam_kpc * KPC) / LY).toLocaleString('en-US')} ly)`, kind: 'measured', source: src });
      if (g.BMag) facts.push({ label: 'Absolute B magnitude', value: g.BMag.toFixed(1), kind: 'measured', source: UNGC });
      if (g.incl_deg) facts.push({ label: 'Inclination', value: `${g.incl_deg}°`, kind: 'measured', source: UNGC });
      const photoId = this.sprites.photoSource.get(g.name);
      const photo = photoId ? (sourcesDoc.sources as Array<{ id: string; credit: string; url: string; title: string }>).find((x) => x.id === photoId) : undefined;
      const notes: ObjectInfo['notes'] = photo
        ? [
            {
              text: `Photograph: ${photo.title}. Credit: ${photo.credit} (CC BY 4.0). Placed at the galaxy's measured position and true angular size, oriented as seen from Earth; it is a flat image, not a 3D model.`,
              kind: 'measured',
            },
          ]
        : [{ text: 'Shown as a glow at its measured position and size.', kind: 'model' }];
      if (photo) facts.push({ label: 'Photograph', value: photo.title, kind: 'measured', source: { name: 'Image page', url: photo.url } });
      return { id, name: f?.name ?? g.name, subtitle: f ? `${f.aliases[0] ?? g.name} · Galaxy` : 'Galaxy', facts, notes };
    }
    const p = PLACES.find((x) => x.id === id);
    if (p) {
      return {
        id,
        name: p.name,
        subtitle: p.kind,
        facts: [
          ...p.facts,
          { label: 'Distance (comoving)', value: `${p.dist.toFixed(0)} Mpc (${((p.dist * MPC) / LY / 1e6).toLocaleString('en-US', { maximumSignificantDigits: 3 })} million ly)`, kind: p.id === 'virgo-cluster' ? 'measured' : 'derived', source: p.id === 'virgo-cluster' ? MEI : p.id === 'laniakea' ? TULLY : DERIVED_Z },
        ],
        notes: [{ text: p.note, kind: 'measured' }],
      };
    }
    return undefined;
  }

  search(): SearchEntry[] {
    const out: SearchEntry[] = [
      { id: 'local-group', name: 'Local Group', kind: 'Galaxy group', detail: 'Galaxy group', rank: 0, diffuse: true },
      { id: 'observable-universe', name: 'Observable Universe', aliases: ['Universe', 'CMB', 'Cosmic microwave background', 'Big Bang'], kind: 'Cosmos', detail: 'Cosmos', rank: 0, diffuse: true },
      ...PLACES.map((p) => ({ id: p.id, name: p.name, aliases: p.aliases, kind: p.kind, detail: p.kind, rank: 1, diffuse: p.diffuse })),
    ];
    for (const g of this.layer.local) {
      const f = FAMOUS[g.name];
      out.push({ id: `gal-${g.name}`, name: f?.name ?? g.name, aliases: f ? [g.name, ...f.aliases] : [], kind: 'Galaxy', detail: `Galaxy · ${((g.dist_mpc * MPC) / LY / 1e6).toLocaleString('en-US', { maximumSignificantDigits: 2 })} Mly`, rank: f ? 1 : 4 });
    }
    return out;
  }

  /** Labels for famous galaxies and places. */
  labels(): Array<{ id: string; name: string; pos: Vec3; priority: number; minMpc: number; maxMpc: number }> {
    const out = [];
    for (const g of this.layer.local) {
      const f = FAMOUS[g.name];
      if (!f) continue;
      out.push({ id: `gal-${g.name}`, name: f.name, pos: this.target(`gal-${g.name}`)!.pos(), priority: 30 - (g.BMag ?? -15), minMpc: 0.03, maxMpc: 60 });
    }
    for (const p of PLACES) out.push({ id: p.id, name: p.name, pos: this.target(p.id)!.pos(), priority: 35, minMpc: p.dist * 0.15, maxMpc: p.dist * 40 });
    out.push({ id: 'local-group', name: 'Local Group', pos: this.target('local-group')!.pos(), priority: 60, minMpc: 1.2, maxMpc: 60 });
    return out;
  }
}

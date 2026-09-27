// Black holes: a hand-picked list, every number cited. Supermassive ones sit
// at the center of a galaxy we already draw and take its position; stellar
// ones are placed from their discovery papers (their companion stars are too
// faint for our star catalog), except Cygnus X-1, which orbits a catalog star.
// Positions under `published` are SIMBAD's and are only used by the fact-check.

import type { InfoFact, ObjectInfo } from '../scene/registry.ts';

type Cite = InfoFact['source'];

export type BlackHoleClass = 'stellar' | 'supermassive';

/** Search-result marker for each class: coral for stellar holes, violet for supermassive ones. */
export const BLACK_HOLE_CLASS_COLOR: Record<BlackHoleClass, string> = { stellar: '#ff9478', supermassive: '#c58bff' };

export type Placement =
  /** At the position of another registry target (a galaxy, the Milky Way, the Virgo Cluster marker at M87). */
  | { type: 'host'; host: string }
  /** From RA/Dec (deg, ICRS) and a measured distance. */
  | { type: 'sky'; ra: number; dec: number; distPc: number }
  /** Next to a catalog star (by HIP number), one orbit radius toward celestial north. */
  | { type: 'companion'; hip: number };

export interface Binary {
  companion: string;
  /** Companion mass (M☉), when published. */
  companionMsun?: number;
  periodDays: number;
  source: Cite;
  /** Where the period comes from, when not `source`. */
  periodSource?: Cite;
  /** For drawing the companion as a sphere (Cygnus X-1 only). */
  companionRsun?: number;
  companionTeff?: number;
}

/** An accretion disk or hot flow to draw around the hole (see docs/plans/accretion-disks.md). */
export interface DiskDef {
  /** 'thin': an opaque Keplerian disk; 'thick': an optically thin hot flow, as the EHT sees. */
  kind: 'thin' | 'thick';
  /** Angle between the disk's angular-momentum axis and the direction to Earth (deg). */
  inclinationDeg: number;
  inclinationSource: Cite;
  /** Position angle (deg east of north) of the axis on the sky; omit when unmeasured. */
  axisPaDeg?: number;
  /** Axis points away from Earth, i.e. clockwise rotation on the sky (M87*). */
  axisAway?: boolean;
  /** Inner and outer radius in horizon radii: 3 and 40 for thin disks. */
  rInRs: number;
  rOutRs: number;
  /** Inner-edge temperature (K), for the card; the palette is artistic. */
  tInnerK?: number;
  /** Outbursts, when the disk shines: ISO dates and the name the timeline gives each; omit for always. */
  active?: Array<{ from: string; to: string; name: string }>;
  facts: InfoFact[];
  notes: ObjectInfo['notes'];
}

export interface BlackHoleDef {
  id: string;
  name: string;
  aliases: string[];
  cls: BlackHoleClass;
  /** Search rank: lower sorts first among equal matches. */
  rank: number;
  /** Where it is, for the subtitle and search detail. */
  where: string;
  mass: {
    msun: number;
    text: string;
    source: Cite;
    /** Distance (Mpc) the dynamical mass was derived at; the mass scales with it. */
    atDistMpc?: number;
  };
  placement: Placement;
  distance?: { text: string; source: Cite };
  published: { ra: number; dec: number };
  binary?: Binary;
  /** Label for the host galaxy's info-card fact. */
  hostFactLabel?: string;
  facts: InfoFact[];
  note: string;
  disk?: DiskDef;
}

const simbad = (id: string): Cite => ({ name: 'SIMBAD', url: `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(id)}` });

const GRAVITY19 = { name: 'GRAVITY Collaboration 2019, A&A 625, L10', url: 'https://doi.org/10.1051/0004-6361/201935656' };
const EHT22 = { name: 'Event Horizon Telescope Collaboration 2022, ApJL 930, L12', url: 'https://doi.org/10.3847/2041-8213/ac6674' };
const EHT19_I = { name: 'Event Horizon Telescope Collaboration 2019, ApJL 875, L1', url: 'https://doi.org/10.3847/2041-8213/ab0ec7' };
const EHT19_VI = { name: 'Event Horizon Telescope Collaboration 2019, ApJL 875, L6', url: 'https://doi.org/10.3847/2041-8213/ab1141' };
const MJ21 = { name: 'Miller-Jones et al. 2021, Science 371, 1046', url: 'https://doi.org/10.1126/science.abb3363' };
const ZHAO21 = { name: 'Zhao et al. 2021, ApJ 908, 117', url: 'https://doi.org/10.3847/1538-4357/abbcd6' };
const WEBSTER72 = { name: 'Webster & Murdin 1972, Nature 235, 37', url: 'https://doi.org/10.1038/235037a0' };
const BOLTON72 = { name: 'Bolton 1972, Nature 235, 271', url: 'https://doi.org/10.1038/235271b0' };
const ELB23A = { name: 'El-Badry et al. 2023, MNRAS 518, 1057', url: 'https://doi.org/10.1093/mnras/stac3140' };
const ELB23B = { name: 'El-Badry et al. 2023, MNRAS 521, 4323', url: 'https://doi.org/10.1093/mnras/stad799' };
const PANUZZO24 = { name: 'Gaia Collaboration, Panuzzo et al. 2024, A&A 686, L2', url: 'https://doi.org/10.1051/0004-6361/202449763' };
const MJ09 = { name: 'Miller-Jones et al. 2009, ApJ 706, L230', url: 'https://doi.org/10.1088/0004-637X/706/2/L230' };
const KHARGHARIA10 = { name: 'Khargharia, Froning & Robinson 2010, ApJ 716, 1105', url: 'https://doi.org/10.1088/0004-637X/716/2/1105' };
const CASARES92 = { name: 'Casares, Charles & Naylor 1992, Nature 355, 614', url: 'https://doi.org/10.1038/355614a0' };
const CANTRELL10 = { name: 'Cantrell et al. 2010, ApJ 710, 1127', url: 'https://doi.org/10.1088/0004-637X/710/2/1127' };
const MCCLINTOCK86 = { name: 'McClintock & Remillard 1986, ApJ 308, 110', url: 'https://doi.org/10.1086/164482' };
const BROCKSOPP99 = { name: 'Brocksopp et al. 1999, A&A 343, 861 (orbital ephemeris)', url: 'https://ui.adsabs.harvard.edu/abs/1999A%26A...343..861B' };
const NGUYEN26 = { name: 'Nguyen et al. 2026, JWST/NIRSpec stellar dynamics (preprint, arXiv:2601.17439)', url: 'https://arxiv.org/abs/2601.17439' };
const BENDER05 = { name: 'Bender et al. 2005, ApJ 631, 280', url: 'https://doi.org/10.1086/432434' };
const VDB10 = { name: 'van den Bosch & de Zeeuw 2010, MNRAS 401, 1770', url: 'https://doi.org/10.1111/j.1365-2966.2009.15832.x' };
const DEVEREUX03 = { name: 'Devereux et al. 2003, AJ 125, 1226', url: 'https://doi.org/10.1086/367595' };
const HUMPHREYS13 = { name: 'Humphreys et al. 2013, ApJ 775, 13', url: 'https://doi.org/10.1088/0004-637X/775/1/13' };
const CAPPELLARI09 = { name: 'Cappellari et al. 2009, MNRAS 394, 660', url: 'https://doi.org/10.1111/j.1365-2966.2008.14377.x' };
const JARDEL11 = { name: 'Jardel et al. 2011, ApJ 739, 21', url: 'https://doi.org/10.1088/0004-637X/739/1/21' };
const GREENHILL03 = { name: 'Greenhill et al. 2003, ApJ 590, 162', url: 'https://doi.org/10.1086/374862' };
const GOU11 = { name: 'Gou et al. 2011, ApJ 742, 85', url: 'https://doi.org/10.1088/0004-637X/742/2/85' };
const WALKER18 = { name: 'Walker et al. 2018, ApJ 855, 128', url: 'https://doi.org/10.3847/1538-4357/aaafcc' };
const EHT19_V = { name: 'Event Horizon Telescope Collaboration 2019, ApJL 875, L5', url: 'https://doi.org/10.3847/2041-8213/ab0f43' };
const PLOTKIN17 = { name: 'Plotkin et al. 2017, ApJ 834, 104', url: 'https://doi.org/10.3847/1538-4357/834/2/104' };
const CORBEL08 = { name: 'Corbel, Koerding & Kaaret 2008, MNRAS 389, 1697', url: 'https://doi.org/10.1111/j.1365-2966.2008.13542.x' };
const KALUZIENSKI77 = { name: 'Kaluzienski et al. 1977, ApJ 212, 203', url: 'https://doi.org/10.1086/155036' };
const EHT22_V = { name: 'Event Horizon Telescope Collaboration 2022, ApJL 930, L16', url: 'https://doi.org/10.3847/2041-8213/ac6672' };

const THIN_ARTISTIC = 'Colors follow NASA’s visualizations. The disk shines mostly in X-rays; in visible light it would look blue-white. The streaks are illustrative, but they orbit at the gas’s real speed as time runs: 100 to 300 turns a second at the inner edge, so they blur unless time is paused.';
const EHT_ARTISTIC = 'Colors follow the Event Horizon Telescope’s false-color images. The real glow is radio light (1.3 mm) and has no visible color. The clumps are illustrative; they circle with the gas as time runs.';

/** Thin disk shown only during recorded outbursts, for V404 Cygni and A0620-00. */
const outburstDisk = (
  inclinationDeg: number,
  inclinationSource: Cite,
  outbursts: Array<{ from: string; to: string; name: string; text: string; source: Cite }>,
): DiskDef => {
  const when = outbursts.map((o) => o.text).join(' and ');
  return {
    kind: 'thin',
    inclinationDeg,
    inclinationSource,
    rInRs: 3,
    rOutRs: 40,
    active: outbursts.map(({ from, to, name }) => ({ from, to, name })),
    facts: [
      { label: 'Orbit tilt to our line of sight', value: `${inclinationDeg}°`, kind: 'measured', source: inclinationSource },
      ...outbursts.map((o): InfoFact => ({ label: `${o.from.slice(0, 4)} outburst`, value: o.text, kind: 'measured', source: o.source })),
    ],
    notes: [
      {
        text: `A disk is drawn only during its recorded outbursts (${when}); between them the inner disk is faint and cut off, so none is shown. When shown, it is a thin disk from the innermost stable orbit of a non-spinning hole (3 r_s) to 40 r_s, with its light bent, Doppler-boosted and redshifted exactly. The disk's tilt is measured; which way it leans on the sky and which way it turns are not, so those are chosen.`,
        kind: 'model',
      },
      { text: THIN_ARTISTIC, kind: 'artistic' },
    ],
  };
};

export const BLACK_HOLES: readonly BlackHoleDef[] = [
  {
    id: 'bh-sgr-a-star',
    name: 'Sagittarius A*',
    aliases: ['Sgr A*', 'Sgr A star', 'Galactic Center black hole', 'Milky Way black hole'],
    cls: 'supermassive',
    rank: 1,
    where: 'Center of the Milky Way',
    mass: { msun: 4.152e6, text: '4.152 ± 0.014 million Suns', source: GRAVITY19 },
    placement: { type: 'host', host: 'milky-way' },
    published: { ra: 266.41681662, dec: -29.00782497 },
    hostFactLabel: 'Central black hole',
    facts: [
      { label: 'Ring diameter (EHT image)', value: '51.8 ± 2.3 μas', kind: 'measured', source: EHT22 },
      { label: 'First image', value: '12 May 2022, Event Horizon Telescope', kind: 'measured', source: EHT22 },
    ],
    note: 'The black hole at the center of our galaxy. Its mass comes from the orbits of stars that swing around it, such as S2.',
    disk: {
      kind: 'thick',
      inclinationDeg: 30,
      inclinationSource: EHT22_V,
      rInRs: 1,
      rOutRs: 10,
      facts: [{ label: 'Glowing flow', value: 'Favored within 30° of face-on; most views past 50° ruled out', kind: 'measured', source: EHT22_V }],
      notes: [
        {
          text: 'The glow is drawn as a hot, thick, see-through flow of gas circling the hole, with its light bent, Doppler-boosted and redshifted exactly, so the bright ring and the shadow inside it appear on their own. The tilt uses the upper end of what the Event Horizon Telescope allows (30°); which way the axis leans on the sky and which way the gas turns are not measured, so those are chosen.',
          kind: 'model',
        },
        { text: EHT_ARTISTIC, kind: 'artistic' },
      ],
    },
  },
  {
    id: 'bh-m87',
    name: 'M87*',
    aliases: ['Pōwehi', 'Powehi', 'M87 black hole', 'Messier 87 black hole'],
    cls: 'supermassive',
    rank: 1,
    where: 'Galaxy M87, Virgo Cluster',
    mass: { msun: 6.5e9, text: '6.5 ± 0.7 billion Suns', source: EHT19_VI, atDistMpc: 16.8 },
    placement: { type: 'host', host: 'virgo-cluster' },
    published: { ra: 187.70593076725, dec: 12.39112324608 },
    hostFactLabel: 'Black hole in M87',
    facts: [
      { label: 'Ring diameter (EHT image)', value: '42 ± 3 μas', kind: 'measured', source: EHT19_I },
      { label: 'First image', value: '10 April 2019, the first picture of a black hole', kind: 'measured', source: EHT19_I },
    ],
    note: 'The first black hole ever photographed, at the heart of the giant elliptical galaxy M87. It launches a jet of particles moving at nearly the speed of light.',
    disk: {
      kind: 'thick',
      inclinationDeg: 17,
      inclinationSource: WALKER18,
      axisPaDeg: 288,
      axisAway: true,
      rInRs: 1,
      rOutRs: 10,
      facts: [
        { label: 'Jet tilt', value: '17° from our line of sight', kind: 'measured', source: WALKER18 },
        { label: 'Glowing gas', value: 'Turns clockwise on the sky; the jet points west-northwest (288°)', kind: 'measured', source: EHT19_V },
      ],
      notes: [
        {
          text: 'The glow is drawn as a hot, thick, see-through flow of gas circling the hole, its axis along the jet and turning clockwise as the Event Horizon Telescope found. Its light is bent, Doppler-boosted and redshifted exactly, so the bright ring, its brighter south side and the shadow appear on their own. The jet itself is not drawn.',
          kind: 'model',
        },
        { text: EHT_ARTISTIC, kind: 'artistic' },
      ],
    },
  },
  {
    id: 'bh-cyg-x-1',
    name: 'Cygnus X-1',
    aliases: ['Cyg X-1', 'HDE 226868 black hole'],
    cls: 'stellar',
    rank: 1,
    where: 'Cygnus',
    mass: { msun: 21.2, text: '21.2 ± 2.2 Suns', source: MJ21 },
    placement: { type: 'companion', hip: 98298 },
    distance: { text: '2.22 (+0.18 / −0.17) kpc (7,200 light-years)', source: MJ21 },
    published: { ra: 299.59031556498, dec: 35.20160680908 },
    binary: {
      companion: 'HD 226868, a blue supergiant of 40.6 (+7.7 / −7.1) Suns',
      companionMsun: 40.6,
      periodDays: 5.599829,
      source: MJ21,
      periodSource: BROCKSOPP99,
      companionRsun: 22.3,
      companionTeff: 31_100,
    },
    facts: [
      { label: 'Spin', value: 'near the maximum, a* > 0.9985', kind: 'measured', source: ZHAO21 },
      { label: 'Found', value: '1972, from the orbit of its companion star', kind: 'measured', source: WEBSTER72 },
      { label: 'Found independently', value: 'Bolton 1972', kind: 'measured', source: BOLTON72 },
    ],
    note: 'The first object widely accepted to be a black hole. Gas pulled from its blue supergiant companion heats up as it falls in and glows in X-rays.',
    disk: {
      kind: 'thin',
      inclinationDeg: 27.51,
      inclinationSource: MJ21,
      rInRs: 3,
      rOutRs: 40,
      tInnerK: 6e6,
      facts: [
        { label: 'Accretion disk', value: 'Fed by its supergiant’s wind; tilted 27.5° to our line of sight', kind: 'measured', source: MJ21 },
        { label: 'Inner disk temperature', value: '≈ 6 million K (0.5 keV), shining in X-rays', kind: 'measured', source: GOU11 },
      ],
      notes: [
        {
          text: 'Drawn as a thin disk from the innermost stable orbit of a non-spinning hole (3 r_s) to 40 r_s, with its light bent, Doppler-boosted and redshifted exactly. The real disk reaches much farther but is far dimmer there, and Cygnus X-1 spins so fast that its inner edge sits closer in. The disk’s tilt is measured; which way it leans on the sky is not, so that is chosen.',
          kind: 'model',
        },
        { text: THIN_ARTISTIC, kind: 'artistic' },
      ],
    },
  },
  {
    id: 'bh-gaia-bh1',
    name: 'Gaia BH1',
    aliases: ['Gaia DR3 4373465352415301632'],
    cls: 'stellar',
    rank: 2,
    where: 'Ophiuchus',
    mass: { msun: 9.62, text: '9.62 ± 0.18 Suns', source: ELB23A },
    placement: { type: 'sky', ra: 262.1712358858566, dec: -0.5809787160997, distPc: 477 },
    distance: { text: '477 ± 4 pc (1,560 light-years)', source: ELB23A },
    published: { ra: 262.1712358858566, dec: -0.5809787160997 },
    binary: { companion: 'a Sun-like star of 0.93 Suns', companionMsun: 0.93, periodDays: 185.59, source: ELB23A },
    facts: [],
    note: 'The nearest known black hole. It is dormant: its Sun-like companion orbits too far away to feed it, and Gaia found it only from the wobble of that star.',
  },
  {
    id: 'bh-gaia-bh2',
    name: 'Gaia BH2',
    aliases: ['Gaia DR3 5870569352746779008'],
    cls: 'stellar',
    rank: 2,
    where: 'Centaurus',
    mass: { msun: 8.94, text: '8.94 ± 0.34 Suns', source: ELB23B },
    placement: { type: 'sky', ra: 207.5697823340767, dec: -59.23898075029, distPc: 1160 },
    distance: { text: '1.16 ± 0.02 kpc (3,800 light-years)', source: ELB23B },
    published: { ra: 207.5697823340767, dec: -59.23898075029 },
    binary: { companion: 'a red giant of 1.07 Suns', companionMsun: 1.07, periodDays: 1276.7, source: ELB23B },
    facts: [],
    note: 'A dormant black hole circled by a red giant every three and a half years, found from the giant’s wobble in Gaia data.',
  },
  {
    id: 'bh-gaia-bh3',
    name: 'Gaia BH3',
    aliases: ['Gaia DR3 4318465066420528000'],
    cls: 'stellar',
    rank: 2,
    where: 'Aquila',
    mass: { msun: 32.7, text: '32.70 ± 0.82 Suns', source: PANUZZO24 },
    placement: { type: 'sky', ra: 294.82796478104, dec: 14.93166971992, distPc: 590.6 },
    distance: { text: '590.6 ± 5.8 pc (1,930 light-years)', source: PANUZZO24 },
    published: { ra: 294.82796478104, dec: 14.93166971992 },
    binary: { companion: 'an old, metal-poor giant of 0.76 Suns', companionMsun: 0.76, periodDays: 4253.1, source: PANUZZO24 },
    facts: [],
    note: 'The most massive stellar black hole known in our galaxy, found in 2024 in Gaia data from the orbit of an ancient companion star.',
  },
  {
    id: 'bh-v404-cyg',
    name: 'V404 Cygni',
    aliases: ['V404 Cyg', 'GS 2023+338'],
    cls: 'stellar',
    rank: 2,
    where: 'Cygnus',
    mass: { msun: 9.0, text: '9.0 (+0.2 / −0.6) Suns', source: KHARGHARIA10 },
    placement: { type: 'sky', ra: 306.0159362655975, dec: 33.8672114319058, distPc: 2390 },
    distance: { text: '2.39 ± 0.14 kpc (7,800 light-years)', source: MJ09 },
    published: { ra: 306.0159362655975, dec: 33.8672114319058 },
    binary: { companion: 'a cool subgiant star', periodDays: 6.473, source: CASARES92 },
    facts: [{ label: 'Distance method', value: 'Radio parallax, the first measured for a black hole', kind: 'measured', source: MJ09 }],
    note: 'A black hole that bursts into X-ray outbursts decades apart, most recently in 2015, as it swallows gas from its companion.',
    disk: outburstDisk(67, KHARGHARIA10, [
      { from: '1989-05-22', to: '1989-11-01', name: 'V404 Cygni erupts in X-rays', text: 'May to October 1989', source: CORBEL08 },
      { from: '2015-06-15', to: '2015-08-05', name: 'V404 Cygni erupts again', text: '15 June to early August 2015', source: PLOTKIN17 },
    ]),
  },
  {
    id: 'bh-a0620-00',
    name: 'A0620-00',
    aliases: ['V616 Mon', 'V616 Monocerotis', 'Nova Monocerotis 1975', '1A 0620-00'],
    cls: 'stellar',
    rank: 2,
    where: 'Monoceros',
    mass: { msun: 6.61, text: '6.61 ± 0.25 Suns', source: CANTRELL10 },
    placement: { type: 'sky', ra: 95.68559327388, dec: -0.34563623904, distPc: 1060 },
    distance: { text: '1.06 ± 0.12 kpc (3,500 light-years)', source: CANTRELL10 },
    published: { ra: 95.68559327388, dec: -0.34563623904 },
    binary: { companion: 'an orange dwarf star', periodDays: 0.323016, source: CANTRELL10 },
    facts: [{ label: 'Shown to be a black hole', value: '1986, from its companion’s orbit', kind: 'measured', source: MCCLINTOCK86 }],
    note: 'One of the nearest known black holes. It flared as a bright X-ray nova in 1975 and has been quiet since.',
    disk: outburstDisk(50.98, CANTRELL10, [
      { from: '1975-08-03', to: '1976-03-15', name: 'A0620-00 flares as an X-ray nova', text: '3 August 1975 to mid-March 1976', source: KALUZIENSKI77 },
    ]),
  },
  {
    id: 'bh-m31',
    name: 'M31*',
    aliases: ['Andromeda black hole', 'Andromeda Galaxy black hole'],
    cls: 'supermassive',
    rank: 2,
    where: 'Andromeda Galaxy',
    mass: { msun: 1.4e8, text: '140 (+90 / −30) million Suns', source: BENDER05, atDistMpc: 0.76 },
    placement: { type: 'host', host: 'gal-MESSIER031' },
    published: { ra: 10.684708, dec: 41.26875 },
    facts: [],
    note: 'The black hole at the heart of the Andromeda Galaxy, at the center of a small disk of young blue stars.',
  },
  {
    id: 'bh-m32',
    name: 'M32*',
    aliases: ['M32 black hole'],
    cls: 'supermassive',
    rank: 2,
    where: 'Galaxy M32',
    mass: { msun: 2.4e6, text: '2.4 ± 1.0 million Suns', source: VDB10, atDistMpc: 0.79 },
    placement: { type: 'host', host: 'gal-MESSIER032' },
    published: { ra: 10.67427, dec: 40.86517 },
    facts: [],
    note: 'The black hole in M32, a compact satellite galaxy of Andromeda. It has a little over half the mass of the Milky Way’s.',
  },
  {
    id: 'bh-m81',
    name: 'M81*',
    aliases: ["Bode's Galaxy black hole", 'M81 black hole'],
    cls: 'supermassive',
    rank: 2,
    where: "Bode's Galaxy",
    mass: { msun: 7e7, text: '70 million Suns (gas disk)', source: DEVEREUX03 },
    placement: { type: 'host', host: 'gal-MESSIER081' },
    published: { ra: 148.88821939854, dec: 69.06529514038 },
    facts: [{ label: 'Newer estimate (stars, JWST)', value: '47.8 (+0.7 / −1.0) million Suns, not yet peer reviewed', kind: 'measured', source: NGUYEN26 }],
    note: 'The black hole at the center of Bode’s Galaxy, a faintly active nucleus.',
  },
  {
    id: 'bh-ngc4258',
    name: 'M106*',
    aliases: ['NGC 4258 black hole', 'M106 black hole'],
    cls: 'supermassive',
    rank: 2,
    where: 'Galaxy M106',
    mass: { msun: 4.0e7, text: '40.0 ± 0.9 million Suns', source: HUMPHREYS13, atDistMpc: 7.6 },
    placement: { type: 'host', host: 'gal-NGC4258' },
    published: { ra: 184.740083, dec: 47.303719 },
    facts: [{ label: 'Weighed with', value: 'Water masers orbiting in a thin disk', kind: 'measured', source: HUMPHREYS13 }],
    note: 'Radio telescopes track water masers in a gas disk around it, giving one of the most precise black hole masses and distances known.',
  },
  {
    id: 'bh-cen-a',
    name: 'Centaurus A*',
    aliases: ['Cen A black hole', 'Centaurus A black hole', 'NGC 5128 black hole'],
    cls: 'supermassive',
    rank: 2,
    where: 'Centaurus A',
    mass: { msun: 5.5e7, text: '55 ± 30 million Suns (3σ)', source: CAPPELLARI09, atDistMpc: 3.5 },
    placement: { type: 'host', host: 'gal-NGC5128' },
    published: { ra: 201.36506337683, dec: -43.01911250808 },
    facts: [],
    note: 'The engine of the nearest radio galaxy, whose jets and lobes stretch far beyond the visible galaxy.',
  },
  {
    id: 'bh-m104',
    name: 'M104*',
    aliases: ['Sombrero black hole', 'Sombrero Galaxy black hole'],
    cls: 'supermassive',
    rank: 2,
    where: 'Sombrero Galaxy',
    mass: { msun: 6.6e8, text: '660 ± 40 million Suns', source: JARDEL11, atDistMpc: 9.8 },
    placement: { type: 'host', host: 'gal-NGC4594' },
    published: { ra: 189.99763274592, dec: -11.62305449444 },
    facts: [],
    note: 'One of the heaviest black holes in the nearby universe, at the center of the Sombrero Galaxy’s bright bulge.',
  },
  {
    id: 'bh-circinus',
    name: 'Circinus*',
    aliases: ['Circinus black hole', 'Circinus Galaxy black hole'],
    cls: 'supermassive',
    rank: 2,
    where: 'Circinus Galaxy',
    mass: { msun: 1.7e6, text: '1.7 ± 0.3 million Suns', source: GREENHILL03, atDistMpc: 4.2 },
    placement: { type: 'host', host: 'gal-CIRCINUS' },
    published: { ra: 213.291275, dec: -65.339019 },
    facts: [{ label: 'Weighed with', value: 'Water masers orbiting in a warped disk', kind: 'measured', source: GREENHILL03 }],
    note: 'An actively feeding black hole in a galaxy hidden behind the Milky Way’s disk.',
  },
];

export const BLACK_HOLE_BY_ID = new Map(BLACK_HOLES.map((b) => [b.id, b]));

/** "4.15 million Suns", "21.2 Suns". */
export function formatSolarMasses(m: number): string {
  const f = (x: number) => x.toLocaleString('en-US', { maximumSignificantDigits: 3 });
  if (m >= 1e9) return `${f(m / 1e9)} billion Suns`;
  if (m >= 1e6) return `${f(m / 1e6)} million Suns`;
  return `${f(m)} Suns`;
}

/** Info-card fact for a galaxy (or the Virgo Cluster) that hosts one of our black holes. */
export function centralBlackHoleFact(hostId: string): InfoFact | undefined {
  const b = BLACK_HOLES.find((x) => x.placement.type === 'host' && x.placement.host === hostId);
  if (!b) return undefined;
  return { label: b.hostFactLabel ?? 'Central black hole', value: `${b.name} · ${formatSolarMasses(b.mass.msun)}`, kind: 'measured', source: b.mass.source };
}


// Spacecraft for the timeline's historic missions that have no flown trajectory
// on file: JPL Horizons carries none for Sputnik 1 or the Apollo command
// modules, and its Hubble ephemeris starts the day after launch. Their orbits
// are two-body ellipses built from published numbers; landers sit at their
// landing sites. Times are UTC.
//
// Apollo: burn times and orbits from Apollo by the Numbers (NASA SP-2000-4029,
// from the mission reports). Both flew near-equatorial retrograde orbits over
// the landing site region, heading west across the near side. The plane passes
// over Tranquility Base; the craft's place along it is pinned to a documented
// event (the far-side insertion burn, or Apollo 11's descent orbit insertion,
// half a lunar orbit before powered descent and ~15° east of the site), so where
// it is along the orbit is good to a few degrees, not exact.

import * as A from 'astronomy-engine';
import { orientationMatrix } from '../astro/orientation.ts';
import { EARTH_J2, EARTH_RADIUS_EQ, fitAlongTrack, latLonDir, phaseTo, normalThrough, orbitFromApsides, orbitFromState, orbitPosition, type Oblateness, type Orbit } from '../astro/orbit.ts';
import { cross, mat3Apply, normalize, rotateAxisAngle, type Mat3, type Vec3 } from '../astro/vec.ts';
import { DEG, KM } from '../astro/units.ts';
import { BODY_BY_ID, meanRadius } from './catalog.ts';
import type { CraftDef } from './layers/spacecraft.ts';

const NMI = 1852;
const ms = (iso: string) => Date.parse(iso);
const orient = (id: 'earth' | 'moon', t: number): Mat3 =>
  orientationMatrix(id === 'earth' ? { type: 'earth' } : { type: 'iau', body: A.Body.Moon }, A.MakeTime(new Date(t)));

const SP4029 = { name: 'Apollo by the Numbers (NASA SP-2000-4029)', url: 'https://www.nasa.gov/wp-content/uploads/2023/04/sp-4029.pdf' };

/** Tranquility Base, from LRO imagery (planetocentric). */
export const TRANQUILITY_BASE = { lat: 0.67408, lon: 23.47297 };

type Segment = { orbit: Orbit; fromMs: number };

// ---- lunar orbits -------------------------------------------------------------------

type Periapsis =
  /** On the far side, under the Earth–Moon line, at time `at`. */
  | { farSide: string }
  /** Where the previous orbit is at this segment's start (the burn point). */
  | { continue: true }
  /** At time `at`, `aheadDeg` of orbit past the site (negative: still approaching it). */
  | { at: string; site: { lat: number; lon: number }; aheadDeg: number };

interface LunarPhase {
  from: string;
  periNmi: number;
  apoNmi: number;
  peri: Periapsis;
}

function lunarOrbits(incDeg: number, planeEpoch: string, phases: LunarPhase[]): Segment[] {
  const moon = BODY_BY_ID.get('moon')!;
  const R = meanRadius(moon);
  const h = mat3Apply(orient('moon', ms(planeEpoch)), normalThrough(TRANQUILITY_BASE.lat, TRANQUILITY_BASE.lon, incDeg));
  const out: Segment[] = [];
  for (const ph of phases) {
    let t: number;
    let dir: Vec3;
    if ('farSide' in ph.peri) {
      t = ms(ph.peri.farSide);
      const g = A.GeoMoon(new Date(t));
      dir = normalize([g.x, g.y, g.z]);
    } else if ('continue' in ph.peri) {
      t = ms(ph.from);
      dir = normalize(orbitPosition(out[out.length - 1].orbit, t));
    } else {
      t = ms(ph.peri.at);
      const site = mat3Apply(orient('moon', t), latLonDir(ph.peri.site.lat, ph.peri.site.lon));
      // Into the plane, then along the direction of motion.
      const inPlane = normalize(cross(cross(h, site), h));
      dir = rotateAxisAngle(inPlane, h, ph.peri.aheadDeg * DEG);
    }
    out.push({ fromMs: ms(ph.from), orbit: orbitFromApsides(moon.gm, R + ph.periNmi * NMI, R + ph.apoNmi * NMI, h, dir, t) });
  }
  return out;
}

// ---- Earth orbits -------------------------------------------------------------------

function earthJ2(t: number): Oblateness {
  const m = orient('earth', t);
  return { j2: EARTH_J2, radius: EARTH_RADIUS_EQ, pole: [m[2], m[5], m[8]] };
}

/**
 * An orbit entered straight from the launch site: the plane is the one with this
 * inclination passing over the pad northbound at liftoff, perigee over the pad.
 */
function fromLaunch(launch: string, pad: { lat: number; lon: number }, incDeg: number, periKm: number, apoKm: number): Segment[] {
  const t = ms(launch);
  const m = orient('earth', t);
  const h = mat3Apply(m, normalThrough(pad.lat, pad.lon, incDeg));
  const dir = mat3Apply(m, latLonDir(pad.lat, pad.lon));
  const earth = BODY_BY_ID.get('earth')!;
  return [{ fromMs: t, orbit: orbitFromApsides(earth.gm, EARTH_RADIUS_EQ + periKm * KM, EARTH_RADIUS_EQ + apoKm * KM, h, dir, t, earthJ2(t)) }];
}

/** Hubble in JPL Horizons (target -48, geocentric ICRF): its first day of data, and where it was a day later. */
const HUBBLE_STATE = {
  ms: ms('1990-04-25T03:00:00Z'),
  posKm: [1942.648769672508, -6015.027998143362, 2990.508823071727] as Vec3,
  velKmS: [6.754758524847169, 2.976917153652106, 1.59723164696543] as Vec3,
};
const HUBBLE_NEXT_DAY = { ms: ms('1990-04-26T03:00:00Z'), posKm: [-3884.569555660531, -5732.376473312674, 971.3669270139226] as Vec3 };

// ---- the craft ----------------------------------------------------------------------

const LUNAR_FADE: [number, number] = [2e8, 2e9];
const LOW_EARTH_FADE: [number, number] = [2e8, 2e9];
const LOW_EARTH_TRAIL = { body: 'earth', within: 1e8 };

export const MISSION_CRAFT: CraftDef[] = [
  {
    id: 'sputnik-1',
    name: 'Sputnik 1',
    center: 'earth',
    launched: '1957-10-04',
    // Its radio fell silent on 26 October; it reentered on 4 January 1958.
    active: ['1957-10-04T19:28:34Z', '1957-10-26T00:00:00Z'],
    framing: 7e6,
    color: 0xffffff,
    facts: [
      { label: 'Launched', value: '4 October 1957, 19:28 UTC, from Baikonur' },
      { label: 'Orbit', value: '215 × 939 km, inclined 65.1°, 96.2 minutes' },
      { label: 'Transmitted until', value: '26 October 1957' },
    ],
    source: { name: 'NASA NSSDCA: Sputnik 1', url: 'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1957-001B' },
    summary: 'The first artificial satellite, a 58 cm sphere whose radio beeps were heard around the world.',
    model:
      'Orbit modeled from its published size and inclination, entered over Baikonur at liftoff, with the node and perigee turned by Earth’s oblateness; its plane is close, its place along the orbit approximate.',
    orbits: () => fromLaunch('1957-10-04T19:28:34Z', { lat: 45.92, lon: 63.342 }, 65.1, 215, 939),
    fade: LOW_EARTH_FADE,
    trail: LOW_EARTH_TRAIL,
    lowOrbit: true,
  },
  {
    id: 'apollo-8',
    name: 'Apollo 8',
    center: 'moon',
    launched: '1968-12-21',
    // Lunar orbit insertion to trans-Earth injection.
    active: ['1968-12-24T09:59:20Z', '1968-12-25T06:10:17Z'],
    framing: 2.5e6,
    color: 0xffffff,
    aliases: ['Borman', 'Lovell', 'Anders', 'Earthrise'],
    facts: [
      { label: 'Crew', value: 'Frank Borman, Jim Lovell, Bill Anders' },
      { label: 'Lunar orbit insertion', value: '24 December 1968, 09:59 UTC, behind the Moon' },
      { label: 'Orbits', value: '10 in 20 hours; 168.5 × 60.0 nmi, then 60.7 × 59.7 nmi' },
      { label: 'Left lunar orbit', value: '25 December 1968, 06:10 UTC' },
    ],
    source: SP4029,
    summary: 'The first crewed spacecraft to leave Earth orbit and circle the Moon.',
    model:
      'Orbit modeled from the mission report’s burns and orbits, inclined 12° and retrograde over the Apollo landing sites; its place along the orbit is approximate. The Earth–Moon legs are not shown.',
    orbits: () =>
      lunarOrbits(180 - 12, '1968-12-24T09:59:20Z', [
        { from: '1968-12-24T09:59:20Z', periNmi: 60.0, apoNmi: 168.5, peri: { farSide: '1968-12-24T10:01:24Z' } },
        { from: '1968-12-24T14:26:11Z', periNmi: 59.7, apoNmi: 60.7, peri: { continue: true } },
      ]),
    fade: LUNAR_FADE,
    trail: { body: 'moon', within: 5e7 },
    lowOrbit: true,
  },
  {
    id: 'apollo-11-columbia',
    name: 'Apollo 11 Columbia',
    center: 'moon',
    launched: '1969-07-16',
    active: ['1969-07-19T17:21:50Z', '1969-07-22T04:55:42Z'],
    framing: 2.5e6,
    color: 0xffffff,
    aliases: ['Columbia', 'Michael Collins', 'Apollo 11 command module'],
    facts: [
      { label: 'Command module pilot', value: 'Michael Collins' },
      { label: 'Lunar orbit insertion', value: '19 July 1969, 17:21 UTC' },
      { label: 'Orbit while Eagle was down', value: '63.7 × 56.0 nmi' },
      { label: 'Left lunar orbit', value: '22 July 1969, 04:55 UTC' },
    ],
    source: SP4029,
    summary: 'The command module that stayed in lunar orbit while Eagle landed.',
    model:
      'Orbit modeled from the mission report’s burns and orbits, 1.25° from the lunar equator and retrograde over Tranquility Base; its place along the orbit is approximate. The Earth–Moon legs are not shown.',
    orbits: () =>
      lunarOrbits(180 - 1.25, '1969-07-20T20:17:40Z', [
        { from: '1969-07-19T17:21:50Z', periNmi: 60.0, apoNmi: 169.7, peri: { farSide: '1969-07-19T17:24:49Z' } },
        { from: '1969-07-19T21:43:45Z', periNmi: 54.5, apoNmi: 66.1, peri: { continue: true } },
        // Undocked: descent orbit insertion at 19:08:14 was half an orbit before
        // powered descent, which began ~15° east of the site.
        { from: '1969-07-20T18:11:57Z', periNmi: 56.0, apoNmi: 63.7, peri: { at: '1969-07-20T19:08:14Z', site: TRANQUILITY_BASE, aheadDeg: -195 } },
      ]),
    fade: LUNAR_FADE,
    trail: { body: 'moon', within: 5e7 },
    lowOrbit: true,
  },
  {
    id: 'apollo-11-eagle',
    name: 'Apollo 11 Eagle',
    center: 'moon',
    launched: '1969-07-16',
    active: ['1969-07-20T20:17:40Z'],
    framing: 0,
    color: 0xffffff,
    aliases: ['Eagle', 'Tranquility Base', 'Armstrong', 'Aldrin', 'Apollo 11 lunar module', 'Moon landing'],
    facts: [
      { label: 'Landed', value: '20 July 1969, 20:17:40 UTC' },
      { label: 'Crew on the surface', value: 'Neil Armstrong, Buzz Aldrin' },
      { label: 'Site', value: '0.674° N, 23.473° E, Mare Tranquillitatis' },
    ],
    source: { name: 'NASA: Apollo 11 mission overview', url: 'https://www.nasa.gov/mission/apollo-11/' },
    summary: 'The first crewed landing on the Moon. Eagle’s descent stage still stands at Tranquility Base.',
    model: 'Marked at Tranquility Base, located in Lunar Reconnaissance Orbiter images. The marker is not to scale.',
    site: TRANQUILITY_BASE,
    fade: LUNAR_FADE,
  },
  {
    id: 'viking-1',
    name: 'Viking 1 lander',
    center: 'mars',
    launched: '1975-08-20',
    active: ['1976-07-20T11:53:06Z'],
    framing: 0,
    color: 0xffffff,
    aliases: ['Viking 1', 'Thomas Mutch Memorial Station', 'Chryse Planitia'],
    facts: [
      { label: 'Landed', value: '20 July 1976, 11:53 UTC' },
      { label: 'Site', value: '22.27° N, 312.05° E, western Chryse Planitia' },
      { label: 'Operated until', value: 'November 1982' },
    ],
    source: { name: 'NASA NSSDCA: Viking 1 Lander', url: 'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1975-075C' },
    summary: 'The first spacecraft to land on Mars and carry out its mission there.',
    model: 'Marked at its landing site (planetocentric). The marker is not to scale.',
    site: { lat: 22.27, lon: 312.05 },
    fade: [2e8, 2e9],
  },
  {
    id: 'curiosity',
    name: 'Curiosity',
    center: 'mars',
    launched: '2011-11-26',
    active: ['2012-08-06T05:17:57Z'],
    framing: 0,
    color: 0xffffff,
    aliases: ['Mars Science Laboratory', 'MSL', 'Bradbury Landing', 'Gale Crater'],
    facts: [
      { label: 'Landed', value: '6 August 2012, 05:17 UTC (spacecraft time)' },
      { label: 'Site', value: 'Bradbury Landing, 4.59° S, 137.44° E, Gale Crater' },
    ],
    source: { name: 'NASA: Mars Science Laboratory', url: 'https://science.nasa.gov/mission/msl-curiosity/' },
    summary: 'A car-sized rover exploring Gale Crater and the slopes of Mount Sharp.',
    model: 'Marked at Bradbury Landing, where it touched down; it has since driven more than 30 km. The marker is not to scale.',
    site: { lat: -4.5895, lon: 137.4417 },
    fade: [2e8, 2e9],
  },
  {
    id: 'hubble',
    name: 'Hubble Space Telescope',
    center: 'earth',
    launched: '1990-04-24',
    // Released from Discovery on 25 April; shown for its first month.
    active: ['1990-04-24T12:33:51Z', '1990-05-24T12:33:51Z'],
    framing: 7e6,
    color: 0xffffff,
    aliases: ['Hubble', 'HST', 'STS-31', 'Discovery'],
    facts: [
      { label: 'Launched', value: '24 April 1990, 12:33 UTC, aboard Discovery (STS-31)' },
      { label: 'Released', value: '25 April 1990' },
      { label: 'Orbit', value: 'about 612 km, inclined 28.5°' },
    ],
    source: { name: 'NASA: Hubble Space Telescope', url: 'https://science.nasa.gov/mission/hubble/' },
    summary: 'The space telescope, carried to orbit in the shuttle’s payload bay and released the next day.',
    model:
      'Orbit fitted to JPL Horizons’ first Hubble positions (25–26 April 1990) and carried forward a month with Earth’s oblateness; before that, the same orbit is placed over the launch pad at liftoff. Shown for its first month only, as drag makes the timing drift.',
    orbits: () => {
      const earth = BODY_BY_ID.get('earth')!;
      const s = HUBBLE_STATE;
      const r: Vec3 = [s.posKm[0] * KM, s.posKm[1] * KM, s.posKm[2] * KM];
      const v: Vec3 = [s.velKmS[0] * KM, s.velKmS[1] * KM, s.velKmS[2] * KM];
      const next = HUBBLE_NEXT_DAY.posKm.map((x) => x * KM) as Vec3;
      const orbit = fitAlongTrack(orbitFromState(earth.gm, r, v, s.ms, earthJ2(s.ms)), next, HUBBLE_NEXT_DAY.ms);
      // Until Horizons picks it up, in the same plane but over the pad at liftoff
      // (the shuttle's ascent and orbit burns aren't modeled).
      const launch = ms('1990-04-24T12:33:51Z');
      const pad = mat3Apply(orient('earth', launch), latLonDir(28.627, -80.621));
      return [
        { fromMs: launch, orbit: phaseTo(orbit, pad, launch) },
        { fromMs: s.ms, orbit },
      ];
    },
    fade: LOW_EARTH_FADE,
    trail: LOW_EARTH_TRAIL,
    lowOrbit: true,
  },
  {
    id: 'cassini',
    name: 'Cassini',
    center: 'saturn',
    launched: '1997-10-15',
    framing: 4e8,
    color: 0xffffff,
    facts: [
      { label: 'Launched', value: '15 October 1997' },
      { label: 'Arrived at Saturn', value: '1 July 2004' },
      { label: 'Final plunge', value: '15 September 2017, signal lost 11:55 UTC at Earth' },
    ],
    source: { name: 'NASA Cassini mission', url: 'https://science.nasa.gov/mission/cassini/' },
    summary: 'Orbited Saturn for 13 years, ending with 22 dives between the planet and its rings.',
    fade: [5e10, 5e11],
    trail: { body: 'saturn', within: 1e10 },
  },
];


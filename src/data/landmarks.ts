// Notable moments marked on the timeline. Clicking one sets the clock to it and
// flies the camera to `target`, a registry id that has a position on that date
// (Voyager 1's and JWST's trajectory tables start after launch, so their
// launches go to Earth). Solar eclipses go to Earth, arriving from the Moon's
// side so the view looks straight down its shadow. Eclipse, transit and
// conjunction times are checked against astronomy-engine in
// tests/factcheck/landmarks.test.ts.

export type LandmarkKind = 'mission' | 'sky' | 'discovery';

export interface Landmark {
  /** UTC milliseconds. */
  ms: number;
  name: string;
  kind: LandmarkKind;
  target: string;
  /** Arrive on the side of `target` facing this object. */
  from?: string;
}

export const KIND_LABEL: Record<LandmarkKind, string> = {
  mission: 'Mission',
  sky: 'Sky event',
  discovery: 'Discovery',
};

/** Marker colors, shared by the timeline and search results. */
export const KIND_COLOR: Record<LandmarkKind, string> = { mission: '#8fb8ff', sky: '#ffc27a', discovery: '#d6c8ff' };

const at = (iso: string, name: string, kind: LandmarkKind, target: string, from?: string): Landmark => ({
  ms: Date.parse(iso),
  name,
  kind,
  target,
  ...(from ? { from } : {}),
});

export const LANDMARKS: readonly Landmark[] = [
  at('1610-01-07T18:00Z', 'Galileo spots the moons of Jupiter', 'discovery', 'jupiter'),
  at('1769-06-03T22:25Z', 'Transit of Venus, timed by Cook', 'sky', 'venus'),
  at('1781-03-13T22:00Z', 'Herschel discovers Uranus', 'discovery', 'uranus'),
  at('1846-09-23T22:00Z', 'Neptune is found', 'discovery', 'neptune'),
  at('1930-02-18T12:00Z', 'Tombaugh discovers Pluto', 'discovery', 'pluto'),
  at('1957-10-04T19:28Z', 'Sputnik 1 launches', 'mission', 'earth'),
  at('1968-12-24T09:59Z', 'Apollo 8 orbits the Moon', 'mission', 'moon'),
  at('1969-07-20T20:17Z', 'Apollo 11 lands on the Moon', 'mission', 'moon'),
  at('1976-07-20T11:53Z', 'Viking 1 lands on Mars', 'mission', 'mars'),
  at('1977-09-05T12:56Z', 'Voyager 1 launches', 'mission', 'earth'),
  at('1989-08-25T03:56Z', 'Voyager 2 flies past Neptune', 'mission', 'voyager-2'),
  at('1990-02-14T04:48Z', 'Voyager 1 takes the Pale Blue Dot', 'mission', 'voyager-1'),
  at('1990-04-24T12:33Z', 'Hubble launches', 'mission', 'earth'),
  at('1994-07-16T20:13Z', 'Comet Shoemaker–Levy 9 hits Jupiter', 'sky', 'jupiter'),
  at('2012-08-06T05:17Z', 'Curiosity lands on Mars', 'mission', 'mars'),
  at('2015-07-14T11:49Z', 'New Horizons flies past Pluto', 'mission', 'new-horizons'),
  at('2017-08-21T18:25Z', 'Total solar eclipse over North America', 'sky', 'earth', 'moon'),
  at('2017-09-15T10:32Z', 'Cassini dives into Saturn', 'mission', 'saturn'),
  at('2020-12-21T18:20Z', 'Jupiter and Saturn in great conjunction', 'sky', 'jupiter'),
  at('2021-12-25T12:20Z', 'JWST launches', 'mission', 'earth'),
  at('2024-04-08T18:17Z', 'Total solar eclipse over North America', 'sky', 'earth', 'moon'),
  at('2027-08-02T10:07Z', 'Total solar eclipse over North Africa', 'sky', 'earth', 'moon'),
  at('2029-04-13T21:46Z', 'Asteroid Apophis passes close to Earth', 'sky', 'earth'),
  at('2032-11-13T08:54Z', 'Transit of Mercury', 'sky', 'mercury'),
  at('2045-08-12T17:42Z', 'Total solar eclipse across the United States', 'sky', 'earth', 'moon'),
  at('2117-12-11T02:48Z', 'Transit of Venus', 'sky', 'venus'),
];

/** The landmark closest to `ms`, if one is within `tol` ms. */
export function nearestLandmark(ms: number, tol: number): Landmark | null {
  let best: Landmark | null = null;
  let bd = tol;
  for (const lm of LANDMARKS) {
    const d = Math.abs(lm.ms - ms);
    if (d <= bd) {
      bd = d;
      best = lm;
    }
  }
  return best;
}

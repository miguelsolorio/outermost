// Spacecraft: markers, labels and flown trajectories from JPL Horizons tables.
// Voyager 1 and 2 are on hyperbolic escape paths, so trails come straight
// from the tables rather than from osculating orbits. Each trail's vertices are
// expressed relative to the craft's current position for float32 precision.

import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { hasTable, tableRange, tableState } from '../../astro/tables.ts';
import { length, normalize, type Vec3 } from '../../astro/vec.ts';
import { AU, KM } from '../../astro/units.ts';
import type { FocusTarget } from '../../engine/camera/controller.ts';
import { rel, type FrameCtx } from '../frame.ts';
import type { ObjectInfo, Provider, SearchEntry } from '../registry.ts';
import type { World } from '../world.ts';
import { Sgp4Orbit } from '../../astro/sgp4.ts';
import bakedTle from '../../../data/baked/iss-tle.json';

/** SGP4 errors grow by roughly a kilometre per day; hide the ISS beyond this. */
const TLE_VALID_DAYS = 14;
const TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE';
const TLE_CACHE_KEY = 'iss-tle-v1';

export interface CraftDef {
  id: string;
  name: string;
  /** Table center: positions are relative to this body. */
  center: 'sun' | 'earth';
  launched: string;
  framing: number;
  color: number;
  facts: Array<{ label: string; value: string }>;
  source: { name: string; url: string };
  summary: string;
  /** Propagated from a two-line element set with SGP4 instead of a Horizons table. */
  sgp4?: boolean;
}

export const CRAFT: CraftDef[] = [
  {
    id: 'iss',
    name: 'International Space Station',
    center: 'earth',
    launched: '1998-11-20',
    framing: 7e6,
    color: 0xffffff,
    facts: [
      { label: 'First module launched', value: '20 November 1998 (Zarya)' },
      { label: 'Continuously crewed since', value: '2 November 2000' },
    ],
    source: { name: 'NASA: Space Station Facts and Figures', url: 'https://www.nasa.gov/international-space-station/space-station-facts-and-figures/' },
    summary: 'A crewed laboratory circling Earth about every 93 minutes.',
    sgp4: true,
  },
  {
    id: 'voyager-1',
    name: 'Voyager 1',
    center: 'sun',
    launched: '1977-09-05',
    framing: 40 * AU,
    color: 0xffd27a,
    facts: [
      { label: 'Launched', value: '5 September 1977' },
      { label: 'Crossed the heliopause', value: '25 August 2012, ~121 AU from the Sun' },
      { label: 'Planets visited', value: 'Jupiter (1979), Saturn (1980)' },
    ],
    source: { name: 'NASA Voyager mission', url: 'https://science.nasa.gov/mission/voyager/' },
    summary: 'The most distant human-made object, now in interstellar space.',
  },
  {
    id: 'voyager-2',
    name: 'Voyager 2',
    center: 'sun',
    launched: '1977-08-20',
    framing: 40 * AU,
    color: 0xffd27a,
    facts: [
      { label: 'Launched', value: '20 August 1977' },
      { label: 'Crossed the heliopause', value: '5 November 2018, ~119 AU from the Sun' },
      { label: 'Planets visited', value: 'Jupiter, Saturn, Uranus (1986), Neptune (1989)' },
    ],
    source: { name: 'NASA Voyager mission', url: 'https://science.nasa.gov/mission/voyager/' },
    summary: 'The only spacecraft to have visited Uranus and Neptune.',
  },
  {
    id: 'new-horizons',
    name: 'New Horizons',
    center: 'sun',
    launched: '2006-01-19',
    framing: 30 * AU,
    color: 0x9fd0ff,
    facts: [
      { label: 'Launched', value: '19 January 2006' },
      { label: 'Pluto flyby', value: '14 July 2015' },
      { label: 'Arrokoth flyby', value: '1 January 2019' },
    ],
    source: { name: 'NASA New Horizons mission', url: 'https://science.nasa.gov/mission/new-horizons/' },
    summary: 'Flew past Pluto and the Kuiper belt object Arrokoth.',
  },
  {
    id: 'jwst',
    name: 'James Webb Space Telescope',
    center: 'earth',
    launched: '2021-12-25',
    framing: 3.2e6 * KM,
    color: 0xffb37a,
    facts: [
      { label: 'Launched', value: '25 December 2021' },
      { label: 'Orbit', value: 'Halo orbit around Sun–Earth L2, ~1.5 million km from Earth' },
    ],
    source: { name: 'NASA Webb mission', url: 'https://science.nasa.gov/mission/webb/' },
    summary: 'The largest space telescope, observing in infrared from Sun–Earth L2.',
  },
];

interface CraftVisual {
  def: CraftDef;
  line: Line2;
  geo: LineGeometry;
  lastBuildJd: number;
  /** Craft offset from its center (m) when the trail was built; the trail's vertices are relative to it. */
  anchor: Vec3;
  pos: Vec3;
  valid: boolean;
}

const JD = (ms: number) => ms / 86_400_000 + 2440587.5;

export class SpacecraftLayer implements Provider {
  readonly group = new THREE.Group();
  private visuals: CraftVisual[] = [];
  private material: LineMaterial;
  private markers: THREE.Points;
  private markerPos = new Float32Array(CRAFT.length * 3);
  private markerAlpha = new Float32Array(CRAFT.length);
  private targets = new Map<string, FocusTarget>();
  iss = new Sgp4Orbit(bakedTle.line1, bakedTle.line2);
  private issSource = `CelesTrak TLE of ${bakedTle.retrieved} (bundled)`;

  constructor(private world: World) {
    this.material = new LineMaterial({ linewidth: 1.2, vertexColors: false, color: 0xffcf8a, transparent: true, opacity: 0.55, depthWrite: false, worldUnits: false });
    for (const def of CRAFT) {
      const geo = new LineGeometry();
      geo.setPositions([0, 0, 0, 0, 0, 0]);
      const line = new Line2(geo, this.material);
      line.frustumCulled = false;
      line.visible = false;
      this.group.add(line);
      this.visuals.push({ def, line, geo, lastBuildJd: NaN, anchor: [0, 0, 0], pos: [0, 0, 0], valid: false });
      this.targets.set(def.id, {
        id: def.id,
        radius: 0,
        // The ISS flies below Earth's closest camera altitude; keep a wider view.
        minAltitude: def.sgp4 ? 2.5e6 : 1e5,
        pos: () => this.visuals.find((v) => v.def.id === def.id)!.pos,
        pole: () => null,
        // Deep-space craft hand off to the Sun well beyond their framing distance, so a trip there stays centered on the craft.
        handoff: def.sgp4 ? [3e7, 3e8] : def.center === 'earth' ? [4e9, 3e10] : [100 * AU, 1000 * AU],
        parent: def.center,
        framing: def.framing,
        // Low-orbit craft: arrive above them, tilted toward the Sun, so the
        // lit Earth fills the background.
        approach: def.sgp4
          ? () => {
              const e = this.world.get('earth').pos;
              const v = this.visuals.find((x) => x.def.id === def.id)!.pos;
              const up = normalize([v[0] - e[0], v[1] - e[1], v[2] - e[2]]);
              const sun = normalize([-e[0], -e[1], -e[2]]);
              const k = sun[0] * up[0] + sun[1] * up[1] + sun[2] * up[2];
              const side = normalize([sun[0] - k * up[0], sun[1] - k * up[1], sun[2] - k * up[2]]);
              return normalize([up[0] * 0.87 + side[0] * 0.5, up[1] * 0.87 + side[1] * 0.5, up[2] * 0.87 + side[2] * 0.5]);
            }
          : undefined,
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.markerPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.markerAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.markers = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          attribute float alpha;
          varying float vAlpha;
          void main() {
            vAlpha = alpha;
            gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
            gl_PointSize = 6.0;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_fragment>
          varying float vAlpha;
          void main() {
            #include <logdepthbuf_fragment>
            vec2 d = gl_PointCoord - 0.5;
            // A small diamond, so spacecraft read differently from bodies.
            float r = abs(d.x) + abs(d.y);
            float a = smoothstep(0.5, 0.35, r) * vAlpha;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vec3(1.0, 0.82, 0.54) * a * 1.6, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.markers.frustumCulled = false;
    this.group.add(this.markers);
  }

  setResolution(w: number, h: number): void {
    this.material.resolution.set(w, h);
  }

  update(ctx: FrameCtx): void {
    const jd = JD(ctx.world.ms);
    const jdTdb = ctx.world.time.tt + 2451545.0;
    this.visuals.forEach((v, i) => {
      const center = ctx.world.get(v.def.center).pos;
      const s = v.def.sgp4 ? this.sgp4State(ctx.world.ms) : hasTable(v.def.id) ? tableState(v.def.id, jdTdb) : null;
      v.valid = !!s;
      if (!s) {
        v.line.visible = false;
        this.markerAlpha[i] = 0;
        return;
      }
      v.pos = [center[0] + s.pos[0] * 1e3, center[1] + s.pos[1] * 1e3, center[2] + s.pos[2] * 1e3];
      const p = rel(v.pos, ctx.cam);
      this.markerPos.set(p, i * 3);
      // Hide Earth's JWST once we're far out in the solar system, and the
      // outer-system craft once we're among the stars.
      const d = length(p);
      const fade = v.def.sgp4
        ? 1 - THREE.MathUtils.smoothstep(d, 2e8, 2e9)
        : v.def.center === 'earth'
          ? 1 - THREE.MathUtils.smoothstep(d, 5e9, 5e10)
          : 1 - THREE.MathUtils.smoothstep(d, 2000 * AU, 20000 * AU);
      this.markerAlpha[i] = fade;
      // Rebuild the trail when time has moved (relative to the craft's position).
      if (v.def.sgp4) {
        if (!(Math.abs(jd - v.lastBuildJd) < 20 / 86400)) this.buildOrbit(v, ctx);
      } else if (!(Math.abs(jd - v.lastBuildJd) < 0.5)) this.buildTrail(v, jdTdb, ctx);
      // Pin the trail where it was built rather than to the moving craft, so it
      // stays put between rebuilds instead of sliding along and snapping back.
      const a = rel([center[0] + v.anchor[0], center[1] + v.anchor[1], center[2] + v.anchor[2]], ctx.cam);
      v.line.position.set(a[0], a[1], a[2]);
      // Like planetary orbits, a trail only shows at its own scale (or when the
      // craft is in focus), so paths don't streak across a close planet view.
      const focused = ctx.focusId === v.def.id || ctx.selectedId === v.def.id;
      const atScale = v.def.sgp4 ? ctx.focusBody === 'earth' && ctx.pose.r < 1e8 : v.def.center === 'earth' ? ctx.pose.r > 5e8 : ctx.pose.r > 0.05 * AU;
      v.line.visible = ctx.settings.orbits && fade > 0.02 && (focused || atScale);
    });
    (this.markers.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.markers.geometry.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }

  /** ISS state from SGP4 (km, relative to Earth), within the TLE's useful span. */
  private sgp4State(ms: number): { pos: Vec3 } | null {
    if (Math.abs(ms - this.iss.epochMs) > TLE_VALID_DAYS * 86_400_000) return null;
    const p = this.iss.position(ms);
    return p ? { pos: p } : null;
  }

  /** One full orbit around the current position (SGP4, Earth-centered inertial). */
  private buildOrbit(v: CraftVisual, ctx: FrameCtx): void {
    const ms = ctx.world.ms;
    const now = this.iss.position(ms);
    if (!now) return;
    const periodMs = this.iss.periodMin * 60_000;
    const pts: number[] = [];
    for (let k = 0; k <= 240; k++) {
      const p = this.iss.position(ms + ((k - 120) / 240) * periodMs);
      if (p) pts.push((p[0] - now[0]) * 1e3, (p[1] - now[1]) * 1e3, (p[2] - now[2]) * 1e3);
    }
    v.geo.dispose();
    v.geo = new LineGeometry();
    v.geo.setPositions(pts);
    v.line.geometry = v.geo;
    v.anchor = [now[0] * 1e3, now[1] * 1e3, now[2] * 1e3];
    v.lastBuildJd = JD(ms);
  }

  /** Fetch a current TLE from CelesTrak (at most every two hours per browser). */
  async refreshTle(): Promise<void> {
    // Automated test browsers start with empty storage every run; CelesTrak
    // blocks clients that download the same elements too often.
    if (navigator.webdriver) return;
    const apply = (l1: string, l2: string, when: string) => {
      const orbit = new Sgp4Orbit(l1, l2);
      if (orbit.epochMs > this.iss.epochMs) {
        this.iss = orbit;
        this.issSource = `CelesTrak TLE fetched ${when}`;
        const v = this.visuals.find((x) => x.def.sgp4);
        if (v) v.lastBuildJd = NaN;
      }
    };
    try {
      const cached = JSON.parse(localStorage.getItem(TLE_CACHE_KEY) ?? 'null') as { l1: string; l2: string; t: number } | null;
      if (cached && Date.now() - cached.t < 2 * 3600_000) return apply(cached.l1, cached.l2, new Date(cached.t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
    } catch {
      // storage unavailable
    }
    try {
      const res = await fetch(TLE_URL);
      if (!res.ok) return;
      const [, l1, l2] = (await res.text()).trim().split('\n').map((x) => x.trim());
      if (!l1?.startsWith('1 25544') || !l2?.startsWith('2 25544')) return;
      apply(l1, l2, new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
      try {
        localStorage.setItem(TLE_CACHE_KEY, JSON.stringify({ l1, l2, t: Date.now() }));
      } catch {
        // storage unavailable
      }
    } catch {
      // offline: keep the bundled TLE
    }
  }

  private buildTrail(v: CraftVisual, jdTdb: number, ctx: FrameCtx): void {
    const range = tableRange(v.def.id)!;
    const now = tableState(v.def.id, jdTdb)!;
    const pts: number[] = [];
    // The JWST trail shows only the last year; the deep-space craft their whole flight.
    const start = v.def.center === 'earth' ? Math.max(range[0], jdTdb - 365) : range[0];
    const n = 900;
    for (let k = 0; k <= n; k++) {
      const jd = start + ((jdTdb - start) * k) / n;
      const s = tableState(v.def.id, jd);
      if (!s) continue;
      // Deep-space trails are drawn heliocentric (the Sun moves little); the
      // JWST trail is Earth-relative so it traces the halo orbit.
      pts.push((s.pos[0] - now.pos[0]) * 1e3, (s.pos[1] - now.pos[1]) * 1e3, (s.pos[2] - now.pos[2]) * 1e3);
    }
    if (pts.length >= 6) {
      v.geo.dispose();
      v.geo = new LineGeometry();
      v.geo.setPositions(pts);
      v.line.geometry = v.geo;
      v.anchor = [now.pos[0] * 1e3, now.pos[1] * 1e3, now.pos[2] * 1e3];
    }
    v.lastBuildJd = JD(ctx.world.ms);
  }

  // ---- registry provider ---------------------------------------------------------

  target(id: string): FocusTarget | undefined {
    const v = this.visuals.find((x) => x.def.id === id);
    return v?.valid ? this.targets.get(id) : undefined;
  }

  info(id: string): ObjectInfo | undefined {
    const v = this.visuals.find((x) => x.def.id === id);
    if (!v) return undefined;
    const d = v.def;
    const facts: ObjectInfo['facts'] = d.facts.map((f) => ({ ...f, kind: 'measured', source: d.source }));
    if (v.valid) {
      const sun = this.world.get('sun').pos;
      const earth = this.world.get('earth').pos;
      const fromSun = length([v.pos[0] - sun[0], v.pos[1] - sun[1], v.pos[2] - sun[2]]);
      const fromEarth = length([v.pos[0] - earth[0], v.pos[1] - earth[1], v.pos[2] - earth[2]]);
      const horizons = d.sgp4
        ? { name: `SGP4 from ${this.issSource}`, url: 'https://celestrak.org/NORAD/elements/' }
        : { name: 'JPL Horizons trajectory', url: 'https://ssd.jpl.nasa.gov/horizons/' };
      if (d.sgp4) {
        const ms = this.world.ms;
        const p0 = this.iss.position(ms);
        const p1 = this.iss.position(ms + 1000);
        if (p0 && p1) {
          // Altitude above the WGS84 ellipsoid is within ~20 km of this spherical value.
          const alt = Math.hypot(...p0) - 6371;
          facts.push({ label: 'Altitude (now, above mean radius)', value: `${Math.round(alt)} km`, kind: 'derived', source: horizons });
          facts.push({ label: 'Speed (now)', value: `${Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).toFixed(2)} km/s`, kind: 'derived', source: horizons });
          facts.push({ label: 'Orbital period', value: `${this.iss.periodMin.toFixed(1)} minutes`, kind: 'derived', source: horizons });
        }
      }
      if (d.sgp4) {
        // Distance from Earth's center is shown as altitude above.
      } else if (d.center === 'sun') facts.push({ label: 'Distance from the Sun (now)', value: `${(fromSun / AU).toFixed(2)} AU`, kind: 'measured', source: horizons });
      if (!d.sgp4) facts.push({ label: 'Distance from Earth (now)', value: fromEarth > 0.1 * AU ? `${(fromEarth / AU).toFixed(2)} AU` : `${Math.round(fromEarth / 1000).toLocaleString('en-US')} km`, kind: 'measured', source: horizons });
      const lightMin = fromEarth / 299_792_458 / 60;
      if (!d.sgp4) facts.push({ label: 'Radio signal time from Earth', value: lightMin > 90 ? `${(lightMin / 60).toFixed(1)} hours` : `${lightMin.toFixed(1)} minutes`, kind: 'derived', source: horizons });
    }
    return {
      id,
      name: d.name,
      subtitle: `Spacecraft · launched ${d.launched.slice(0, 4)}`,
      facts,
      notes: [
        d.sgp4
          ? { text: `${d.summary} Position from SGP4 and the latest two-line elements (errors grow about 1 km per day), so it is shown only within ${TLE_VALID_DAYS} days of the element epoch. The marker is not to scale.`, kind: 'measured' }
          : { text: `${d.summary} Position from JPL Horizons; the marker is not to scale.`, kind: 'measured' },
      ],
    };
  }

  search(): SearchEntry[] {
    return CRAFT.map((c) => ({ id: c.id, name: c.name, aliases: c.id === 'jwst' ? ['JWST', 'Webb'] : c.id === 'iss' ? ['ISS', 'Space station'] : [], kind: 'Spacecraft', detail: 'Spacecraft', rank: 1 }));
  }

  labels(): Array<{ id: string; name: string; pos: Vec3; alpha: number }> {
    return this.visuals.filter((v) => v.valid).map((v, i) => ({ id: v.def.id, name: v.def.name, pos: v.pos, alpha: this.markerAlpha[this.visuals.indexOf(v)] ?? i }));
  }
}

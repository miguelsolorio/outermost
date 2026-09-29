// Spacecraft: markers, labels and flown trajectories from JPL Horizons tables.
// Voyager 1 and 2 are on hyperbolic escape paths, so trails come straight
// from the tables rather than from osculating orbits. Each trail's vertices are
// expressed relative to the craft's current position for float32 precision.
// Historic missions with no table (src/scene/missions.ts) fly modeled orbits,
// or sit at their landing sites, only during the dates they were there.

import * as A from 'astronomy-engine';
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { hasTable, tableRange, tableState, tableStep } from '../../astro/tables.ts';
import { orbitPosition, period, type Orbit } from '../../astro/orbit.ts';
import { length, mat3Apply, normalize, sub, type Vec3 } from '../../astro/vec.ts';
import { AU, KM } from '../../astro/units.ts';
import type { FocusTarget } from '../../engine/camera/controller.ts';
import { BODY_BY_ID, meanRadius } from '../catalog.ts';
import { rel, type FrameCtx } from '../frame.ts';
import { MISSION_CRAFT } from '../missions.ts';
import { minAltitude } from '../providers/bodies.ts';
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
  /** Positions are relative to this body. */
  center: string;
  launched: string;
  /** Preferred viewing distance (m). Unused for landing sites, which frame their body. */
  framing: number;
  color: number;
  facts: Array<{ label: string; value: string }>;
  source: { name: string; url: string };
  summary: string;
  /** Marker fade by camera distance (m): full inside the first, gone beyond the second. */
  fade: [number, number];
  /**
   * When the path shows (besides when the craft is in focus): with `body` in
   * focus and the camera within `within` of it, or the camera farther than `beyond`.
   */
  trail?: { body?: string; within?: number; beyond?: number };
  /** Circles close to its planet: arrive above it with the lit planet behind. */
  lowOrbit?: boolean;
  /** Propagated from a two-line element set with SGP4 instead of a Horizons table. */
  sgp4?: boolean;
  /** Only there from the first date (UTC) to the second, if given. */
  active?: [string, string?];
  /** Modeled two-body orbits about `center`, each flown from its start. */
  orbits?: () => Array<{ fromMs: number; orbit: Orbit }>;
  /** Fixed on the surface of `center` (planetocentric degrees, east longitude). */
  site?: { lat: number; lon: number };
  /** How the position is modeled, for the info card (replaces the Horizons note). */
  model?: string;
  aliases?: string[];
}

const ESCAPE_FADE: [number, number] = [2000 * AU, 20000 * AU];

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
    lowOrbit: true,
    fade: [2e8, 2e9],
    trail: { body: 'earth', within: 1e8 },
    aliases: ['ISS', 'Space station'],
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
    fade: ESCAPE_FADE,
    trail: { beyond: 0.05 * AU },
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
    fade: ESCAPE_FADE,
    trail: { beyond: 0.05 * AU },
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
    fade: ESCAPE_FADE,
    trail: { beyond: 0.05 * AU },
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
    fade: [5e9, 5e10],
    trail: { beyond: 5e8 },
    aliases: ['JWST', 'Webb'],
  },
  ...MISSION_CRAFT,
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
  /** Offset from the center at `offsetMs`, so targets and the frame loop share one evaluation per time. */
  offset: Vec3 | null;
  offsetMs: number;
  segments?: Array<{ fromMs: number; orbit: Orbit }>;
  window: [number, number];
  /** Offset from the center at the last frame drawn. */
  drawn: Vec3 | null;
}

const JD = (ms: number) => ms / 86_400_000 + 2440587.5;
/** Horizons tables are indexed by TDB (≈ TT) Julian date. */
const jdTdb = (ms: number) => A.MakeTime(new Date(ms)).tt + 2451545.0;
/** Landing-site markers sit this fraction of a radius above the reference surface, clear of the terrain. */
const SITE_LIFT = 0.002;

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
      const window: [number, number] = [def.active ? Date.parse(def.active[0]) : -Infinity, def.active?.[1] ? Date.parse(def.active[1]) : Infinity];
      const v: CraftVisual = { def, line, geo, lastBuildJd: NaN, anchor: [0, 0, 0], pos: [0, 0, 0], valid: false, offset: null, offsetMs: NaN, window, drawn: null };
      this.visuals.push(v);
      this.targets.set(def.id, def.site ? this.siteTarget(v) : this.craftTarget(v));
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

  /** A craft in flight: a point target, handed to its center body when far out. */
  private craftTarget(v: CraftVisual): FocusTarget {
    const def = v.def;
    const R = meanRadius(BODY_BY_ID.get(def.center)!);
    return {
      id: def.id,
      radius: 0,
      // Low-orbit craft fly below their planet's closest camera altitude; keep a wider view.
      minAltitude: def.lowOrbit ? 0.4 * R : 1e5,
      pos: () => this.position(v, this.world.ms) ?? v.pos,
      pole: () => null,
      // Deep-space craft hand off to the Sun well beyond their framing distance, so a trip there stays centered on the craft.
      handoff: def.lowOrbit ? [5 * R, 50 * R] : def.center === 'sun' ? [100 * AU, 1000 * AU] : def.center === 'earth' ? [4e9, 3e10] : [10 * def.framing, 100 * def.framing],
      parent: def.center,
      framing: def.framing,
      // Low-orbit craft: arrive above them, tilted toward the Sun, so the
      // lit planet fills the background.
      approach: def.lowOrbit
        ? () => {
            const e = this.world.get(def.center).pos;
            const p = this.position(v, this.world.ms) ?? v.pos;
            const up = normalize(sub(p, e));
            const sun = normalize([-e[0], -e[1], -e[2]]);
            const k = sun[0] * up[0] + sun[1] * up[1] + sun[2] * up[2];
            const side = normalize([sun[0] - k * up[0], sun[1] - k * up[1], sun[2] - k * up[2]]);
            return normalize([up[0] * 0.87 + side[0] * 0.5, up[1] * 0.87 + side[1] * 0.5, up[2] * 0.87 + side[2] * 0.5]);
          }
        : undefined,
    };
  }

  /**
   * A landing site frames its whole body from straight above the site, so the
   * camera turns around the body (never through it) and the site sits in the
   * middle of the view.
   */
  private siteTarget(v: CraftVisual): FocusTarget {
    const body = BODY_BY_ID.get(v.def.center)!;
    const R = meanRadius(body);
    return {
      id: v.def.id,
      radius: R,
      minAltitude: minAltitude(body),
      pos: () => this.world.get(body.id).pos,
      pole: () => {
        const m = this.world.get(body.id).orient;
        return [m[2], m[5], m[8]];
      },
      // The body itself is the parent (same center), so leaving the site's dates keeps the view on it.
      handoff: [10 * R, 30 * R],
      parent: body.id,
      framing: 3 * R,
      approach: () => normalize(sub(this.position(v, this.world.ms) ?? v.pos, this.world.get(body.id).pos)),
    };
  }

  setResolution(w: number, h: number): void {
    this.material.resolution.set(w, h);
  }

  /** Offset (m) from the center body at `ms`, or null when the craft isn't there then. */
  private offsetAt(v: CraftVisual, ms: number): Vec3 | null {
    if (ms === v.offsetMs) return v.offset;
    const def = v.def;
    let o: Vec3 | null = null;
    if (ms >= v.window[0] && ms <= v.window[1]) {
      if (def.sgp4) {
        const p = this.sgp4State(ms);
        o = p && [p.pos[0] * 1e3, p.pos[1] * 1e3, p.pos[2] * 1e3];
      } else if (def.orbits) {
        const seg = this.segmentAt(v, ms);
        o = seg && orbitPosition(seg, ms);
      } else if (def.site) {
        o = this.siteOffset(v);
      } else if (hasTable(def.id)) {
        const s = tableState(def.id, jdTdb(ms));
        o = s && [s.pos[0] * 1e3, s.pos[1] * 1e3, s.pos[2] * 1e3];
      } else {
        // Its table is still loading: don't remember the miss, or a paused clock
        // would keep the craft missing after the table arrives.
        return null;
      }
    }
    v.offset = o;
    v.offsetMs = ms;
    return o;
  }

  /** Heliocentric position (m) at `ms`, or null. */
  private position(v: CraftVisual, ms: number): Vec3 | null {
    const o = this.offsetAt(v, ms);
    if (!o) return null;
    const c = this.world.get(v.def.center).pos;
    return [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
  }

  private segmentAt(v: CraftVisual, ms: number): Orbit | null {
    v.segments ??= v.def.orbits!();
    let found: Orbit | null = null;
    for (const s of v.segments) if (ms >= s.fromMs) found = s.orbit;
    return found;
  }

  /** The site on its body's surface as the body is turned now (ellipsoid radius, lifted clear of it). */
  private siteOffset(v: CraftVisual): Vec3 {
    const body = BODY_BY_ID.get(v.def.center)!;
    const { lat, lon } = v.def.site!;
    const la = (lat * Math.PI) / 180;
    const lo = (lon * Math.PI) / 180;
    const d: Vec3 = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    const [a, b, c] = body.radii;
    const r = (1 + SITE_LIFT) / Math.hypot(d[0] / a, d[1] / b, d[2] / c);
    const n = mat3Apply(this.world.get(body.id).orient, d);
    return [n[0] * r, n[1] * r, n[2] * r];
  }

  update(ctx: FrameCtx): void {
    const ms = ctx.world.ms;
    const jd = JD(ms);
    this.visuals.forEach((v, i) => {
      const def = v.def;
      // Landing sites turn with their body, so recompute them each frame.
      if (def.site) v.offsetMs = NaN;
      const o = this.offsetAt(v, ms);
      v.valid = !!o;
      v.drawn = o;
      if (!o) {
        v.line.visible = false;
        this.markerAlpha[i] = 0;
        return;
      }
      const center = ctx.world.get(def.center).pos;
      v.pos = [center[0] + o[0], center[1] + o[1], center[2] + o[2]];
      const p = rel(v.pos, ctx.cam);
      this.markerPos.set(p, i * 3);
      // Near-planet craft fade out once we're far out in the solar system, and
      // the outer-system craft once we're among the stars.
      const fade = 1 - THREE.MathUtils.smoothstep(length(p), def.fade[0], def.fade[1]);
      this.markerAlpha[i] = fade;
      if (def.site) {
        v.line.visible = false;
        return;
      }
      // Rebuild the path when time has moved (relative to the craft's position).
      if (def.sgp4 || def.orbits) {
        if (!(Math.abs(jd - v.lastBuildJd) < 20 / 86400)) this.buildOrbit(v, ms);
      } else if (!(Math.abs(jd - v.lastBuildJd) < Math.min(0.5, tableStep(def.id) ?? 0.5))) this.buildTrail(v, ctx.world.time.tt + 2451545.0, ms);
      // Pin the trail where it was built rather than to the moving craft, so it
      // stays put between rebuilds instead of sliding along and snapping back.
      const a = rel([center[0] + v.anchor[0], center[1] + v.anchor[1], center[2] + v.anchor[2]], ctx.cam);
      v.line.position.set(a[0], a[1], a[2]);
      // Like planetary orbits, a trail only shows at its own scale (or when the
      // craft is in focus), so paths don't streak across a close planet view.
      const focused = ctx.focusId === def.id || ctx.selectedId === def.id;
      const t = def.trail;
      const atScale = !!t && ((t.body !== undefined && ctx.focusBody === t.body && ctx.pose.r < (t.within ?? Infinity)) || (t.beyond !== undefined && ctx.pose.r > t.beyond));
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

  /** One full orbit around the current position (SGP4 or a modeled orbit). */
  private buildOrbit(v: CraftVisual, ms: number): void {
    const seg = v.def.orbits ? this.segmentAt(v, ms) : null;
    const at = (t: number): Vec3 | null => {
      if (seg) return orbitPosition(seg, t);
      const p = this.iss.position(t);
      return p && [p[0] * 1e3, p[1] * 1e3, p[2] * 1e3];
    };
    const now = at(ms);
    if (!now) return;
    const periodMs = seg ? period(seg) * 1000 : this.iss.periodMin * 60_000;
    const pts: number[] = [];
    for (let k = 0; k <= 240; k++) {
      const p = at(ms + ((k - 120) / 240) * periodMs);
      if (p) pts.push(p[0] - now[0], p[1] - now[1], p[2] - now[2]);
    }
    v.geo.dispose();
    v.geo = new LineGeometry();
    v.geo.setPositions(pts);
    v.line.geometry = v.geo;
    v.anchor = now;
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
        if (v) {
          v.lastBuildJd = NaN;
          v.offsetMs = NaN;
        }
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

  private buildTrail(v: CraftVisual, jdTdb: number, ms: number): void {
    const range = tableRange(v.def.id)!;
    const now = tableState(v.def.id, jdTdb);
    if (!now) return;
    const pts: number[] = [];
    // The JWST trail shows only the last year; the other craft their whole flight.
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
    v.lastBuildJd = JD(ms);
  }

  // ---- registry provider ---------------------------------------------------------

  target(id: string): FocusTarget | undefined {
    const v = this.visuals.find((x) => x.def.id === id);
    // Evaluated at the world's time rather than from the last frame, so a flight
    // that starts right after a jump in time sees the craft at its new date.
    return v && this.offsetAt(v, this.world.ms) ? this.targets.get(id) : undefined;
  }

  info(id: string): ObjectInfo | undefined {
    const v = this.visuals.find((x) => x.def.id === id);
    if (!v) return undefined;
    const d = v.def;
    const facts: ObjectInfo['facts'] = d.facts.map((f) => ({ ...f, kind: 'measured', source: d.source }));
    const ms = this.world.ms;
    const pos = this.position(v, ms);
    if (pos && !d.site) {
      const earth = this.world.get('earth').pos;
      const fromEarth = length(sub(pos, earth));
      const center = BODY_BY_ID.get(d.center)!;
      const horizons = d.sgp4
        ? { name: `SGP4 from ${this.issSource}`, url: 'https://celestrak.org/NORAD/elements/' }
        : d.orbits
          ? d.source
          : { name: 'JPL Horizons trajectory', url: 'https://ssd.jpl.nasa.gov/horizons/' };
      const kind = d.orbits ? 'model' : d.sgp4 ? 'derived' : 'measured';
      if (d.sgp4 || d.orbits) {
        const p0 = this.offsetAt(v, ms)!;
        const p1 = d.sgp4 ? this.sgp4State(ms + 1000)?.pos.map((x) => x * 1e3) : orbitPosition(this.segmentAt(v, ms)!, ms + 1000);
        const alt = length(p0) - meanRadius(center);
        facts.push({ label: 'Altitude (now, above mean radius)', value: `${Math.round(alt / 1000).toLocaleString('en-US')} km`, kind, source: horizons });
        if (p1) facts.push({ label: 'Speed (now)', value: `${(length(sub(p1 as Vec3, p0)) / 1000).toFixed(2)} km/s`, kind, source: horizons });
        const periodMin = d.sgp4 ? this.iss.periodMin : period(this.segmentAt(v, ms)!) / 60;
        facts.push({ label: 'Orbital period', value: periodMin > 100 ? `${Math.floor(periodMin / 60)} h ${Math.round(periodMin % 60)} min` : `${periodMin.toFixed(1)} minutes`, kind, source: horizons });
      } else {
        const fromCenter = length(sub(pos, this.world.get(d.center).pos));
        if (d.center === 'sun') facts.push({ label: 'Distance from the Sun (now)', value: `${(fromCenter / AU).toFixed(2)} AU`, kind, source: horizons });
        else if (d.center !== 'earth') facts.push({ label: `Altitude above ${center.name} (now)`, value: `${Math.round((fromCenter - meanRadius(center)) / 1000).toLocaleString('en-US')} km`, kind, source: horizons });
      }
      if (d.center !== 'earth') {
        facts.push({ label: 'Distance from Earth (now)', value: fromEarth > 0.1 * AU ? `${(fromEarth / AU).toFixed(2)} AU` : `${Math.round(fromEarth / 1000).toLocaleString('en-US')} km`, kind, source: horizons });
        const lightS = fromEarth / 299_792_458;
        const value = lightS < 60 ? `${lightS.toFixed(1)} seconds` : lightS < 5400 ? `${(lightS / 60).toFixed(1)} minutes` : `${(lightS / 3600).toFixed(1)} hours`;
        facts.push({ label: 'Radio signal time from Earth', value, kind: 'derived', source: horizons });
      } else if (!d.sgp4 && !d.orbits) {
        facts.push({ label: 'Distance from Earth (now)', value: `${Math.round(fromEarth / 1000).toLocaleString('en-US')} km`, kind, source: horizons });
        facts.push({ label: 'Radio signal time from Earth', value: `${(fromEarth / 299_792_458).toFixed(1)} seconds`, kind: 'derived', source: horizons });
      }
    }
    const note = d.model
      ? { text: `${d.summary} ${d.model}`, kind: 'model' as const }
      : d.sgp4
        ? { text: `${d.summary} Position from SGP4 and the latest two-line elements (errors grow about 1 km per day), so it is shown only within ${TLE_VALID_DAYS} days of the element epoch. The marker is not to scale.`, kind: 'measured' as const }
        : { text: `${d.summary} Position from JPL Horizons; the marker is not to scale.`, kind: 'measured' as const };
    return {
      id,
      name: d.name,
      subtitle: d.site ? `${d.id === 'curiosity' ? 'Rover' : 'Lander'} on ${BODY_BY_ID.get(d.center)!.name} · landed ${d.active![0].slice(0, 4)}` : `Spacecraft · launched ${d.launched.slice(0, 4)}`,
      facts,
      notes: [note],
    };
  }

  search(): SearchEntry[] {
    return this.visuals.map((v) => ({
      id: v.def.id,
      name: v.def.name,
      aliases: v.def.aliases ?? [],
      kind: 'Spacecraft',
      detail: v.def.active ? `Spacecraft · ${v.def.active[0].slice(0, 4)}` : 'Spacecraft',
      rank: 1,
      // Only there on some dates: picking it moves the clock there first.
      ...(Number.isFinite(v.window[0]) ? { when: v.window[0] } : {}),
      ...(Number.isFinite(v.window[1]) ? { until: v.window[1] } : {}),
    }));
  }

  /**
   * Where the craft's focus point was, relative to its center body, at the last
   * frame drawn (a landing site's focus is the body's center). Lets the view
   * hand over to the body when the craft leaves, from where it was.
   */
  lastFocusOffset(id: string): Vec3 | null {
    const v = this.visuals.find((x) => x.def.id === id);
    if (!v?.drawn) return null;
    return v.def.site ? [0, 0, 0] : v.drawn;
  }

  /** Where a landing site is (heliocentric m), or null for anything else. */
  sitePosition(id: string): Vec3 | null {
    const v = this.visuals.find((x) => x.def.id === id);
    return v?.def.site && v.valid ? v.pos : null;
  }

  labels(): Array<{ id: string; name: string; pos: Vec3; alpha: number }> {
    return this.visuals.filter((v) => v.valid).map((v) => ({ id: v.def.id, name: v.def.name, pos: v.pos, alpha: this.markerAlpha[this.visuals.indexOf(v)] }));
  }
}

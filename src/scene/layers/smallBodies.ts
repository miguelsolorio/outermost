// About 200,000 real asteroids and trans-Neptunian objects from the JPL
// Small-Body Database. Each point carries its osculating orbital elements; the
// vertex shader advances the mean anomaly to the current time and solves
// Kepler's equation, so the whole population moves correctly as time runs.
// (Two-body motion from one epoch: accurate to a fraction of a degree for
// years around it, which is far below a pixel at the scales these dots show.)
//
// Named objects bright or notable enough to label are also searchable targets.

import * as THREE from 'three';
import { length, type Vec3 } from '../../astro/vec.ts';
import { AU, OBLIQUITY_J2000 } from '../../astro/units.ts';
import { diameterFromH, elementsAt, keplerPosition, parseSmallBodies, type Elements } from '../../astro/kepler.ts';
import type { Assets } from '../../engine/assets.ts';
import type { FocusTarget } from '../../engine/camera/controller.ts';
import { rel, type FrameCtx } from '../frame.ts';
import type { ObjectInfo, Provider, SearchEntry } from '../registry.ts';
import type { World } from '../world.ts';

const CLASS_INFO: Record<string, { name: string; group: 'inner' | 'neo' | 'trojan' | 'outer'; color: [number, number, number] }> = {
  MBA: { name: 'Main-belt asteroid', group: 'inner', color: [0.86, 0.82, 0.74] },
  IMB: { name: 'Inner main-belt asteroid', group: 'inner', color: [0.86, 0.82, 0.74] },
  OMB: { name: 'Outer main-belt asteroid', group: 'inner', color: [0.8, 0.78, 0.74] },
  MCA: { name: 'Mars-crossing asteroid', group: 'inner', color: [1.0, 0.72, 0.5] },
  AMO: { name: 'Near-Earth asteroid (Amor)', group: 'neo', color: [1.0, 0.55, 0.32] },
  APO: { name: 'Near-Earth asteroid (Apollo)', group: 'neo', color: [1.0, 0.5, 0.3] },
  ATE: { name: 'Near-Earth asteroid (Aten)', group: 'neo', color: [1.0, 0.5, 0.3] },
  IEO: { name: 'Near-Earth asteroid (Atira)', group: 'neo', color: [1.0, 0.5, 0.3] },
  TJN: { name: 'Jupiter trojan', group: 'trojan', color: [0.6, 0.9, 0.55] },
  CEN: { name: 'Centaur', group: 'outer', color: [0.8, 0.66, 1.0] },
  TNO: { name: 'Trans-Neptunian object', group: 'outer', color: [0.55, 0.75, 1.0] },
  PAA: { name: 'Parabolic asteroid', group: 'outer', color: [0.55, 0.75, 1.0] },
  HYA: { name: 'Hyperbolic asteroid', group: 'outer', color: [0.55, 0.75, 1.0] },
  AST: { name: 'Asteroid', group: 'inner', color: [0.8, 0.8, 0.8] },
};

/** Drawn as full bodies elsewhere; their dots are hidden. */
const AS_BODIES = new Set(['1 Ceres', '4 Vesta', '134340 Pluto', '136199 Eris', '136108 Haumea', '136472 Makemake']);

interface Named {
  i: number;
  name: string;
  H: number;
  cls: string;
}

const SBDB = { name: 'JPL Small-Body Database', url: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html' };
const cosE = Math.cos(OBLIQUITY_J2000);
const sinE = Math.sin(OBLIQUITY_J2000);

export class SmallBodiesLayer implements Provider {
  readonly group = new THREE.Group();
  private points: THREE.Points | null = null;
  private material: THREE.ShaderMaterial;
  private data: Float32Array | null = null;
  private classes: Uint8Array | null = null;
  private classNames: string[] = [];
  private epochJd = 0;
  private named: Named[] = [];
  private byId = new Map<string, Named>();
  private targets = new Map<string, FocusTarget>();
  count = 0;
  /** Overall visibility this frame, 0..1. */
  alpha = 0;
  private orbit: THREE.Line;
  private orbitFor: string | null = null;

  constructor(
    private assets: Assets,
    private world: World,
  ) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec4 el0;   // a (AU), e, i, node
        attribute vec4 el1;   // peri, M0, n (rad/day), H
        attribute float cls;
        uniform float days;
        uniform float pixelRatio;
        uniform vec3 colors[14];
        uniform float groupAlpha[14];
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float e = el0.y;
          float M = mod(el1.y + el1.z * days, 6.2831853);
          float E = e > 0.8 ? 3.14159265 : M;
          for (int k = 0; k < 8; k++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
          float xv = el0.x * (cos(E) - e);
          float yv = el0.x * sqrt(1.0 - e * e) * sin(E);
          float cO = cos(el0.w), sO = sin(el0.w), cw = cos(el1.x), sw = sin(el1.x), ci = cos(el0.z), si = sin(el0.z);
          vec3 p = vec3(
            (cO * cw - sO * sw * ci) * xv + (-cO * sw - sO * cw * ci) * yv,
            (sO * cw + cO * sw * ci) * xv + (-sO * sw + cO * cw * ci) * yv,
            sw * si * xv + cw * si * yv);
          int c = int(cls + 0.5);
          // Brighter (lower H) objects draw a little larger and more opaque.
          float H = el1.w;
          vColor = colors[c];
          vAlpha = groupAlpha[c] * clamp(1.1 - 0.07 * (H - 10.0), 0.25, 1.0);
          gl_PointSize = pixelRatio * clamp(1.8 - 0.08 * (H - 10.0), 1.0, 2.6);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          if (vAlpha < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          #include <logdepthbuf_fragment>
          vec2 d = gl_PointCoord - 0.5;
          float a = (1.0 - smoothstep(0.35, 0.5, length(d))) * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vColor * a, 1.0);
        }`,
      uniforms: {
        days: { value: 0 },
        pixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
        colors: { value: [] as THREE.Vector3[] },
        groupAlpha: { value: new Array(14).fill(0) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.BufferAttribute(new Float32Array(257 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.orbit = new THREE.Line(og, new THREE.LineBasicMaterial({ color: 0xc9b99a, transparent: true, opacity: 0.5, depthWrite: false }));
    this.orbit.frustumCulled = false;
    this.orbit.visible = false;
    this.group.add(this.orbit);
    this.addGroupTargets();
  }

  async init(): Promise<void> {
    const [buf, names] = await Promise.all([
      this.assets.binary('smallbodies/elements.bin'),
      this.assets.json<{ classes: string[]; names: Named[] }>('smallbodies/names.json'),
    ]);
    if (!buf || !names) return;
    const parsed = parseSmallBodies(buf);
    const n = parsed.count;
    this.epochJd = parsed.epochJd;
    this.data = parsed.data;
    this.classes = parsed.classes;
    this.classNames = names.classes;
    this.count = n;
    const hidden = new Set(names.names.filter((x) => AS_BODIES.has(x.name)).map((x) => x.i));
    this.named = names.names.filter((x) => !hidden.has(x.i));
    for (const x of this.named) {
      const id = `sb-${x.name.split(' ')[0]}`;
      this.byId.set(id, x);
    }

    const el0 = new Float32Array(n * 4);
    const el1 = new Float32Array(n * 4);
    const cls = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const o = k * 8;
      el0.set([this.data[o], this.data[o + 1], this.data[o + 2], this.data[o + 3]], k * 4);
      el1.set([this.data[o + 4], this.data[o + 5], this.data[o + 6], this.data[o + 7]], k * 4);
      cls[k] = hidden.has(k) ? 13 : this.classes[k];
    }
    const g = new THREE.BufferGeometry();
    // Positions are computed in the shader; three.js still wants a position attribute.
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('el0', new THREE.BufferAttribute(el0, 4));
    g.setAttribute('el1', new THREE.BufferAttribute(el1, 4));
    g.setAttribute('cls', new THREE.BufferAttribute(cls, 1));
    const colors = this.classNames.map((c) => new THREE.Vector3(...(CLASS_INFO[c]?.color ?? [0.8, 0.8, 0.8])));
    while (colors.length < 14) colors.push(new THREE.Vector3(0.8, 0.8, 0.8));
    this.material.uniforms.colors.value = colors;
    // Class 13 is reused for hidden objects (see above).
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
    this.points.renderOrder = 5;
    this.group.add(this.points);
  }

  private elements(i: number): Elements {
    return elementsAt(this.data!, i);
  }

  private daysSinceEpoch(): number {
    // TDB ≈ TT; world.time.tt is days since J2000 TT.
    return this.world.time.tt + 2451545.0 - this.epochJd;
  }

  /** Heliocentric position (m) of a named object now. */
  private posOf(x: Named): Vec3 {
    const p = keplerPosition(this.elements(x.i), this.daysSinceEpoch());
    const sun = this.world.get('sun').pos;
    return [sun[0] + p[0] * AU, sun[1] + p[1] * AU, sun[2] + p[2] * AU];
  }

  update(ctx: FrameCtx): void {
    const sun = ctx.world.get('sun').pos;
    const sunRel = rel(sun, ctx.cam);
    const fromSun = length(sunRel);
    // Show the populations once the view takes in interplanetary space, and
    // fade them among the stars. Near a planet they'd only clutter the sky.
    const scale = ctx.pose.r;
    const on = ctx.settings.smallBodies ? 1 : 0;
    const inner = THREE.MathUtils.smoothstep(Math.log(scale), Math.log(0.02 * AU), Math.log(0.25 * AU)) * (1 - THREE.MathUtils.smoothstep(Math.log(fromSun), Math.log(15 * AU), Math.log(60 * AU)));
    const outer = THREE.MathUtils.smoothstep(Math.log(scale), Math.log(0.3 * AU), Math.log(4 * AU)) * (1 - THREE.MathUtils.smoothstep(Math.log(fromSun), Math.log(2000 * AU), Math.log(20000 * AU)));
    this.alpha = on * Math.max(inner, outer);
    const ga = this.material.uniforms.groupAlpha.value as number[];
    this.classNames.forEach((c, k) => {
      const grp = CLASS_INFO[c]?.group ?? 'inner';
      // Dense populations are dimmed so they read as a belt, not a wall.
      ga[k] = on * (grp === 'outer' ? outer * 0.8 : grp === 'neo' ? inner * 0.8 : grp === 'trojan' ? inner * 0.4 : inner * 0.22);
    });
    ga[13] = 0;
    if (this.points) {
      this.points.visible = this.alpha > 0.003;
      this.material.uniforms.days.value = this.daysSinceEpoch();
      // Model: camera-relative Sun, ecliptic -> equatorial, AU units.
      const m = this.points.matrix;
      m.set(AU, 0, 0, sunRel[0], 0, cosE * AU, -sinE * AU, sunRel[1], 0, sinE * AU, cosE * AU, sunRel[2], 0, 0, 0, 1);
      this.points.matrixWorldNeedsUpdate = true;
    }
    this.updateOrbit(ctx);
  }

  /** Orbit of the focused or selected named object, relative to its position. */
  private updateOrbit(ctx: FrameCtx): void {
    const id = [ctx.focusId, ctx.selectedId].find((x) => x && this.byId.has(x));
    const x = id ? this.byId.get(id) : undefined;
    this.orbit.visible = !!x && ctx.settings.orbits;
    if (!x) return;
    const el = this.elements(x.i);
    const now = keplerPosition(el, this.daysSinceEpoch());
    const period = (2 * Math.PI) / el.n;
    const pos = this.orbit.geometry.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k <= 256; k++) {
      const p = keplerPosition(el, this.daysSinceEpoch() + (period * k) / 256);
      pos.setXYZ(k, (p[0] - now[0]) * AU, (p[1] - now[1]) * AU, (p[2] - now[2]) * AU);
    }
    pos.needsUpdate = true;
    const r = rel(this.posOf(x), ctx.cam);
    this.orbit.position.set(r[0], r[1], r[2]);
    this.orbitFor = id!;
  }

  /** Labels: the brightest named objects as seen from the camera, plus group names. */
  labels(ctx: FrameCtx, max = 24): Array<{ id: string; name: string; pos: Vec3; priority: number; alpha: number; group?: boolean }> {
    if (!this.data || this.alpha < 0.05) return [];
    const out: Array<{ id: string; name: string; pos: Vec3; priority: number; alpha: number; group?: boolean }> = [];
    const sun = ctx.world.get('sun').pos;
    const cands = this.named.map((x) => {
      const pos = this.posOf(x);
      const r = length([pos[0] - sun[0], pos[1] - sun[1], pos[2] - sun[2]]) / AU;
      const d = Math.max(length(rel(pos, ctx.cam)) / AU, 1e-6);
      // Apparent magnitude at opposition-like geometry (no phase term).
      return { x, pos, m: x.H + 5 * Math.log10(r * d) };
    });
    cands.sort((p, q) => p.m - q.m);
    const ga0 = this.material.uniforms.groupAlpha.value as number[];
    const shown = cands.filter((c) => ga0[this.classNames.indexOf(c.x.cls)] > 0.02);
    for (const c of shown.slice(0, max)) {
      out.push({ id: `sb-${c.x.name.split(' ')[0]}`, name: c.x.name.replace(/^\d+\s+/, ''), pos: c.pos, priority: 30 - c.m, alpha: this.alpha });
    }
    // Population names, anchored on the side facing the camera.
    const cam = rel(ctx.cam, sun);
    const ce: Vec3 = [cam[0], cosE * cam[1] + sinE * cam[2], 0];
    const cl = Math.hypot(ce[0], ce[1]) || 1;
    const toward = (rAU: number, rotDeg: number): Vec3 => {
      const a = Math.atan2(ce[1] / cl, ce[0] / cl) + (rotDeg * Math.PI) / 180;
      const x = Math.cos(a) * rAU * AU;
      const y = Math.sin(a) * rAU * AU;
      return [sun[0] + x, sun[1] + cosE * y, sun[2] + sinE * y];
    };
    const ga = this.material.uniforms.groupAlpha.value as number[];
    const innerA = Math.max(...this.classNames.map((c, k) => (CLASS_INFO[c]?.group === 'inner' ? ga[k] / 0.22 : 0)));
    const outerA = Math.max(...this.classNames.map((c, k) => (CLASS_INFO[c]?.group === 'outer' ? ga[k] / 0.8 : 0)));
    if (innerA > 0.2) out.push({ id: 'main-belt', name: 'Main asteroid belt', pos: toward(2.75, -35), priority: 60, alpha: innerA, group: true });
    if (outerA > 0.2) out.push({ id: 'kuiper-belt', name: 'Kuiper belt', pos: toward(44, -35), priority: 58, alpha: outerA, group: true });
    const jup = ctx.world.get('jupiter').pos;
    const jr: Vec3 = [jup[0] - sun[0], jup[1] - sun[1], jup[2] - sun[2]];
    if (innerA > 0.2) {
      for (const [id, name, deg] of [['trojans-l4', 'Trojans (L4)', 60], ['trojans-l5', 'Trojans (L5)', -60]] as const) {
        out.push({ id, name, pos: this.rotateEcliptic(sun, jr, deg), priority: 50, alpha: innerA, group: true });
      }
    }
    return out;
  }

  /** Rotate a heliocentric vector about the ecliptic pole. */
  private rotateEcliptic(sun: Vec3, v: Vec3, deg: number): Vec3 {
    // To ecliptic, rotate, back.
    const x = v[0];
    const y = cosE * v[1] + sinE * v[2];
    const z = -sinE * v[1] + cosE * v[2];
    const a = (deg * Math.PI) / 180;
    const xr = Math.cos(a) * x - Math.sin(a) * y;
    const yr = Math.sin(a) * x + Math.cos(a) * y;
    return [sun[0] + xr, sun[1] + cosE * yr - sinE * z, sun[2] + sinE * yr + cosE * z];
  }

  // ---- registry provider ---------------------------------------------------------

  private addGroupTargets(): void {
    const sunTarget = (id: string, framing: number): FocusTarget => ({
      id,
      radius: 0,
      minAltitude: 1e9,
      pos: () => this.world.get('sun').pos,
      pole: () => null,
      handoff: null,
      parent: 'sun',
      framing,
    });
    this.targets.set('main-belt', sunTarget('main-belt', 9 * AU));
    this.targets.set('kuiper-belt', sunTarget('kuiper-belt', 150 * AU));
    for (const [id, deg] of [['trojans-l4', 60], ['trojans-l5', -60]] as const) {
      this.targets.set(id, {
        id,
        radius: 0,
        minAltitude: 1e9,
        pos: () => {
          const sun = this.world.get('sun').pos;
          const j = this.world.get('jupiter').pos;
          return this.rotateEcliptic(sun, [j[0] - sun[0], j[1] - sun[1], j[2] - sun[2]], deg);
        },
        pole: () => null,
        handoff: [2 * AU, 10 * AU],
        parent: 'sun',
        framing: 4 * AU,
      });
    }
  }

  target(id: string): FocusTarget | undefined {
    const t = this.targets.get(id);
    if (t) return t;
    const x = this.byId.get(id);
    if (!x || !this.data) return undefined;
    const radius = diameterFromH(x.H, 0.15) * 500;
    const outer = CLASS_INFO[x.cls]?.group === 'outer';
    const target: FocusTarget = {
      id,
      radius: 0,
      minAltitude: Math.max(1e6, radius * 20),
      pos: () => this.posOf(x),
      pole: () => null,
      handoff: outer ? [5 * AU, 40 * AU] : [0.2 * AU, 2 * AU],
      parent: 'sun',
      framing: outer ? 3 * AU : 0.08 * AU,
    };
    this.targets.set(id, target);
    return target;
  }

  info(id: string): ObjectInfo | undefined {
    const groups: Record<string, ObjectInfo> = {
      'main-belt': {
        id,
        name: 'Main asteroid belt',
        subtitle: 'Between Mars and Jupiter',
        facts: [
          { label: 'Location', value: 'About 2.1–3.3 AU from the Sun', kind: 'measured', source: SBDB },
          { label: 'Total mass', value: 'About 3% of the Moon’s (Pitjeva & Pitjev 2018)', kind: 'measured', source: { name: 'Pitjeva & Pitjev 2018, Astron. Lett. 44, 554', url: 'https://doi.org/10.1134/S1063773718090050' } },
          { label: 'Shown', value: `${this.countGroup('inner').toLocaleString('en-US')} numbered asteroids brighter than H = 16`, kind: 'measured', source: SBDB },
        ],
        notes: [{ text: 'Real positions from JPL orbital elements. Asteroids are far apart: spacecraft cross the belt without coming near one. Dots are not to scale.', kind: 'measured' }],
      },
      'kuiper-belt': {
        id,
        name: 'Kuiper belt',
        subtitle: 'Beyond Neptune',
        facts: [
          { label: 'Location', value: 'Mostly 30–50 AU from the Sun', kind: 'measured', source: SBDB },
          { label: 'Shown', value: `${this.countGroup('outer').toLocaleString('en-US')} trans-Neptunian objects and Centaurs with well-determined orbits`, kind: 'measured', source: SBDB },
        ],
        notes: [{ text: 'Home of Pluto, Eris, Haumea, Makemake and Arrokoth. Only a small fraction of its members have been discovered; the sky coverage of surveys shapes where known objects appear.', kind: 'measured' }],
      },
    };
    if (groups[id]) return groups[id];
    if (id === 'trojans-l4' || id === 'trojans-l5') {
      return {
        id,
        name: id === 'trojans-l4' ? 'Jupiter trojans (L4, “Greek camp”)' : 'Jupiter trojans (L5, “Trojan camp”)',
        subtitle: 'Asteroids sharing Jupiter’s orbit',
        facts: [
          { label: 'Location', value: `60° ${id === 'trojans-l4' ? 'ahead of' : 'behind'} Jupiter in its orbit`, kind: 'measured', source: SBDB },
          { label: 'Shown (both camps)', value: `${this.countClass('TJN').toLocaleString('en-US')} numbered trojans`, kind: 'measured', source: SBDB },
        ],
        notes: [{ text: 'NASA’s Lucy mission is touring both camps (flybys 2027–2033).', kind: 'measured' }],
      };
    }
    const x = this.byId.get(id);
    if (!x || !this.data) return undefined;
    const el = this.elements(x.i);
    const periodYr = (2 * Math.PI) / el.n / 365.25;
    const num = x.name.split(' ')[0];
    const src = { name: 'JPL Small-Body Database', url: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${num}` };
    const pos = this.posOf(x);
    const sun = this.world.get('sun').pos;
    const earth = this.world.get('earth').pos;
    const dSun = length([pos[0] - sun[0], pos[1] - sun[1], pos[2] - sun[2]]) / AU;
    const dEarth = length([pos[0] - earth[0], pos[1] - earth[1], pos[2] - earth[2]]) / AU;
    const dLo = diameterFromH(x.H, 0.25);
    const dHi = diameterFromH(x.H, 0.05);
    const fmtKm = (km: number) => (km >= 10 ? Math.round(km).toLocaleString('en-US') : km.toFixed(1));
    return {
      id,
      name: x.name.replace(/^\d+\s+/, ''),
      subtitle: `${CLASS_INFO[x.cls]?.name ?? 'Small body'} · (${num})`,
      facts: [
        { label: 'Semi-major axis', value: `${el.a.toFixed(3)} AU`, kind: 'measured', source: src },
        { label: 'Eccentricity', value: el.e.toFixed(3), kind: 'measured', source: src },
        { label: 'Inclination', value: `${((el.i * 180) / Math.PI).toFixed(2)}°`, kind: 'measured', source: src },
        { label: 'Orbital period', value: `${periodYr.toFixed(periodYr < 10 ? 2 : 1)} years`, kind: 'derived', source: src },
        { label: 'Perihelion – aphelion', value: `${(el.a * (1 - el.e)).toFixed(2)} – ${(el.a * (1 + el.e)).toFixed(2)} AU`, kind: 'derived', source: src },
        { label: 'Absolute magnitude H', value: x.H.toFixed(2), kind: 'measured', source: src },
        { label: 'Diameter (from H)', value: `≈ ${fmtKm(dLo)}–${fmtKm(dHi)} km for albedo 0.25–0.05`, kind: 'derived', source: src },
        { label: 'Distance from the Sun (now)', value: `${dSun.toFixed(2)} AU`, kind: 'derived', source: src },
        { label: 'Distance from Earth (now)', value: `${dEarth.toFixed(2)} AU`, kind: 'derived', source: src },
      ],
      notes: [{ text: 'Position from JPL osculating elements (two-body motion). Shown as a point: too small to resolve at these distances.', kind: 'measured' }],
    };
  }

  private countClass(c: string): number {
    if (!this.classes) return 0;
    const k = this.classNames.indexOf(c);
    let n = 0;
    for (const v of this.classes) if (v === k) n++;
    return n;
  }

  private countGroup(g: string): number {
    return this.classNames.filter((c) => CLASS_INFO[c]?.group === g).reduce((s, c) => s + this.countClass(c), 0);
  }

  search(): SearchEntry[] {
    const groups: SearchEntry[] = [
      { id: 'main-belt', name: 'Main asteroid belt', aliases: ['Asteroid belt'], kind: 'Region', detail: 'Region', rank: 2, diffuse: true },
      { id: 'kuiper-belt', name: 'Kuiper belt', aliases: ['Edgeworth-Kuiper belt', 'Trans-Neptunian'], kind: 'Region', detail: 'Region', rank: 2, diffuse: true },
      { id: 'trojans-l4', name: 'Jupiter trojans (L4)', aliases: ['Greek camp', 'Trojans'], kind: 'Region', detail: 'Region', rank: 3 },
      { id: 'trojans-l5', name: 'Jupiter trojans (L5)', aliases: ['Trojan camp', 'Trojans'], kind: 'Region', detail: 'Region', rank: 3 },
    ];
    if (!this.data) return groups;
    return [
      ...groups,
      ...this.named.map((x) => {
        const [num, ...rest] = x.name.split(' ');
        return { id: `sb-${num}`, name: rest.join(' '), aliases: [x.name, num], kind: 'Small body', detail: CLASS_INFO[x.cls]?.name ?? 'Small body', rank: 4 };
      }),
    ];
  }

  get focusedOrbit(): string | null {
    return this.orbitFor;
  }
}

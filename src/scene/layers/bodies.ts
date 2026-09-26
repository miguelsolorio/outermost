// Renders solar-system bodies: textured ellipsoids up close, glowing point
// markers when they shrink below a few pixels.

import * as THREE from 'three';
import { length, type Mat3 } from '../../astro/vec.ts';
import { AU } from '../../astro/units.ts';
import type { Assets } from '../../engine/assets.ts';
import { BODIES, meanRadius, type BodyDef } from '../catalog.ts';
import { createBodySphere } from '../geometry.ts';
import { planetFragment, planetVertex } from '../shaders/planet.ts';
import { sunLimbFragment, sunLimbVertex, sunSurfaceFragment, sunSurfaceVertex } from '../shaders/sun.ts';
import { noiseTexture } from '../shaders/noise.ts';
import { atmosphereFragment, atmosphereVertex, type AtmosphereParams } from '../shaders/atmosphere.ts';
import { ringFragment, ringVertex } from '../shaders/rings.ts';
import ringProfile from '../../../data/baked/saturn-rings-pps.json';

/** Saturn ring extent used for rendering (km): C ring inner edge to just past the F ring. */
const RING_INNER_KM = 74_400;
const RING_OUTER_KM = 140_400;

function ringTauTexture(): THREE.DataTexture {
  const n = ringProfile.tau.length;
  const data = new Float32Array(n * 4);
  ringProfile.tau.forEach((t, i) => (data[i * 4] = t));
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
import { rel, type FrameCtx } from '../frame.ts';
import { DetailTiles } from '../detailTiles.ts';

const MODEL = { lunar: 0, minnaert: 1, earth: 2 } as const;

/** Radius of the Sun's limb shell (spicules, prominences), in solar radii. */
const SUN_SHELL = 1.25;

/**
 * Crater density of the synthetic relief drawn where a mosaic is low
 * resolution (see textures/<key>-sharp). Triton's surface is young and
 * sparsely cratered; Charon's is old and heavily cratered.
 */
const SYNTH_CRATERS: Record<string, number> = { pluto: 1, charon: 1.3, triton: 0.15 };

/** One texture binding (e.g. Earth's day map, clouds) with resolution tiers. */
interface Slot {
  uniform: string;
  flag?: string;
  /** Texture key for this frame (e.g. "earth-09"); may change with time. */
  key: (ms: number) => string;
  /** Max width to request (clouds/night don't need the top tier). */
  maxWidth?: number;
  colorSpace: THREE.ColorSpace;
  loadedPath: string | null;
  loadedWidth: number;
  loadingPath: string | null;
}

interface BodyVisual {
  def: BodyDef;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  slots: Slot[];
  atmosphere: THREE.Mesh | null;
  rings: THREE.Mesh | null;
  /** The Sun's limb shell: rim, spicules and prominences past the edge of the disk. */
  limb: THREE.Mesh | null;
  /** Radius multiplier from "boost sizes". */
  boost: number;
  /** Apparent radius in CSS px, from last frame. */
  apparentPx: number;
  /** Bodies that can eclipse the Sun as seen from this one. */
  occluders: BodyDef[];
}

/** A body's parent and its four largest moons: the ones that can cast eclipses on it. */
function occludersFor(def: BodyDef): BodyDef[] {
  if (def.kind === 'star') return [];
  const parent = def.parent && def.parent !== 'sun' ? BODIES.filter((b) => b.id === def.parent) : [];
  const moons = BODIES.filter((b) => b.parent === def.id && b.kind === 'moon').sort((a, b) => meanRadius(b) - meanRadius(a));
  return [...parent, ...moons].slice(0, 4);
}

const tmpMatrix = new THREE.Matrix4();

function setOrientation(obj: THREE.Object3D, m: Mat3): void {
  // Mat3 is row-major body-fixed -> EQJ; THREE.Matrix4.set takes row-major too.
  tmpMatrix.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
  obj.quaternion.setFromRotationMatrix(tmpMatrix);
}

/**
 * Blue Marble monthly composites represent mid-month conditions. Returns the
 * two months bracketing a date and the blend weight between them.
 */
export function monthPair(ms: number): { a: string; b: string; t: number } {
  const d = new Date(ms);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const mf = d.getUTCMonth() + (d.getUTCDate() - 1 + d.getUTCHours() / 24 - daysInMonth / 2) / daysInMonth;
  const i = Math.floor(mf);
  const pad = (n: number) => String((((n % 12) + 12) % 12) + 1).padStart(2, '0');
  return { a: pad(i), b: pad(i + 1), t: mf - i };
}

/**
 * Atmosphere uniforms, shared by reference between the planet and its shell.
 * The atmosphere is traced around the equatorial radius; `atmShape` maps the
 * oblate planet onto that sphere.
 */
function atmosphereUniforms(a: AtmosphereParams, equatorialM: number, planet: THREE.ShaderMaterial): Record<string, THREE.IUniform> {
  const u = planet.uniforms;
  u.atmRp.value = equatorialM / 1000;
  u.atmRa.value = equatorialM / 1000 + a.top;
  u.atmBetaR.value.set(...a.betaR);
  u.atmBetaM.value = a.betaM;
  u.atmMieTint.value.set(...a.mieTint);
  u.atmMieExt.value.set(...a.mieExt);
  u.atmHR.value = a.HR;
  u.atmHM.value = a.HM;
  u.atmG.value = a.g;
  u.atmAbsorb.value.set(...a.absorb);
  u.atmMS.value = a.multiScatter ?? 0;
  const keys = ['hasAtmosphere', 'atmCamPos', 'atmSunDir', 'atmShape', 'atmMS', 'atmRp', 'atmRa', 'atmBetaR', 'atmBetaM', 'atmMieTint', 'atmMieExt', 'atmHR', 'atmHM', 'atmG', 'atmAbsorb'];
  return Object.fromEntries(keys.map((k) => [k, u[k]]));
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export class BodiesLayer {
  readonly group = new THREE.Group();
  readonly visuals = new Map<string, BodyVisual>();
  private markers: THREE.Points;
  private markerPos: Float32Array;
  private markerAlpha: Float32Array;
  private markerIds: string[];

  constructor(private assets: Assets) {
    const sphere = createBodySphere();
    for (const def of BODIES) {
      const material =
        def.appearance.shading.type === 'sun'
          ? new THREE.ShaderMaterial({
              vertexShader: sunSurfaceVertex,
              fragmentShader: sunSurfaceFragment,
              uniforms: {
                intensity: { value: 1 },
                time: { value: 0 },
                look: { value: 0 },
                noiseTex: { value: noiseTexture() },
              },
            })
          : this.planetMaterial(def);
      const mesh = new THREE.Mesh(sphere, material);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = true;
      mesh.name = def.id;
      this.group.add(mesh);
      let atmosphere: THREE.Mesh | null = null;
      const atm = def.appearance.atmosphere;
      if (atm) {
        atmosphere = new THREE.Mesh(
          sphere,
          new THREE.ShaderMaterial({
            vertexShader: atmosphereVertex,
            fragmentShader: atmosphereFragment,
            uniforms: { irradiance: material.uniforms.irradiance, ...atmosphereUniforms(atm, def.radii[0], material) },
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        atmosphere.frustumCulled = false;
        atmosphere.renderOrder = 2;
        this.group.add(atmosphere);
      }
      let limb: THREE.Mesh | null = null;
      if (def.appearance.shading.type === 'sun') {
        limb = new THREE.Mesh(
          sphere,
          new THREE.ShaderMaterial({
            vertexShader: sunLimbVertex,
            fragmentShader: sunLimbFragment,
            uniforms: {
              intensity: { value: 0 },
              time: material.uniforms.time,
              noiseTex: material.uniforms.noiseTex,
              camObj: { value: new THREE.Vector3() },
              shellR: { value: SUN_SHELL },
            },
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        limb.frustumCulled = false;
        // Just under the Sun's glare (20).
        limb.renderOrder = 19;
        this.group.add(limb);
      }
      let rings: THREE.Mesh | null = null;
      if (def.id === 'saturn') {
        const tau = ringTauTexture();
        const r0 = ringProfile.radius0_km;
        const r1 = r0 + ringProfile.step_km * (ringProfile.tau.length - 1);
        const ringUniforms = {
          ringTau: { value: tau },
          ringR0: { value: r0 },
          ringR1: { value: r1 },
          ringInner: { value: RING_INNER_KM },
          ringOuter: { value: RING_OUTER_KM },
          ringScale: { value: 1 },
        };
        rings = new THREE.Mesh(
          new THREE.RingGeometry(RING_INNER_KM, RING_OUTER_KM, 512, 1),
          new THREE.ShaderMaterial({
            vertexShader: ringVertex,
            fragmentShader: ringFragment,
            uniforms: {
              ...ringUniforms,
              planetPos: { value: new THREE.Vector3() },
              pole: { value: new THREE.Vector3(0, 0, 1) },
              sunPos: material.uniforms.sunPos,
              irradiance: material.uniforms.irradiance,
              planetA: { value: def.radii[0] },
              planetC: { value: def.radii[2] },
            },
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            blending: THREE.CustomBlending,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
          }),
        );
        rings.frustumCulled = false;
        rings.renderOrder = 3;
        this.group.add(rings);
        // The planet shader samples the same profile for the rings' shadow.
        Object.assign(material.uniforms, ringUniforms, { hasRings: { value: true }, ringPole: rings.material instanceof THREE.ShaderMaterial ? rings.material.uniforms.pole : { value: new THREE.Vector3() } });
      }
      this.visuals.set(def.id, { def, mesh, material, slots: this.slotsFor(def), atmosphere, rings, limb, boost: 1, apparentPx: 0, occluders: occludersFor(def) });
    }

    // Point markers for bodies too small to resolve.
    this.markerIds = BODIES.map((b) => b.id);
    const n = this.markerIds.length;
    this.markerPos = new Float32Array(n * 3);
    this.markerAlpha = new Float32Array(n);
    const colors = new Float32Array(n * 3);
    BODIES.forEach((b, i) => {
      const c = b.appearance.color;
      colors.set([srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])], i * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.markerPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.markerAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.markers = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          attribute float alpha;
          attribute vec3 color;
          varying vec3 vColor;
          varying float vAlpha;
          uniform float pixelRatio;
          void main() {
            vColor = color;
            vAlpha = alpha;
            vec4 mv = viewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = 7.0 * pixelRatio;
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
            float r = length(d) * 2.0;
            float core = smoothstep(0.55, 0.0, r);
            float halo = exp(-r * r * 6.0) * 0.35;
            float a = (core + halo) * vAlpha;
            if (a < 0.003) discard;
            gl_FragColor = vec4(vColor * a * 2.0, 1.0);
          }`,
        uniforms: { pixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 10;
    this.group.add(this.markers);
  }

  private planetMaterial(def: BodyDef): THREE.ShaderMaterial {
    const sh = def.appearance.shading;
    const tint = def.appearance.tint ?? def.appearance.color;
    return new THREE.ShaderMaterial({
      vertexShader: planetVertex,
      fragmentShader: planetFragment,
      uniforms: {
        map: { value: null },
        hasMap: { value: false },
        tint: { value: new THREE.Color().setRGB(srgbToLinear(tint[0]), srgbToLinear(tint[1]), srgbToLinear(tint[2])) },
        nightMap: { value: null },
        hasNight: { value: false },
        sunPos: { value: new THREE.Vector3() },
        irradiance: { value: 1 },
        model: { value: sh.type === 'lunar' ? MODEL.lunar : sh.type === 'minnaert' ? MODEL.minnaert : MODEL.earth },
        lunarL: { value: sh.type === 'lunar' ? (sh.L === 'mcewen' ? -1 : sh.L) : 0 },
        minnaertK: { value: sh.type === 'minnaert' ? sh.k : 1 },
        nightGain: { value: 1.5 },
        map2: { value: null },
        mapBlend: { value: 0 },
        // Mean square slope σ² = 0.003 + 0.00512·U for wind U = 7 m/s (Cox & Munk 1954).
        hasGlint: { value: def.id === 'earth' },
        glintSlope2: { value: 0.003 + 0.00512 * 7 },
        normalMap: { value: null },
        hasNormalMap: { value: false },
        sharpMap: { value: null },
        hasSharpMap: { value: false },
        bodyRadiusKm: { value: meanRadius(def) / 1000 },
        synthCraters: { value: SYNTH_CRATERS[def.id] ?? 1 },
        occluders: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
        occluderRed: { value: [0, 0, 0, 0] },
        occluderCount: { value: 0 },
        sunRadius: { value: 6.957e8 },
        detailTex: { value: null },
        detailIndex: { value: null },
        hasDetail: { value: false },
        detailGrid: { value: new THREE.Vector2(1, 1) },
        detailFrame: { value: new THREE.Vector2(1, 0) },
        cloudMap: { value: null },
        hasClouds: { value: false },
        cloudShadow: { value: 0.35 },
        cloudHeight: { value: 8_000 / 6_371_000 },
        sunDirBody: { value: new THREE.Vector3(1, 0, 0) },
        hasAtmosphere: { value: false },
        atmCamPos: { value: new THREE.Vector3() },
        atmSunDir: { value: new THREE.Vector3(1, 0, 0) },
        atmShape: { value: new THREE.Matrix3() },
        atmMS: { value: 0 },
        atmRp: { value: 1 },
        atmRa: { value: 1 },
        atmBetaR: { value: new THREE.Vector3() },
        atmBetaM: { value: 0 },
        atmMieTint: { value: new THREE.Vector3(1, 1, 1) },
        atmMieExt: { value: new THREE.Vector3(1.11, 1.11, 1.11) },
        atmHR: { value: 1 },
        atmHM: { value: 1 },
        atmG: { value: 0 },
        atmAbsorb: { value: new THREE.Vector3() },
        hasRings: { value: false },
        ringTau: { value: null },
        ringR0: { value: 0 },
        ringR1: { value: 1 },
        ringInner: { value: 0 },
        ringOuter: { value: 0 },
        ringScale: { value: 1 },
        ringPole: { value: new THREE.Vector3(0, 0, 1) },
      },
    });
  }

  private slotsFor(def: BodyDef): Slot[] {
    const slot = (uniform: string, key: (ms: number) => string, extra: Partial<Slot> = {}): Slot => ({
      uniform,
      flag: undefined,
      key,
      colorSpace: THREE.SRGBColorSpace,
      loadedPath: null,
      loadedWidth: 0,
      loadingPath: null,
      ...extra,
    });
    if (def.id === 'earth') {
      return [
        slot('map', (ms) => `earth-${monthPair(ms).a}`, { flag: 'hasMap' }),
        slot('map2', (ms) => `earth-${monthPair(ms).b}`),
        slot('cloudMap', () => 'earth-clouds', { flag: 'hasClouds', colorSpace: THREE.NoColorSpace }),
        slot('nightMap', () => 'earth-night', { flag: 'hasNight' }),
        slot('normalMap', () => 'earth-normal', { flag: 'hasNormalMap', colorSpace: THREE.NoColorSpace }),
      ];
    }
    const key = def.appearance.texture;
    // Relief maps and sharpness masks load only where the pipeline made one
    // (textures/<key>-normal, textures/<key>-sharp).
    return key
      ? [
          slot('map', () => key, { flag: 'hasMap' }),
          slot('normalMap', () => `${key}-normal`, { flag: 'hasNormalMap', colorSpace: THREE.NoColorSpace }),
          slot('sharpMap', () => `${key}-sharp`, { flag: 'hasSharpMap', colorSpace: THREE.NoColorSpace }),
        ]
      : [];
  }

  /** Streamed close-up imagery (tile sets under assets/tiles/). */
  readonly detail = new Map<string, DetailTiles>();
  private frameNo = 0;

  /** Earth's detail streamer (monthly tile sets). */
  get earthDetail(): DetailTiles | null {
    return this.detail.get('earth') ?? null;
  }

  async init(): Promise<void> {
    // Textures stream in from update() as soon as the manifest is known.
    // Earth's twelve monthly sets share one layout; index it from January.
    const sets: Array<[string, string]> = [
      ['earth', 'earth-01'],
      ['moon', 'moon'],
      ['mars', 'mars'],
    ];
    await Promise.all(
      sets.map(async ([id, indexSet]) => {
        const d = new DetailTiles(this.assets, indexSet);
        if (!(await d.init())) return;
        this.detail.set(id, d);
        Object.assign(this.visuals.get(id)!.material.uniforms, d.uniforms);
      }),
    );
  }

  private isInUse(path: string): boolean {
    for (const v of this.visuals.values()) for (const sl of v.slots) if (sl.loadedPath === path || sl.loadingPath === path) return true;
    return false;
  }

  private updateSlot(v: BodyVisual, sl: Slot, ms: number): void {
    if (sl.loadingPath) return;
    const key = sl.key(ms);
    const tiers = this.assets.textureTiers(key).filter((w) => !sl.maxWidth || w <= sl.maxWidth);
    if (!tiers.length) return;
    const needed = 2 * Math.PI * v.apparentPx * 1.2; // texels around the visible circumference
    const want = tiers.find((w) => w >= needed) ?? tiers[tiers.length - 1];
    const path = `textures/${key}/${want}.ktx2`;
    const sameKey = sl.loadedPath?.startsWith(`textures/${key}/`);
    // Never downgrade the same texture (avoids thrashing while zooming).
    if (path === sl.loadedPath || (sameKey && want < sl.loadedWidth)) return;
    sl.loadingPath = path;
    void this.assets.texture(path, sl.colorSpace).then((tex) => {
      sl.loadingPath = null;
      if (!tex) return;
      const prev = sl.loadedPath;
      v.material.uniforms[sl.uniform].value = tex;
      if (sl.flag) v.material.uniforms[sl.flag].value = true;
      sl.loadedPath = path;
      sl.loadedWidth = want;
      if (prev && !this.isInUse(prev)) this.assets.release(prev);
    });
  }

  update(ctx: FrameCtx): void {
    const { world, cam, pxPerRad } = ctx;
    this.frameNo++;
    const sunRel = rel(world.get('sun').pos, cam);
    const fromSun = Math.max(length(sunRel), 1);

    BODIES.forEach((def, i) => {
      const st = world.get(def.id);
      const v = this.visuals.get(def.id)!;
      const p = rel(st.pos, cam);
      const dist = length(p);
      const R = meanRadius(def);
      const trueAngular = Math.asin(Math.min(1, R / Math.max(dist, R)));
      const truePx = trueAngular * pxPerRad;

      // Boost sizes: grow tiny bodies to a minimum apparent size, without
      // swallowing their moons (cap at 0.25 of distance to the nearest body).
      let boost = 1;
      if (ctx.settings.boost && def.kind !== 'star' && truePx < 6) {
        boost = Math.min(6 / Math.max(truePx, 1e-6), 2000);
      }
      v.boost += (boost - v.boost) * Math.min(1, ctx.dt * 6);
      const radiusScale = v.boost;
      v.apparentPx = truePx * radiusScale;

      v.mesh.position.set(p[0], p[1], p[2]);
      setOrientation(v.mesh, st.orient);
      v.mesh.scale.set(def.radii[0] * radiusScale, def.radii[1] * radiusScale, def.radii[2] * radiusScale);
      v.mesh.visible = st.valid && v.apparentPx > 0.35 && dist > R * 1.0001;

      const u = v.material.uniforms;
      if (def.appearance.shading.type === 'sun') {
        // Adapt exposure like an eye: a dazzling white point from afar. Once
        // the disk fills a good part of the view it takes on the 304 Å look
        // (shaders/sun.ts), dim enough that its orange survives tone mapping.
        const look = THREE.MathUtils.smoothstep(trueAngular, 0.01, 0.12);
        u.look.value = look;
        u.intensity.value = THREE.MathUtils.lerp(6.0, 0.95, look);
        // Wall-clock time: the surface keeps churning while the simulation is paused.
        u.time.value += ctx.dt;
        if (v.limb) {
          v.limb.position.copy(v.mesh.position);
          v.limb.quaternion.copy(v.mesh.quaternion);
          v.limb.scale.setScalar(R * SUN_SHELL);
          // Camera in body-fixed axes (transpose of body -> EQJ), in solar radii.
          const m = st.orient;
          const lu = (v.limb.material as THREE.ShaderMaterial).uniforms;
          lu.camObj.value.set(
            -(m[0] * p[0] + m[3] * p[1] + m[6] * p[2]) / R,
            -(m[1] * p[0] + m[4] * p[1] + m[7] * p[2]) / R,
            -(m[2] * p[0] + m[5] * p[1] + m[8] * p[2]) / R,
          );
          lu.intensity.value = look;
          v.limb.visible = v.mesh.visible && look > 0.001;
        }
      } else {
        u.sunPos.value.set(sunRel[0], sunRel[1], sunRel[2]);
        // Sunlight falls off as 1/d^2; exposure is set relative to the focus.
        const d = Math.max(st.sunDist, 0.05 * AU);
        u.irradiance.value = Math.min(4, (ctx.exposureDist / d) ** 2) * 1.15;
        // Sun direction in the body-fixed frame (transpose of body -> EQJ).
        const m = st.orient;
        const sx = -st.pos[0] / d;
        const sy = -st.pos[1] / d;
        const sz = -st.pos[2] / d;
        u.sunDirBody.value.set(m[0] * sx + m[3] * sy + m[6] * sz, m[1] * sx + m[4] * sy + m[7] * sz, m[2] * sx + m[5] * sy + m[8] * sz).normalize();
        // Eclipses need true sizes; skip them when sizes are boosted.
        let n = 0;
        if (radiusScale < 1.01) {
          for (const o of v.occluders) {
            const os = world.get(o.id);
            if (!os.valid) continue;
            const op = rel(os.pos, cam);
            u.occluders.value[n].set(op[0], op[1], op[2], meanRadius(o));
            u.occluderRed.value[n] = o.appearance.atmosphere?.redUmbra ? 1 : 0;
            n++;
          }
        }
        u.occluderCount.value = n;
      }

      if (v.atmosphere && def.appearance.atmosphere) {
        const km = 0.001;
        u.atmCamPos.value.set(-p[0] * km, -p[1] * km, -p[2] * km);
        u.atmSunDir.value.set(sunRel[0] - p[0], sunRel[1] - p[1], sunRel[2] - p[2]).normalize();
        // Stretch along the pole (world axes) so the oblate planet becomes a sphere:
        // I + (a/c − 1)·p·pᵀ, with p the pole direction.
        const m = st.orient;
        const f = def.radii[0] / def.radii[2] - 1;
        const [px, py, pz] = [m[2], m[5], m[8]];
        u.atmShape.value.set(
          1 + f * px * px, f * px * py, f * px * pz,
          f * py * px, 1 + f * py * py, f * py * pz,
          f * pz * px, f * pz * py, 1 + f * pz * pz,
        );
        // The shell: the top of the atmosphere over the equator, flattened like the planet.
        const top = (def.radii[0] / 1000 + def.appearance.atmosphere.top) * 1000 * radiusScale;
        v.atmosphere.position.copy(v.mesh.position);
        v.atmosphere.quaternion.copy(v.mesh.quaternion);
        v.atmosphere.scale.set(top, top, (top * def.radii[2]) / def.radii[0]);
        // The shell and ground scattering only matter once the disk is a few pixels wide.
        v.atmosphere.visible = v.mesh.visible && v.apparentPx > 2 && radiusScale < 1.01;
        u.hasAtmosphere.value = v.atmosphere.visible && def.appearance.atmosphere.surface !== false;
      }
      if (v.rings) {
        v.rings.position.copy(v.mesh.position);
        v.rings.quaternion.copy(v.mesh.quaternion);
        v.rings.scale.setScalar(1000 * radiusScale);
        v.rings.visible = st.valid && (v.mesh.visible || v.apparentPx > 0.05);
        const ru = (v.rings.material as THREE.ShaderMaterial).uniforms;
        ru.planetPos.value.set(p[0], p[1], p[2]);
        const m = st.orient;
        ru.pole.value.set(m[2], m[5], m[8]);
        ru.planetA.value = def.radii[0] * radiusScale;
        ru.planetC.value = def.radii[2] * radiusScale;
        ru.ringScale.value = radiusScale;
      }
      for (const sl of v.slots) this.updateSlot(v, sl, world.ms);
      if (def.id === 'earth') u.mapBlend.value = monthPair(world.ms).t;
      const detail = this.detail.get(def.id);
      if (detail) {
        const map = v.slots[0].loadedPath;
        const topTier = this.assets.textureTiers(v.slots[0].key(world.ms)).at(-1);
        // Detail only helps once the finest global texture is in place.
        if (v.mesh.visible && radiusScale < 1.01 && map && topTier && map.endsWith(`/${topTier}.ktx2`)) {
          const aspect = ctx.viewportW / Math.max(1, ctx.viewportH);
          let set = def.id;
          let usable = [def.id];
          if (def.id === 'earth') {
            // The tile of the nearer month; the shader blends seasons from the global maps.
            const mp = monthPair(world.ms);
            set = `earth-${mp.t < 0.5 ? mp.a : mp.b}`;
            usable = [map, v.slots[1].loadedPath].map((path) => path?.split('/')[1] ?? '');
          }
          detail.update({
            set,
            usable,
            orient: st.orient,
            camRel: [-p[0], -p[1], -p[2]],
            viewDir: ctx.pose.forward,
            halfDiag: Math.atan(Math.tan(ctx.fov / 2) * Math.hypot(1, aspect)),
            pxPerRad,
            radius: R,
            baseWidth: topTier,
            frame: this.frameNo,
          });
        }
      }

      // Marker: fade in as the disk shrinks below ~3 px.
      this.markerPos[i * 3] = p[0];
      this.markerPos[i * 3 + 1] = p[1];
      this.markerPos[i * 3 + 2] = p[2];
      // Planets are meaningless dots from interstellar distances.
      const farFade = 1 - THREE.MathUtils.smoothstep(Math.log(fromSun), Math.log(1000 * AU), Math.log(20000 * AU));
      // The Sun keeps a small "you are here" marker once it is lost among the stars.
      const markerA =
        def.kind === 'star'
          ? 0.7 * THREE.MathUtils.smoothstep(Math.log(fromSun), Math.log(200 * 206265 * AU), Math.log(2000 * 206265 * AU))
          : (1 - THREE.MathUtils.smoothstep(v.apparentPx, 1.5, 4)) * farFade;
      this.markerAlpha[i] = st.valid ? markerA * (ctx.settings.labels ? 1 : 0.6) : 0;
    });
    (this.markers.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.markers.geometry.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

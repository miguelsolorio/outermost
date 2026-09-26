// Real photographs of famous galaxies, placed as flat cards at each galaxy's
// catalog position and true angular size, oriented as they appear on our sky
// (north per the published image orientation). That is exactly how we see
// them from Earth; viewed from elsewhere they are still that same photograph,
// not a 3D model (a flat card, noted in the info card).

import * as THREE from 'three';
import { cross, length, normalize, type Vec3 } from '../../astro/vec.ts';
import { KPC, MPC } from '../../astro/units.ts';
import type { Assets } from '../../engine/assets.ts';
import { rel, type FrameCtx } from '../frame.ts';
import type { CosmosLayer } from './cosmos.ts';

interface SpriteMeta {
  key: string;
  source: string;
  galaxy?: string;
  ra?: number;
  dec?: number;
  distMpc?: number;
  sizeArcmin: number;
  north: number;
}

interface Sprite {
  meta: SpriteMeta;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** Heliocentric direction and distance. */
  dir: Vec3;
  distM: number;
  sizeM: number;
  basis: THREE.Matrix4;
}

const DEG = Math.PI / 180;

export class GalaxySpritesLayer {
  readonly group = new THREE.Group();
  sprites: Sprite[] = [];
  /** Galaxy catalog name -> source id of its photo (for credits). */
  readonly photoSource = new Map<string, string>();

  constructor(
    private assets: Assets,
    private cosmos: CosmosLayer,
  ) {}

  async init(): Promise<void> {
    const doc = await this.assets.json<{ sprites: SpriteMeta[] }>('galaxies/sprites/sprites.json');
    if (!doc) return;
    const plane = new THREE.PlaneGeometry(1, 1);
    for (const meta of doc.sprites) {
      const g = meta.galaxy ? this.cosmos.local.find((x) => x.name === meta.galaxy) : undefined;
      const ra = g?.ra ?? meta.ra;
      const dec = g?.dec ?? meta.dec;
      const dist = g?.dist_mpc ?? meta.distMpc;
      if (ra === undefined || dec === undefined || dist === undefined) continue;
      const dir: Vec3 = [Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG)];
      // Sky-plane basis as seen from Earth: north up and west to the right.
      const north = normalize([-dir[2] * dir[0], -dir[2] * dir[1], 1 - dir[2] * dir[2]]);
      const west = cross(dir, north);
      const t = meta.north * DEG;
      const xImg: Vec3 = [Math.cos(t) * west[0] + Math.sin(t) * north[0], Math.cos(t) * west[1] + Math.sin(t) * north[1], Math.cos(t) * west[2] + Math.sin(t) * north[2]];
      const yImg: Vec3 = [Math.cos(t) * north[0] - Math.sin(t) * west[0], Math.cos(t) * north[1] - Math.sin(t) * west[1], Math.cos(t) * north[2] - Math.sin(t) * west[2]];
      const distM = dist * MPC;
      const sizeM = (meta.sizeArcmin / 60) * DEG * distM;
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...xImg).multiplyScalar(sizeM),
        new THREE.Vector3(...yImg).multiplyScalar(sizeM),
        new THREE.Vector3(-dir[0], -dir[1], -dir[2]),
      );
      const material = new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_fragment>
          uniform sampler2D map;
          uniform float opacity;
          varying vec2 vUv;
          void main() {
            #include <logdepthbuf_fragment>
            vec3 c = texture2D(map, vUv).rgb;
            gl_FragColor = vec4(c * opacity * 1.4, 1.0);
          }`,
        uniforms: { map: { value: null }, opacity: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(plane, material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = -15;
      this.group.add(mesh);
      this.sprites.push({ meta, mesh, material, dir, distM, sizeM, basis });
      if (meta.galaxy) this.photoSource.set(meta.galaxy, meta.source);
      // KTX2 sprites were encoded with -y_flip (row 0 = bottom), matching uv.v.
      void this.assets.texture(`galaxies/sprites/${meta.key}-1024.ktx2`).then((tex) => {
        if (tex) material.uniforms.map.value = tex;
      });
    }
  }

  update(ctx: FrameCtx): void {
    const sun = ctx.world.get('sun').pos;
    const fromSun = length(rel(sun, ctx.cam));
    for (const s of this.sprites) {
      const pos: Vec3 = [sun[0] + s.dir[0] * s.distM, sun[1] + s.dir[1] * s.distM, sun[2] + s.dir[2] * s.distM];
      const p = rel(pos, ctx.cam);
      const d = length(p);
      // The Magellanic Clouds are already in the Milky Way sky map near the Sun.
      const leaveSun = THREE.MathUtils.smoothstep(fromSun, 20 * KPC, 60 * KPC);
      // Fade when inside the card's extent, and once it shrinks to a dot.
      const near = THREE.MathUtils.smoothstep(d, 0.35 * s.sizeM, 1.2 * s.sizeM);
      const px = (s.sizeM / d) * ctx.pxPerRad;
      const far = THREE.MathUtils.smoothstep(px, 3, 12);
      const a = leaveSun * near * far;
      s.mesh.visible = a > 0.01 && !!s.material.uniforms.map.value;
      if (!s.mesh.visible) continue;
      s.material.uniforms.opacity.value = a;
      s.mesh.matrix.copy(s.basis).setPosition(p[0], p[1], p[2]);
      s.mesh.matrixWorldNeedsUpdate = true;
    }
  }
}

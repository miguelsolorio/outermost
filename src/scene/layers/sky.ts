// Background sky: the NASA SVS Deep Star Maps 2020 "Milky Way" layer, the
// diffuse glow of the Galaxy plus faint Gaia stars (the bright Hipparcos and
// Tycho stars are omitted there because HYG draws them individually).
// It is the sky as seen from the Sun's neighborhood, so it fades out as the
// camera travels more than ~100 pc away, where the 3D galaxy model takes over.
//
// The map is plate carrée in ICRS: centered on RA 0h, RA increasing to the left.

import * as THREE from 'three';
import { length } from '../../astro/vec.ts';
import { PC } from '../../astro/units.ts';
import type { Assets } from '../../engine/assets.ts';
import { rel, type FrameCtx } from '../frame.ts';

export class SkyLayer {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private loadedWidth = 0;
  private loading = false;

  constructor(private assets: Assets) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vNdc;
        void main() {
          vNdc = position.xy;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform bool hasMap;
        uniform mat4 invViewProj;
        uniform float brightness;
        varying vec2 vNdc;
        void main() {
          if (!hasMap || brightness <= 0.0) discard;
          vec4 w = invViewProj * vec4(vNdc, 0.5, 1.0);
          vec3 d = normalize(w.xyz / w.w);
          float ra = atan(d.y, d.x);
          float dec = asin(clamp(d.z, -1.0, 1.0));
          vec2 uv = vec2(0.5 - ra / 6.2831853, 0.5 + dec / 3.1415927);
          // Explicit gradients avoid a mip seam where u wraps from 1 to 0.
          vec2 uvAlt = vec2(fract(uv.x + 0.5), uv.y);
          vec2 dx = dFdx(uv);
          vec2 dy = dFdy(uv);
          vec2 dxa = dFdx(uvAlt);
          vec2 dya = dFdy(uvAlt);
          if (dot(dxa, dxa) + dot(dya, dya) < dot(dx, dx) + dot(dy, dy)) { dx = dxa; dy = dya; }
          vec3 c = textureGrad(map, uv, dx, dy).rgb;
          gl_FragColor = vec4(c * brightness, 1.0);
        }`,
      uniforms: {
        map: { value: null },
        hasMap: { value: false },
        invViewProj: { value: new THREE.Matrix4() },
        brightness: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
  }

  private async load(width: number): Promise<void> {
    this.loading = true;
    const path = `textures/sky-milkyway/${width}.ktx2`;
    const tex = await this.assets.texture(path);
    this.loading = false;
    if (!tex) return;
    tex.wrapS = THREE.RepeatWrapping;
    const prev = this.loadedWidth;
    this.material.uniforms.map.value = tex;
    this.material.uniforms.hasMap.value = true;
    this.loadedWidth = width;
    if (prev) this.assets.release(`textures/sky-milkyway/${prev}.ktx2`);
  }

  update(ctx: FrameCtx): void {
    const tiers = this.assets.textureTiers('sky-milkyway');
    if (tiers.length && !this.loading) {
      const want = this.loadedWidth ? tiers[tiers.length - 1] : tiers[0];
      if (want > this.loadedWidth) void this.load(want);
    }
    const cam = ctx.camera;
    // Rotation-only view-projection: the sky is at infinity.
    const view = new THREE.Matrix4().makeRotationFromQuaternion(cam.quaternion).invert();
    this.material.uniforms.invViewProj.value.multiplyMatrices(cam.projectionMatrix, view).invert();
    const fromSun = length(rel(ctx.world.get('sun').pos, ctx.cam)) / PC;
    this.material.uniforms.brightness.value = ctx.skyBrightness * (1 - THREE.MathUtils.smoothstep(fromSun, 100, 1000));
  }
}

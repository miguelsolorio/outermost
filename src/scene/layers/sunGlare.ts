// Screen-facing glare around the Sun. The Sun's disk is rendered physically
// (limb-darkened sphere); this adds the soft scattering halo an eye or camera
// sees, so the Sun stays a dazzling point even from beyond Neptune. It is
// depth-tested at the Sun's center, so planets passing in front occlude it.

import * as THREE from 'three';
import { length } from '../../astro/vec.ts';
import { rel, type FrameCtx } from '../frame.ts';
import { AU } from '../../astro/units.ts';

export class SunGlareLayer {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float intensity;
        uniform float core; // disk radius as a fraction of the quad
        varying vec2 vUv;
        void main() {
          #include <logdepthbuf_fragment>
          float r = length(vUv);
          if (r > 1.0) discard;
          float x = max(r - core, 0.0) / (1.0 - core);
          // Two-component halo: a tight bright core falloff plus a wide faint wing.
          float g = exp(-x * x * 60.0) * 0.8 + exp(-x * 7.0) * 0.18 + (1.0 - x) * 0.02;
          vec3 c = vec3(1.0, 0.97, 0.92) * g * intensity;
          gl_FragColor = vec4(c, 1.0);
        }`,
      uniforms: { intensity: { value: 1 }, core: { value: 0.02 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  update(ctx: FrameCtx): void {
    const sun = ctx.world.get('sun');
    const p = rel(sun.pos, ctx.cam);
    const d = length(p);
    const R = sun.def.radii[0];
    // Angular radius of the halo: at least ~2.5 degrees on screen, larger up close.
    const diskAng = Math.asin(Math.min(1, R / Math.max(d, R * 1.001)));
    const haloAng = Math.max(diskAng * 6, 0.045);
    const size = Math.tan(haloAng) * d;
    this.mesh.position.set(p[0], p[1], p[2]);
    this.mesh.quaternion.copy(ctx.camera.quaternion);
    this.mesh.scale.setScalar(size);
    this.material.uniforms.core.value = Math.min(0.9, diskAng / haloAng);
    // Brightness follows 1/d² but compresses for display (the eye adapts).
    const au = d / AU;
    this.material.uniforms.intensity.value = 2.2 / Math.pow(Math.max(au, 0.05), 0.5);
    // Fade the halo as the disk grows large (the eye adapts to the photosphere),
    // and hand over to a star-like point far outside the planetary system.
    this.material.uniforms.intensity.value *= 1 - THREE.MathUtils.smoothstep(diskAng, 0.01, 0.12);
    this.material.uniforms.intensity.value *= 1 - THREE.MathUtils.smoothstep(au, 1000, 5000);
    this.mesh.visible = d > R * 1.05 && this.material.uniforms.intensity.value > 0.001;
  }
}

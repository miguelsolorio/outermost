// Screen-facing glare around the Sun. The Sun's disk is a sphere (bodies.ts);
// this adds the soft scattering halo an eye or camera sees, so the Sun stays
// a dazzling point even from beyond Neptune, and a glow spilling off the limb
// up close. It is depth-tested at the Sun's center, so planets passing in
// front occlude it.

import * as THREE from 'three';
import { length } from '../../astro/vec.ts';
import { rel, type FrameCtx } from '../frame.ts';
import { AU } from '../../astro/units.ts';
import { createGlare, layoutGlare } from '../shaders/glare.ts';

export class SunGlareLayer {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor() {
    ({ mesh: this.mesh, material: this.material } = createGlare());
  }

  update(ctx: FrameCtx): void {
    const sun = ctx.world.get('sun');
    const p = rel(sun.pos, ctx.cam);
    const d = length(p);
    const R = sun.def.radii[0];
    // Angular radius of the halo: at least ~2.5 degrees on screen, larger up close.
    const diskAng = Math.asin(Math.min(1, R / Math.max(d, R * 1.001)));
    this.mesh.position.set(p[0], p[1], p[2]);
    this.mesh.quaternion.copy(ctx.camera.quaternion);
    const close = layoutGlare(this.mesh, this.material, R, d, diskAng, 0.045);
    // Brightness follows 1/d² but compresses for display (the eye adapts).
    // As the disk grows large the dazzle fades quickly so it doesn't wash out
    // the resolving disk, leaving a dim orange glow to match the Sun's 304 Å
    // look up close; the limb shell (bodies.ts) draws the bright rim.
    const au = d / AU;
    const far = 2.2 / Math.pow(Math.max(au, 0.05), 0.5);
    let intensity = far * (1 - close) ** 2 + 0.06 * close;
    const lerp = THREE.MathUtils.lerp;
    this.material.uniforms.color.value.setRGB(1.0, lerp(0.97, 0.33, close), lerp(0.92, 0.06, close));
    // Hand over to a star-like point far outside the planetary system.
    intensity *= 1 - THREE.MathUtils.smoothstep(au, 1000, 5000);
    this.material.uniforms.intensity.value = intensity;
    this.mesh.visible = d > R * 1.05 && intensity > 0.001;
  }
}

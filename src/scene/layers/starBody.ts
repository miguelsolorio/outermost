// When you travel to a catalog star it becomes a real sphere: the estimated
// radius (from luminosity and B−V temperature) with solar-type limb darkening
// tinted by its blackbody color. Flagged as "derived/model" in its info card.
// A screen-facing glare makes it dazzle from afar; up close it tightens into a
// soft glow spilling off the limb, the way a camera sees a bright disk.

import * as THREE from 'three';
import { length } from '../../astro/vec.ts';
import { createBodySphere } from '../geometry.ts';
import { sunFragment, sunVertex } from '../shaders/sun.ts';
import { SUN_LIMB } from '../sunLimb.ts';
import { createGlare, layoutGlare } from '../shaders/glare.ts';
import { rel, type FrameCtx } from '../frame.ts';
import type { StarsLayer } from './stars.ts';

export class StarBodyLayer {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private glare: THREE.Mesh;
  private glareMat: THREE.ShaderMaterial;
  activeIndex = -1;

  constructor(private stars: StarsLayer) {
    const v3 = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
    this.material = new THREE.ShaderMaterial({
      vertexShader: sunVertex,
      fragmentShader: sunFragment,
      uniforms: {
        intensity: { value: 1 },
        tint: { value: new THREE.Vector3(1, 1, 1) },
        limbR: { value: [v3(SUN_LIMB.r.slice(0, 3)), v3(SUN_LIMB.r.slice(3))] },
        limbG: { value: [v3(SUN_LIMB.g.slice(0, 3)), v3(SUN_LIMB.g.slice(3))] },
        limbB: { value: [v3(SUN_LIMB.b.slice(0, 3)), v3(SUN_LIMB.b.slice(3))] },
      },
    });
    this.mesh = new THREE.Mesh(createBodySphere(128, 64), this.material);
    this.mesh.frustumCulled = false;
    ({ mesh: this.glare, material: this.glareMat } = createGlare());
    this.group.add(this.mesh, this.glare);
    this.group.visible = false;
  }

  /** Radius (m) set by the caller from the star's catalog data. */
  update(ctx: FrameCtx, index: number, radius: number): void {
    const cat = this.stars.catalog;
    if (!cat || index < 0) {
      this.group.visible = false;
      this.stars.hide(-1);
      this.activeIndex = -1;
      return;
    }
    this.activeIndex = index;
    const sun = ctx.world.get('sun').pos;
    const sp = this.stars.starPos(index, ctx.world.ms);
    const p = rel([sun[0] + sp[0], sun[1] + sp[1], sun[2] + sp[2]], ctx.cam);
    const d = length(p);
    const ang = Math.asin(Math.min(1, radius / Math.max(d, radius * 1.0001)));
    const px = ang * ctx.pxPerRad;
    this.group.visible = px > 0.3;
    // Hide the point sprite once the disk is resolved.
    this.stars.hide(px > 1.5 ? index : -1);
    if (!this.group.visible) return;

    const u8 = cat.u8;
    const o = index * 32 + 28;
    const lin = (c: number) => Math.pow(c / 255, 2.2);
    const color = [lin(u8[o]), lin(u8[o + 1]), lin(u8[o + 2])];
    this.mesh.position.set(p[0], p[1], p[2]);
    this.mesh.scale.setScalar(radius);
    this.material.uniforms.tint.value.set(color[0], color[1], color[2]);
    this.glare.position.set(p[0], p[1], p[2]);
    this.glare.quaternion.copy(ctx.camera.quaternion);
    const close = layoutGlare(this.glare, this.glareMat, radius, d, ang, 0.03);
    // Up close, keep the photosphere below tone-mapping saturation so its color survives.
    this.material.uniforms.intensity.value = THREE.MathUtils.lerp(6.0, 0.7, close);
    this.glareMat.uniforms.color.value.setRGB(color[0], color[1], color[2]);
    // The glare shrinks into a limb glow about as bright as the limb itself.
    this.glareMat.uniforms.intensity.value = THREE.MathUtils.lerp(1.6, 0.22, close) * THREE.MathUtils.smoothstep(px, 0.3, 3);
  }
}

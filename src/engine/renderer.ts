// Renderer setup. The three.js camera always sits at the origin; every object
// is placed at its float64 camera-relative position each frame, so the GPU
// never sees large coordinates.
//
// Depth: reversed-Z with a 32-bit float depth buffer when EXT_clip_control is
// available (precision is uniform in log-space across ~1e-1..1e27 m), falling
// back to three's logarithmic depth buffer otherwise.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LensingPass } from './lensingPass.ts';

export type DepthMode = 'reversed' | 'logarithmic';

export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  depthMode: DepthMode;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  /** Black hole lensing on the HDR scene; off unless a hole is close enough to bend the view. */
  lensing: LensingPass;
  bloom: UnrealBloomPass;
  pixelRatio: number;
  resize(): void;
  render(): void;
}

export const FOV_DEG = 45;

function probeClipControl(): boolean {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  const ok = !!gl?.getExtension('EXT_clip_control');
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return ok;
}

export function createRenderContext(canvas: HTMLCanvasElement, forceLog = false): RenderContext {
  const depthMode: DepthMode = !forceLog && probeClipControl() ? 'reversed' : 'logarithmic';
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // MSAA happens on the HDR target instead
    powerPreference: 'high-performance',
    reversedDepthBuffer: depthMode === 'reversed',
    logarithmicDepthBuffer: depthMode === 'logarithmic',
  });
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 1);

  const pixelRatio = Math.min(window.devicePixelRatio, 1.5);
  renderer.setPixelRatio(pixelRatio);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 1, 1e30);
  camera.position.set(0, 0, 0);
  camera.matrixAutoUpdate = true;

  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  const target = new THREE.WebGLRenderTarget(w * pixelRatio, h * pixelRatio, {
    type: THREE.HalfFloatType,
    samples: 4,
    depthBuffer: true,
  });
  // A float depth attachment is what makes reversed-Z worthwhile.
  target.depthTexture = new THREE.DepthTexture(w * pixelRatio, h * pixelRatio, THREE.FloatType);

  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const lensing = new LensingPass(depthMode === 'reversed');
  composer.addPass(lensing);
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.55, 1.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const ctx: RenderContext = {
    renderer,
    depthMode,
    scene,
    camera,
    composer,
    lensing,
    bloom,
    pixelRatio,
    resize() {
      const cw = canvas.clientWidth || window.innerWidth;
      const ch = canvas.clientHeight || window.innerHeight;
      renderer.setSize(cw, ch, false);
      composer.setSize(cw, ch);
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
    },
    render() {
      composer.render();
    },
  };
  ctx.resize();
  return ctx;
}

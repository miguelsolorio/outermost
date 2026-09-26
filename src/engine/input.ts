// Mouse, trackpad, touch and keyboard input for the camera controller.
//  - Wheel / pinch: zoom (log-scale), toward the cursor near a surface
//  - Drag: orbit       - Shift/right drag: tilt toward the horizon
//  - Double-click: fly to what's under the cursor
//  - Arrows orbit, +/- zoom, Space plays/pauses time

import type { CameraController } from './camera/controller.ts';
import type { Vec3 } from '../astro/vec.ts';

export interface InputHooks {
  /** Surface direction (unit, from focus center, world) under a CSS pixel, or null. */
  surfaceDirAt(x: number, y: number): Vec3 | null;
  /** Object id under a CSS pixel, or null. */
  pick(x: number, y: number): string | null;
  select(id: string | null): void;
  flyTo(id: string): void;
  fovRad(): number;
  onUserInteraction(): void;
  togglePause?(): void;
}

export function attachInput(el: HTMLElement, cam: CameraController, hooks: InputHooks): () => void {
  let dragging = false;
  let tiltDrag = false;
  let lastX = 0;
  let lastY = 0;
  let moved = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    hooks.onUserInteraction();
    // Normalize: trackpads send small pixel deltas, wheels send lines.
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    const dy = e.deltaY * unit;
    const speed = e.ctrlKey ? 0.01 : 0.0022; // ctrl+wheel = trackpad pinch
    cam.zoom(dy * speed, dy < 0 ? hooks.surfaceDirAt(e.offsetX, e.offsetY) : null);
  };

  const onDown = (e: PointerEvent) => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    hooks.onUserInteraction();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      dragging = false;
      return;
    }
    dragging = true;
    tiltDrag = e.shiftKey || e.button === 2;
    lastX = e.clientX;
    lastY = e.clientY;
    moved = 0;
    cam.stopInertia();
  };

  const onMove = (e: PointerEvent) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0 && d > 0) cam.zoom(-Math.log(d / pinchDist) * 1.6);
      pinchDist = d;
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (tiltDrag) cam.tiltBy(dy, el.clientHeight);
    else cam.orbit(dx, dy, el.clientHeight, hooks.fovRad());
  };

  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (!dragging) return;
    dragging = false;
    if (moved < 4) {
      // A click: select what's under the cursor (or clear).
      cam.stopInertia();
      hooks.select(hooks.pick(e.offsetX, e.offsetY));
    }
  };

  const onDbl = (e: MouseEvent) => {
    const id = hooks.pick(e.offsetX, e.offsetY);
    if (id) hooks.flyTo(id);
  };

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
    const step = 40;
    switch (e.key) {
      case 'ArrowLeft':
        cam.orbit(step, 0, el.clientHeight, hooks.fovRad());
        break;
      case 'ArrowRight':
        cam.orbit(-step, 0, el.clientHeight, hooks.fovRad());
        break;
      case 'ArrowUp':
        cam.orbit(0, step, el.clientHeight, hooks.fovRad());
        break;
      case 'ArrowDown':
        cam.orbit(0, -step, el.clientHeight, hooks.fovRad());
        break;
      case '=':
      case '+':
        cam.zoom(-0.35);
        break;
      case '-':
      case '_':
        cam.zoom(0.35);
        break;
      case ' ':
        hooks.togglePause?.();
        break;
      default:
        return;
    }
    e.preventDefault();
    hooks.onUserInteraction();
  };

  const noMenu = (e: Event) => e.preventDefault();

  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('dblclick', onDbl);
  el.addEventListener('contextmenu', noMenu);
  window.addEventListener('keydown', onKey);
  return () => {
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('dblclick', onDbl);
    el.removeEventListener('contextmenu', noMenu);
    window.removeEventListener('keydown', onKey);
  };
}

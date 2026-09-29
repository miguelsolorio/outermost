// Mouse, trackpad, touch and keyboard input for the camera controller.
//  - Wheel / pinch: zoom (log-scale), toward the cursor near a surface
//  - Drag: orbit       - Shift/right drag: tilt toward the horizon
//  - Space-drag / middle drag: pan off the focus (a tap of Space plays/pauses time)
//  - Space-wheel / Space-pinch: fly toward the cursor, through whatever is in the way
//  - Double-click: fly to what's under the cursor
//  - Arrows orbit, +/- zoom, F toggles free mode, C recenters
// Free mode is map-like: drag pans, the wheel zooms toward the cursor,
// right/Shift drag orbits, Alt drag tilts and the arrows pan.

import type { CameraController } from './camera/controller.ts';
import type { Vec3 } from '../astro/vec.ts';

export interface InputHooks {
  /** Surface direction (unit, from focus center, world) under a CSS pixel, or null. */
  surfaceDirAt(x: number, y: number): Vec3 | null;
  /** Object id under a CSS pixel, or null. */
  pick(x: number, y: number): string | null;
  select(id: string | null): void;
  flyTo(id: string): void;
  /** World ray (unit) through a CSS pixel. */
  rayAt(x: number, y: number): Vec3;
  fovRad(): number;
  freeMode(): boolean;
  toggleFreeMode(): void;
  /** Fly back to center on the body a pan left. */
  recenter(): void;
  onUserInteraction(): void;
  togglePause?(): void;
}

export function attachInput(el: HTMLElement, cam: CameraController, hooks: InputHooks): () => void {
  let dragging = false;
  let mode: 'orbit' | 'tilt' | 'pan' = 'orbit';
  // Space held to pan; a tap without a drag plays/pauses on release.
  let spaceHeld = false;
  let spacePanned = false;
  let lastX = 0;
  let lastY = 0;
  let moved = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;

  const setCursor = () => {
    el.style.cursor = dragging && mode === 'pan' ? 'grabbing' : spaceHeld || hooks.freeMode() ? 'grab' : '';
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    hooks.onUserInteraction();
    // Normalize: trackpads send small pixel deltas, wheels send lines.
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    const dy = e.deltaY * unit;
    const speed = e.ctrlKey ? 0.01 : 0.0022; // ctrl+wheel = trackpad pinch
    if (spaceHeld) {
      spacePanned = true;
      cam.fly(dy * speed, hooks.rayAt(e.offsetX, e.offsetY));
    } else if (hooks.freeMode()) cam.zoom(dy * speed, null, hooks.rayAt(e.offsetX, e.offsetY));
    else cam.zoom(dy * speed, dy < 0 ? hooks.surfaceDirAt(e.offsetX, e.offsetY) : null);
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
    // Middle-button autoscroll would fight the pan.
    if (e.button === 1) e.preventDefault();
    dragging = true;
    const free = hooks.freeMode();
    if (spaceHeld || e.button === 1 || (free && e.button === 0 && !e.shiftKey && !e.altKey)) mode = 'pan';
    else if (free) mode = e.altKey ? 'tilt' : 'orbit';
    else mode = e.shiftKey || e.button === 2 ? 'tilt' : 'orbit';
    if (spaceHeld) spacePanned = true;
    setCursor();
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
    if (!dragging) {
      if (e.pointerType === 'mouse') setCursor();
      return;
    }
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (mode === 'pan') cam.pan(dx, dy, el.clientHeight, hooks.fovRad());
    else if (mode === 'tilt') cam.tiltBy(dy, el.clientHeight);
    else cam.orbit(dx, dy, el.clientHeight, hooks.fovRad());
  };

  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (!dragging) return;
    dragging = false;
    setCursor();
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
    // Arrows pan in free mode, orbit otherwise.
    const move = (dx: number, dy: number) =>
      hooks.freeMode() ? cam.pan(dx, dy, el.clientHeight, hooks.fovRad()) : cam.orbit(dx, dy, el.clientHeight, hooks.fovRad());
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    switch (e.key) {
      case 'ArrowLeft':
        move(step, 0);
        break;
      case 'ArrowRight':
        move(-step, 0);
        break;
      case 'ArrowUp':
        move(0, step);
        break;
      case 'ArrowDown':
        move(0, -step);
        break;
      case 'f':
      case 'F':
        if (!plain) return;
        hooks.toggleFreeMode();
        setCursor();
        break;
      case 'c':
      case 'C':
        if (!plain) return;
        hooks.recenter();
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
        if (!e.repeat) {
          spaceHeld = true;
          spacePanned = dragging;
          setCursor();
        }
        break;
      default:
        return;
    }
    e.preventDefault();
    hooks.onUserInteraction();
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== ' ' || !spaceHeld) return;
    spaceHeld = false;
    setCursor();
    e.preventDefault();
    if (!spacePanned) hooks.togglePause?.();
  };

  const onBlur = () => {
    spaceHeld = false;
    setCursor();
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
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return () => {
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('dblclick', onDbl);
    el.removeEventListener('contextmenu', noMenu);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}

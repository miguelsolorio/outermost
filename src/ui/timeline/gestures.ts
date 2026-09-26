// Pointer input for the timeline: one-finger drag, two-finger pinch and pan,
// trackpad pinch (ctrl + wheel in Chrome and Firefox, gesture events in
// Safari) and the scroll wheel. x values are relative to the element.

export interface DragState {
  x: number;
  x0: number;
  /** Past a 3px dead zone, so a press that barely moves is still a click. */
  moved: boolean;
}

export interface GestureHandlers {
  down?(st: DragState): void;
  move?(st: DragState): void;
  up?(st: DragState): void;
  /** A second finger landed mid-drag; the drag is over and a pinch begins. */
  cancel?(st: DragState): void;
  hover?(x: number): void;
  leave?(): void;
  /** f > 1 zooms out, anchored at x. */
  zoom?(f: number, x: number): void;
  /** Two-finger drag, in px. */
  pan?(dx: number): void;
  /** Horizontal wheel or trackpad swipe, in px. */
  wheelPan?(dx: number): void;
}

// Safari's non-standard trackpad pinch event.
type GestureEvent = UIEvent & { scale: number; clientX: number };

export function gestures(el: HTMLElement, h: GestureHandlers): () => void {
  const pts = new Map<number, number>();
  let mode: 'drag' | 'pinch' | 'done' | null = null;
  let st: DragState = { x: 0, x0: 0, moved: false };
  let pinch = { d: 1, m: 0 };
  const rel = (e: { clientX: number }) => e.clientX - el.getBoundingClientRect().left;

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // not an active pointer
    }
    pts.set(e.pointerId, rel(e));
    if (pts.size === 1) {
      mode = 'drag';
      st = { x: rel(e), x0: rel(e), moved: false };
      h.down?.(st);
    } else if (pts.size === 2) {
      if (mode === 'drag') h.cancel?.(st);
      mode = 'pinch';
      const [a, b] = [...pts.values()];
      pinch = { d: Math.max(1, Math.abs(a - b)), m: (a + b) / 2 };
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return h.hover?.(rel(e));
    pts.set(e.pointerId, rel(e));
    if (mode === 'drag') {
      st.x = rel(e);
      if (Math.abs(st.x - st.x0) > 3) st.moved = true;
      h.move?.(st);
    } else if (mode === 'pinch' && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.max(1, Math.abs(a - b)), m = (a + b) / 2;
      h.zoom?.(pinch.d / d, m);
      h.pan?.(m - pinch.m);
      pinch = { d, m };
    }
  };
  const onUp = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (mode === 'drag') {
      st.x = rel(e);
      mode = null;
      h.up?.(st);
    } else if (mode === 'pinch' && pts.size < 2) mode = 'done';
    if (!pts.size && mode === 'done') mode = null;
  };
  const onLeave = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) h.leave?.();
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const x = rel(e);
    if (e.ctrlKey) h.zoom?.(Math.exp(e.deltaY * 0.012), x);
    else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) h.wheelPan?.(e.deltaX);
    else h.zoom?.(Math.exp(e.deltaY * 0.0025), x);
  };
  let gs = 1, gx = 0;
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    gs = 1;
    gx = rel(e as GestureEvent);
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    const scale = (e as GestureEvent).scale;
    h.zoom?.(gs / scale, gx);
    gs = scale;
  };
  const prevent = (e: Event) => e.preventDefault();

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('gesturestart', onGestureStart);
  el.addEventListener('gesturechange', onGestureChange);
  el.addEventListener('gestureend', prevent);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('pointerleave', onLeave);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('gesturestart', onGestureStart);
    el.removeEventListener('gesturechange', onGestureChange);
    el.removeEventListener('gestureend', prevent);
  };
}

// Choreography for the demo video: actions that play out over video frames and
// move, click, drag, scroll and type the way a person does. Each action is an
// async generator that sends this frame's input and then yields once; the
// recorder renders a frame per yield. Compose them with `yield*` in sequence,
// or with `together()` to run several in lockstep.

import type { Page } from '@playwright/test';
import type { CursorState } from './inject.ts';

export type Action = AsyncGenerator<void, void, void>;
export type Point = [number, number];
/** A point, or a selector (aimed near the middle of its first match, or at `at` as fractions of its box). */
export type Target = Point | string | { sel: string; at?: Point };

export const FPS = 60;
/** The page size in CSS px (1920×1080 at the recorder's 1.5× scale). */
export const VIEW = { width: 1280, height: 720 };
const MS = 1000 / FPS;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
/** Minimum-jerk profile: how hands move between two points. */
const minJerk = (u: number) => u * u * u * (10 - 15 * u + 6 * u * u);
const lerp = (a: Point, b: Point, u: number): Point => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
const bezier = (p0: Point, p1: Point, p2: Point, p3: Point, u: number): Point => {
  const v = 1 - u;
  const a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Director {
  /** Video frames rendered so far; the recorder advances it. */
  frame = 0;
  readonly cursor: CursorState = { x: 1400, y: 820, down: false, hidden: false, pressedAt: -1e9 };
  /** Input the page should have seen before the next frame renders. */
  readonly sent = { pointermove: 0, wheel: 0 };
  readonly marks: Record<string, number> = {};
  readonly page: Page;
  private sentAt: Point = [NaN, NaN];
  private rand: () => number;
  private phase: number[];

  constructor(page: Page, seed: number) {
    this.page = page;
    this.rand = mulberry32(seed);
    this.phase = [0, 1, 2, 3].map(() => this.rand() * Math.PI * 2);
  }

  /** Video time in ms. */
  get t(): number {
    return this.frame * MS;
  }

  /** Remember the current time under a name (e.g. where to grab the poster frame). */
  mark(name: string): void {
    this.marks[name] = this.t / 1000;
  }

  private between(a: number, b: number): number {
    return a + (b - a) * this.rand();
  }

  private frames(seconds: number): number {
    return Math.max(1, Math.round(seconds * FPS));
  }

  // ---- low-level input ----------------------------------------------------------

  /** Put the pointer at (x, y): the drawn cursor exactly, the real pointer to the nearest 1/100 px. */
  private async point(x: number, y: number): Promise<void> {
    this.cursor.x = x;
    this.cursor.y = y;
    const rx = Math.round(x * 100) / 100;
    const ry = Math.round(y * 100) / 100;
    if (rx === this.sentAt[0] && ry === this.sentAt[1]) return;
    if (Math.hypot(rx - this.sentAt[0], ry - this.sentAt[1]) > 2) this.cursor.hidden = false;
    this.sentAt = [rx, ry];
    await this.page.mouse.move(rx, ry);
    // Off the page (the cursor starts outside it) there's no event to wait for.
    if (rx >= 0 && ry >= 0 && rx < VIEW.width && ry < VIEW.height) this.sent.pointermove++;
  }

  private async resolve(target: Target): Promise<Point> {
    if (Array.isArray(target)) return target;
    const { sel, at } = typeof target === 'string' ? { sel: target, at: undefined } : target;
    const box = await this.page.locator(sel).first().boundingBox();
    if (!box) throw new Error(`demo: nothing visible matches ${sel}`);
    // People don't hit dead center: somewhere in the middle half, unless told.
    const [fx, fy] = at ?? [this.between(0.38, 0.62), this.between(0.4, 0.6)];
    return [box.x + box.width * fx, box.y + box.height * fy];
  }

  /** A clear spot on the scene near `p`, off labels and the HUD, so a press or scroll reaches the camera. */
  async clear(p: Point): Promise<Point> {
    return this.page.evaluate(([x, y]) => (window as unknown as { __demo: { clearPoint(x: number, y: number): [number, number] } }).__demo.clearPoint(x, y), p);
  }

  // ---- actions ----------------------------------------------------------------------

  /** Stay put, with the small drift of a hand resting on a trackpad. */
  async *hold(seconds: number): Action {
    const [x0, y0] = [this.cursor.x, this.cursor.y];
    const n = this.frames(seconds);
    const [a, b, c, d] = this.phase;
    for (let i = 0; i < n; i++) {
      const s = (this.frame + i) / FPS;
      const amp = this.cursor.down || this.cursor.hidden ? 0 : Math.min(1, i / 30);
      await this.point(x0 + amp * (0.9 * Math.sin(s * 0.9 + a) + 0.5 * Math.sin(s * 2.3 + b)), y0 + amp * (0.7 * Math.sin(s * 1.1 + c) + 0.4 * Math.sin(s * 1.9 + d)));
      yield;
    }
    await this.point(x0, y0);
  }

  /** Glide to a target along a gently bowed path; long moves overshoot a little and settle. */
  async *moveTo(target: Target, opts: { seconds?: number; overshoot?: boolean } = {}): Action {
    const from: Point = [this.cursor.x, this.cursor.y];
    const to = await this.resolve(target);
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (dist < 0.5) return;
    // Fitts's law, roughly: longer and smaller-target moves take longer.
    const seconds = opts.seconds ?? clamp(0.3 + 0.12 * Math.log2(1 + dist / 40), 0.32, 0.95);
    const n = this.frames(seconds);
    const dir: Point = [(to[0] - from[0]) / dist, (to[1] - from[1]) / dist];
    const normal: Point = [-dir[1], dir[0]];
    const bow = dist * this.between(-0.1, 0.1);
    const overshoot = (opts.overshoot ?? dist > 260) ? Math.min(14, dist * 0.025) : 0;
    const end: Point = [to[0] + dir[0] * overshoot, to[1] + dir[1] * overshoot];
    const c1: Point = [from[0] + (end[0] - from[0]) * 0.3 + normal[0] * bow, from[1] + (end[1] - from[1]) * 0.3 + normal[1] * bow];
    const c2: Point = [from[0] + (end[0] - from[0]) * 0.75 + normal[0] * bow * 0.5, from[1] + (end[1] - from[1]) * 0.75 + normal[1] * bow * 0.5];
    const main = overshoot ? Math.round(n * 0.82) : n;
    for (let i = 1; i <= main; i++) {
      await this.point(...bezier(from, c1, c2, end, minJerk(i / main)));
      yield;
    }
    for (let i = 1; i <= n - main; i++) {
      await this.point(...lerp(end, to, minJerk(i / (n - main))));
      yield;
    }
  }

  async *press(): Action {
    await this.page.mouse.down();
    this.cursor.down = true;
    this.cursor.pressedAt = this.t;
    yield;
  }

  async *release(): Action {
    await this.page.mouse.up();
    this.cursor.down = false;
    yield;
  }

  /** Move to a target, settle on it for a moment, and click. */
  async *click(target?: Target): Action {
    if (target) yield* this.moveTo(target);
    yield* this.hold(this.between(0.15, 0.3));
    yield* this.press();
    yield* this.hold(this.between(0.05, 0.08));
    yield* this.release();
  }

  /**
   * Move by (dx, dy) over `seconds` along a slightly curved, eased path,
   * pressed or not. It ends on sub-pixel moves, so a drag stops the camera
   * rather than leaving it coasting; `fling` ends mid-motion instead, and
   * `until` (a page expression) stops it as soon as it holds.
   */
  async *glide(by: Point, seconds: number, opts: { curve?: number; fling?: boolean; until?: string } = {}): Action {
    const from: Point = [this.cursor.x, this.cursor.y];
    const to: Point = [from[0] + by[0], from[1] + by[1]];
    const len = Math.hypot(...by) || 1;
    const bend = (opts.curve ?? this.between(-0.08, 0.08)) * len;
    const mid: Point = [(from[0] + to[0]) / 2 - (by[1] / len) * bend, (from[1] + to[1]) / 2 + (by[0] / len) * bend];
    const n = this.frames(seconds);
    const stop = opts.fling ? Math.round(n * 0.7) : n;
    for (let i = 1; i <= stop; i++) {
      const u = opts.fling ? (i / n) ** 1.6 : minJerk(i / n);
      await this.point(...bezier(from, lerp(from, mid, 0.66), lerp(to, mid, 0.66), to, u));
      yield;
      // Stop where something turns up (a tooltip, say), as a person would.
      if (opts.until && (await this.page.evaluate(opts.until))) return;
    }
  }

  /** Press, glide by (dx, dy), and let go. */
  async *drag(by: Point, seconds: number, opts: { curve?: number; fling?: boolean } = {}): Action {
    yield* this.press();
    yield* this.hold(this.between(0.06, 0.12));
    yield* this.glide(by, seconds, opts);
    if (!opts.fling) yield* this.hold(this.between(0.08, 0.14));
    yield* this.release();
  }

  /**
   * A trackpad scroll: deltas ramp up under the fingers and then decay as
   * momentum. Over the scene it zooms the camera; with `ctrl` it's a pinch.
   * If a label drifts under the pointer, the event goes to the scene anyway,
   * since a label would swallow it.
   */
  async *wheel(total: number, seconds: number, opts: { ctrl?: boolean; scene?: boolean } = {}): Action {
    const n = this.frames(seconds);
    const tau = n / 4;
    const w = Array.from({ length: n }, (_, k) => (1 - Math.exp(-(k + 1) / 1.6)) * Math.exp(-k / tau));
    const sum = w.reduce((a, b) => a + b, 0);
    if (opts.ctrl) await this.page.keyboard.down('Control');
    for (const wk of w) {
      const dy = (total * wk) / sum;
      const onScene = opts.scene ?? !opts.ctrl;
      const blocked = onScene && (await this.page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id !== 'scene', [this.cursor.x, this.cursor.y] as Point));
      if (blocked) {
        await this.page.evaluate(
          ([x, y, d, ctrl]) =>
            document.getElementById('scene')!.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: d, deltaMode: 0, ctrlKey: !!ctrl, bubbles: true, cancelable: true })),
          [this.cursor.x, this.cursor.y, dy, opts.ctrl ? 1 : 0] as const,
        );
      } else await this.page.mouse.wheel(0, dy);
      this.sent.wheel++;
      yield;
    }
    if (opts.ctrl) await this.page.keyboard.up('Control');
  }

  /** A key or chord, e.g. 'Enter', '/', 'ControlOrMeta+k'. */
  async *key(combo: string, after = this.between(0.12, 0.2)): Action {
    await this.page.keyboard.press(combo);
    if (!/^(Control|Meta|ControlOrMeta|Shift|Alt)/.test(combo)) this.cursor.hidden = true;
    yield* this.hold(after);
  }

  /** Type like a person: uneven gaps, a little faster mid-word, and optionally one slip fixed with backspace. */
  async *type(text: string, opts: { typo?: { at: number; wrong: string } } = {}): Action {
    const gap = () => clamp(Math.exp(Math.log(0.105) + 0.35 * (this.rand() * 2 - 1) * 1.4), 0.06, 0.2);
    this.cursor.hidden = true;
    for (let i = 0; i < text.length; i++) {
      if (opts.typo?.at === i) {
        await this.page.keyboard.type(opts.typo.wrong);
        yield* this.hold(gap() + this.between(0.18, 0.3));
        await this.page.keyboard.press('Backspace');
        yield* this.hold(gap());
      }
      await this.page.keyboard.type(text[i]);
      yield* this.hold(text[i] === ' ' ? gap() * 1.5 : gap());
    }
  }

  /** Frames until a condition in the page holds (or the timeout, which throws). */
  async *until(fn: string, timeout = 10, what = fn): Action {
    for (let i = 0; !(await this.page.evaluate(fn)); i++) {
      if (i > timeout * FPS) throw new Error(`demo: timed out waiting for ${what}`);
      yield;
    }
  }

  /** Wait out a camera flight: for it to start, then to land (a landmark pulls back and moves the clock first). */
  async *waitFlight(): Action {
    yield* this.until('app.travelling', 2, 'a flight to start');
    yield* this.until('!app.travelling', 14, 'the flight to land');
  }

  /** Fail early if the search or palette row that Enter would pick isn't the one named `name`. */
  async expectPick(list: string, name: string): Promise<void> {
    const row = (await this.page.locator(`${list} [role=option][aria-selected=true] .name`).first().textContent())?.trim();
    if (row !== name) throw new Error(`demo: expected Enter in ${list} to pick "${name}", not "${row}"`);
  }

  /** Hold while the frame fades between clear (0) and black (1). */
  async *fade(from: number, to: number, seconds: number): Action {
    const n = this.frames(seconds);
    const cover = async function* (this: Director): Action {
      for (let i = 1; i <= n; i++) {
        const u = i / n;
        await this.page.evaluate((o) => (window as unknown as { __demo: { cover(o: number): void } }).__demo.cover(o), from + (to - from) * u * u * (3 - 2 * u));
        yield;
      }
    };
    yield* this.together(this.hold(seconds), cover.call(this));
  }

  /** Run actions side by side, one frame at a time, until all have finished. */
  async *together(...actions: Action[]): Action {
    let live = actions;
    while (live.length) {
      const next: Action[] = [];
      for (const a of live) if (!(await a.next()).done) next.push(a);
      live = next;
      if (live.length) yield;
    }
  }
}

import { describe, expect, it } from 'vitest';
import { ABOVE_CONSOLE, buildCockpitFrame, consoleHeight, EDGE_INSET, panelTransform, project, SILL, type CockpitInput } from '../../src/engine/cockpit.ts';
import type { CameraPose } from '../../src/engine/camera/controller.ts';
import { add, cross, normalize, rotateAxisAngle, scale, type Vec3 } from '../../src/astro/vec.ts';

const DEG = Math.PI / 180;
const FOV = (45 * Math.PI) / 180;
const W = 1280;
const H = 720;
const ship = { fwd: [0, 1, 0] as Vec3, up: [0, 0, 1] as Vec3 };

/** The camera pose with the head turned right by `yaw` and up by `pitch` (rad), as the ship composes it. */
function pose(yaw = 0, pitch = 0): CameraPose {
  const right = cross(ship.fwd, ship.up);
  const r1 = rotateAxisAngle(right, ship.up, -yaw);
  const f1 = rotateAxisAngle(ship.fwd, ship.up, -yaw);
  const forward = normalize(rotateAxisAngle(f1, r1, pitch));
  const up = normalize(rotateAxisAngle(ship.up, r1, pitch));
  return { position: [0, 0, 0], pivot: [0, 0, 0], offset: [0, 0, 0], forward, up, right: normalize(r1), r: 1 };
}

const input = (p: CameraPose, target: CockpitInput['target'] = null): CockpitInput => ({ pose: p, ship, drift: null, target, w: W, h: H, fov: FOV });
const firstX = (d: string): number => Number(/^M(-?[\d.]+)/.exec(d)![1]);

describe('cockpit overlay', () => {
  it('puts the nose at the center when looking straight ahead', () => {
    const f = buildCockpitFrame(input(pose()));
    expect(f.nose!.x).toBeCloseTo(W / 2, 6);
    expect(f.nose!.y).toBeCloseTo(H / 2, 6);
  });

  it('moves the canopy the other way when you look right', () => {
    const ahead = buildCockpitFrame(input(pose()));
    const right = buildCockpitFrame(input(pose(10 * (Math.PI / 180))));
    // The windshield's top center starts the path.
    expect(firstX(ahead.canopy)).toBeCloseTo(W / 2, 3);
    expect(firstX(right.canopy)).toBeLessThan(W / 2 - 100);
    expect(right.nose!.x).toBeLessThan(W / 2);
    expect(ahead.dash).toMatch(/Z$/);
  });

  it('points an arrow at a target behind you, on the side to turn toward', () => {
    const p = pose();
    const behindRight = add(scale(p.forward, -1), scale(p.right, 0.1));
    const f = buildCockpitFrame(input(p, { rel: scale(normalize(behindRight), 1e9), dist: 1e9 }));
    expect(f.target!.edge).toBe(true);
    expect(f.target!.angle).toBeCloseTo(0, 6);
    expect(f.target!.x).toBeCloseTo(W - EDGE_INSET, 6);
    // Dead astern points down.
    const astern = buildCockpitFrame(input(p, { rel: scale(p.forward, -1e9), dist: 1e9 }));
    expect(astern.target!.angle).toBeCloseTo(-Math.PI / 2, 6);
    // Down is pointed at from just above the console.
    expect(astern.target!.y).toBeCloseTo(H - consoleHeight(H, FOV) - ABOVE_CONSOLE, 6);
  });

  it('points at a target hidden behind the console from above it', () => {
    const p = pose();
    const low = add(p.forward, scale(p.up, -0.36));
    const f = buildCockpitFrame(input(p, { rel: scale(normalize(low), 1e9), dist: 1e9 }));
    expect(f.target!.edge).toBe(true);
    expect(f.target!.y).toBeLessThan(H - consoleHeight(H, FOV));
  });

  it('puts the console top at the sill and the heading tape at the middle', () => {
    const f = buildCockpitFrame(input(pose()));
    const sill = project(add(ship.fwd, scale(ship.up, Math.tan(SILL * DEG))), pose(), W, H, FOV)!;
    expect(sill.y).toBeCloseTo(H - consoleHeight(H, FOV), 6);
    expect(f.rest).toBe(true);
    expect(f.tape!.x).toBeCloseTo(W / 2, 6);
    expect(f.tape!.y).toBeLessThan(H / 2);
  });

  it('brackets a target on screen', () => {
    const p = pose();
    const f = buildCockpitFrame(input(p, { rel: scale(add(p.forward, scale(p.up, 0.1)), 1e9), dist: 1e9 }));
    expect(f.target!.edge).toBe(false);
    expect(f.target!.x).toBeCloseTo(W / 2, 6);
    expect(f.target!.y).toBeLessThan(H / 2);
  });
});

describe('console panels', () => {
  const rect = { x: 300, y: 520, w: 480, h: 180 };
  /** Where the browser draws a panel point: the matrix, then the view's perspective. */
  function drawn(m: number[], f: number, x: number, y: number) {
    const X = m[0] * x + m[4] * y + m[12];
    const Y = m[1] * x + m[5] * y + m[13];
    const Z = m[2] * x + m[6] * y + m[14];
    const px = rect.x + X;
    const py = rect.y + Y;
    const k = f / (f - Z);
    return { x: W / 2 + (px - W / 2) * k, y: H / 2 + (py - H / 2) * k };
  }
  const parse = (s: string) => s.slice(9, -1).split(',').map(Number);

  it('is left alone looking straight ahead', () => {
    const f = buildCockpitFrame(input(pose()));
    const t = panelTransform(rect, f.head, [0, 0, 0], W, H, f.focal);
    expect(parse(t.matrix)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].map((v) => (v === 0 ? expect.closeTo(0, 9) : v)));
    expect(t.depth).toBeGreaterThan(0.8);
  });

  it('moves with the canopy as you look around', () => {
    for (const [yaw, pitch] of [[25, 0], [-25, 0], [0, -35], [20, -20]]) {
      const p = pose(yaw * DEG, pitch * DEG);
      const f = buildCockpitFrame(input(p));
      const m = parse(panelTransform(rect, f.head, [0, 0, 0], W, H, f.focal).matrix);
      const right = cross(ship.fwd, ship.up);
      for (const [x, y] of [[0, 0], [rect.w, 0], [0, rect.h], [rect.w, rect.h], [rect.w / 2, rect.h / 3]]) {
        // The same point on the panel, as a direction from the eye in the ship.
        const P: Vec3 = [rect.x + x - W / 2, H / 2 - rect.y - y, f.focal];
        const dir = add(add(scale(right, P[0]), scale(ship.up, P[1])), scale(ship.fwd, P[2]));
        const want = project(dir, p, W, H, FOV)!;
        const got = drawn(m, f.focal, x, y);
        expect(got.x).toBeCloseTo(want.x, 2);
        expect(got.y).toBeCloseTo(want.y, 2);
      }
    }
  });

  it('reports a panel turning out of view', () => {
    const f = buildCockpitFrame(input(pose(100 * DEG)));
    expect(panelTransform(rect, f.head, [0, 0, 0], W, H, f.focal).depth).toBeLessThan(0.2);
  });
});

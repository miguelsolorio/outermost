import { describe, expect, it } from 'vitest';
import { buildCockpitFrame, EDGE_INSET, type CockpitInput } from '../../src/engine/cockpit.ts';
import type { CameraPose } from '../../src/engine/camera/controller.ts';
import { add, cross, normalize, rotateAxisAngle, scale, type Vec3 } from '../../src/astro/vec.ts';

const FOV = (45 * Math.PI) / 180;
const W = 1280;
const H = 720;
const ship = { fwd: [0, 1, 0] as Vec3, up: [0, 0, 1] as Vec3 };

/** The camera pose with the head turned right by `yaw` (rad). */
function pose(yaw = 0): CameraPose {
  const right = cross(ship.fwd, ship.up);
  const forward = rotateAxisAngle(ship.fwd, ship.up, -yaw);
  return { position: [0, 0, 0], pivot: [0, 0, 0], offset: [0, 0, 0], forward, up: ship.up, right: rotateAxisAngle(right, ship.up, -yaw), r: 1 };
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
    expect(astern.target!.y).toBeCloseTo(H - EDGE_INSET, 6);
  });

  it('brackets a target on screen', () => {
    const p = pose();
    const f = buildCockpitFrame(input(p, { rel: scale(add(p.forward, scale(p.up, 0.1)), 1e9), dist: 1e9 }));
    expect(f.target!.edge).toBe(false);
    expect(f.target!.x).toBeCloseTo(W / 2, 6);
    expect(f.target!.y).toBeLessThan(H / 2);
  });
});

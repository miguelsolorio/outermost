import { describe, expect, it } from 'vitest';
import { CameraController, framingDistance, MAX_DISTANCE, type CameraPose } from '../../src/engine/camera/controller.ts';
import { ShipController, type ShipKind } from '../../src/engine/camera/ship.ts';
import { add, angleBetween, cross, dot, length, normalize, scale, sub, type Vec3 } from '../../src/astro/vec.ts';
import { AU, DT, FOV, fakeTargets } from './fakeWorld.ts';

const DEG = Math.PI / 180;
const KINDS: Record<string, ShipKind> = { sun: 'solid', earth: 'solid', moon: 'solid', mars: 'solid', saturn: 'solid', far: 'solid', craft: 'point', iss: 'point', uni: 'container' };

/** A ship entered from the orbit camera 2e7 m above Earth. */
function world() {
  const w = fakeTargets();
  const rate = { v: 1 };
  const ship = new ShipController({
    resolve: w.resolve,
    candidates: () => [...w.targets.keys()],
    kind: (id) => KINDS[id] ?? 'point',
    timeRate: () => rate.v,
    fovRad: () => FOV,
  });
  const cam = new CameraController(w.resolve);
  cam.set(['earth', 'sun'], 2e7, [0.3, -0.9, 0.3]);
  cam.update(0);
  ship.enter(cam.pose, 'earth', cam.viewChain);
  return { ...w, ship, cam, rate };
}

/** A pose at `offset` from `id`, facing `forward`. */
function poseAt(w: ReturnType<typeof world>, id: string, offset: Vec3, forward: Vec3, upHint: Vec3 = [0, 0, 1]): CameraPose {
  const pivot = w.resolve(id)!.pos();
  const f = normalize(forward);
  const right = normalize(cross(f, upHint));
  const up = cross(right, f);
  return { position: add(pivot, offset), pivot, offset, forward: f, up, right, r: length(offset) };
}

const posOf = (w: ReturnType<typeof world>): Vec3 => w.ship.pose.position;
/** Ship minus a target, computed near the ship's frame so it stays exact. */
const relTo = (w: ReturnType<typeof world>, id: string): Vec3 => add(sub(w.ship.pose.pivot, w.resolve(id)!.pos()), w.ship.pose.offset);
const shell = (w: ReturnType<typeof world>, id: string): number => {
  const t = w.targets.get(id)!;
  return t.radius + t.minAltitude;
};
const noInput = { thrust: [0, 0, 0] as Vec3, turn: [0, 0, 0] as Vec3, boost: false, fine: false };

describe('ship: entering and riding along', () => {
  it('takes over at exactly the orbit camera pose', () => {
    const w = world();
    const before = w.cam.pose;
    const p = w.ship.update(0);
    expect(length(sub(p.position, before.position)) / before.r).toBeLessThan(1e-9);
    expect(angleBetween(p.forward, before.forward)).toBeLessThan(1e-12);
    expect(angleBetween(p.up, before.up)).toBeLessThan(1e-12);
    expect(Math.abs(p.r / before.r - 1)).toBeLessThan(1e-9);
    // update(0) only reads.
    const again = w.ship.update(0);
    expect(again.position).toEqual(p.position);
  });

  it('moves with a moving reference body', () => {
    const w = world();
    w.now.speed = 1e-3;
    const r0 = relTo(w, 'earth');
    for (let i = 0; i < 600; i++) {
      w.now.t += DT;
      w.ship.update(DT);
    }
    expect(w.ship.focusId).toBe('earth');
    expect(length(sub(relTo(w, 'earth'), r0)) / length(r0)).toBeLessThan(1e-9);
  });

  it('stays with a spacecraft it entered at', () => {
    const w = world();
    w.now.speed = 1e-4;
    w.ship.enter(poseAt(w, 'iss', [0, 0, 7e6], [0, 0, -1], [0, 1, 0]), 'iss', ['iss', 'earth', 'sun']);
    const r0 = relTo(w, 'iss');
    for (let i = 0; i < 300; i++) {
      w.now.t += DT;
      w.ship.update(DT);
    }
    expect(w.ship.focusId).toBe('iss');
    expect(length(sub(relTo(w, 'iss'), r0)) / length(r0)).toBeLessThan(1e-9);
  });

  it('hands a vanished spacecraft frame to its parent without a jump', () => {
    const w = world();
    w.ship.enter(poseAt(w, 'iss', [0, 0, 7e6], [0, 0, -1], [0, 1, 0]), 'iss', ['iss', 'earth', 'sun']);
    w.ship.update(DT);
    const before = relTo(w, 'earth');
    w.gone.add('iss');
    w.ship.update(DT);
    expect(w.ship.focusId).toBe('earth');
    expect(length(sub(relTo(w, 'earth'), before)) / length(before)).toBeLessThan(1e-9);
  });
});

describe('ship: flying', () => {
  it('re-bases from Earth to the Moon with no jump in position or speed', () => {
    const w = world();
    w.now.speed = 1e-6;
    w.ship.enter(poseAt(w, 'earth', [0, 1e7, 0], [0, 1, 0]), 'earth', ['earth', 'sun']);
    w.ship.setControls({ ...noInput, thrust: [0, 0, 1] });
    const xs: Vec3[] = [];
    const rs: number[] = [];
    let switched = -1;
    for (let i = 0; i < 1800 && (switched < 0 || i < switched + 120); i++) {
      w.now.t += DT;
      w.ship.update(DT);
      xs.push(relTo(w, 'earth'));
      rs.push(w.ship.pose.r);
      if (switched < 0 && w.ship.focusId === 'moon') switched = i;
    }
    expect(switched).toBeGreaterThan(0);
    // Around the switch (well after spooling up from rest).
    for (let i = switched - 10; i < xs.length; i++) {
      const v1 = sub(xs[i], xs[i - 1]);
      const v0 = sub(xs[i - 1], xs[i - 2]);
      // The velocity changes smoothly: no step bigger than a tenth of the speed in one frame.
      expect(length(sub(v1, v0)), `frame ${i}`).toBeLessThan(0.1 * length(v0) + 1e-3);
      expect(Math.abs(Math.log(rs[i] / rs[i - 1]))).toBeLessThan(0.3);
    }
  });

  it('never enters a body, even at full boost with long frames', () => {
    const w = world();
    const S = shell(w, 'earth');
    w.ship.enter(poseAt(w, 'earth', [0, 3e7, 0], [0, -1, 0]), 'earth', ['earth', 'sun']);
    w.ship.setControls({ ...noInput, thrust: [0, 0, 1], boost: true });
    w.ship.nudge(50);
    for (let i = 0; i < 200; i++) {
      w.ship.update(0.1);
      expect(length(relTo(w, 'earth'))).toBeGreaterThanOrEqual(S * (1 - 1e-9));
    }
  });

  it('slides along a surface it thrusts into at an angle', () => {
    const w = world();
    const S = shell(w, 'earth');
    w.ship.enter(poseAt(w, 'earth', [0, 1.05 * S, 0], [1, -1, 0]), 'earth', ['earth', 'sun']);
    const a0 = Math.atan2(relTo(w, 'earth')[1], relTo(w, 'earth')[0]);
    w.ship.setControls({ ...noInput, thrust: [0, 0, 1] });
    for (let i = 0; i < 300; i++) {
      w.ship.update(DT);
      expect(length(relTo(w, 'earth'))).toBeGreaterThanOrEqual(S * (1 - 1e-9));
    }
    const a1 = Math.atan2(relTo(w, 'earth')[1], relTo(w, 'earth')[0]);
    expect(a0 - a1).toBeGreaterThan(0.05);
  });

  it('covers the scales in bounded time', () => {
    const time = (boost: boolean, alt0: number, until: (d: number) => boolean) => {
      const w = world();
      w.ship.enter(poseAt(w, 'earth', [6.371e6 + alt0, 0, 0], [1, 0, 0]), 'earth', ['earth', 'sun']);
      w.ship.setControls({ ...noInput, thrust: [0, 0, 1], boost });
      for (let i = 1; i < 60 * 60; i++) {
        w.ship.update(DT);
        if (until(length(relTo(w, 'earth')))) return i * DT;
      }
      return Infinity;
    };
    expect(time(false, 2e7, (d) => d > AU)).toBeLessThan(12);
    expect(time(true, 2e7, (d) => d > AU)).toBeLessThan(3.5);
    expect(time(true, 1e5, (d) => d > 1e26)).toBeLessThan(15);
  });

  it('slows to a stop at a surface without bouncing', () => {
    const w = world();
    const S = shell(w, 'mars');
    w.ship.enter(poseAt(w, 'mars', [0, 0, 1e9], [0, 0, -1], [0, 1, 0]), 'mars', ['mars', 'sun']);
    w.ship.setControls({ ...noInput, thrust: [0, 0, 1] });
    let last = Infinity;
    for (let i = 0; i < 60 * 30; i++) {
      w.ship.update(DT);
      const d = length(relTo(w, 'mars'));
      expect(d).toBeLessThanOrEqual(last * (1 + 1e-12));
      expect(d).toBeGreaterThanOrEqual(S * (1 - 1e-9));
      last = d;
    }
    expect(last / S).toBeLessThan(1.01);
  });

  it('coasts to rest when the controls are let go', () => {
    const w = world();
    w.ship.setControls({ ...noInput, thrust: [0, 0, 1] });
    for (let i = 0; i < 60; i++) w.ship.update(DT);
    w.ship.setControls(noInput);
    for (let i = 0; i < 180; i++) w.ship.update(DT);
    expect(length(w.ship.u)).toBeLessThan(0.01);
  });

  it('stops at an all-stop', () => {
    const w = world();
    w.ship.setControls({ ...noInput, thrust: [0, 0, 1], boost: true });
    for (let i = 0; i < 60; i++) w.ship.update(DT);
    w.ship.setControls(noInput);
    w.ship.stop();
    for (let i = 0; i < 60; i++) w.ship.update(DT);
    // From full boost (4 pace/s) to nearly nothing in a second.
    expect(length(w.ship.u)).toBeLessThan(0.01);
  });

  it('never goes past the edge of the observable universe', () => {
    const w = world();
    w.ship.enter(poseAt(w, 'uni', [1.25e27, 0, 0], [1, 0, 0]), 'uni', ['uni']);
    w.ship.setControls({ ...noInput, thrust: [0, 0, 1], boost: true });
    for (let i = 0; i < 600; i++) {
      w.ship.update(DT);
      expect(length(w.ship.pose.position)).toBeLessThanOrEqual(MAX_DISTANCE * (1 + 1e-12));
    }
  });
});

describe('ship: steering and looking', () => {
  it('turns the way the controls say', () => {
    const cases: Array<[Vec3, (a: { fwd: Vec3; up: Vec3; right: Vec3 }, b: { fwd: Vec3; up: Vec3 }) => number]> = [
      [[1, 0, 0], (a, b) => dot(b.fwd, a.up)], // pitch up: nose toward up
      [[0, 1, 0], (a, b) => dot(b.fwd, a.right)], // yaw right: nose toward right
      [[0, 0, 1], (a, b) => dot(b.up, a.right)], // roll right: up toward right
    ];
    for (const [turn, check] of cases) {
      const w = world();
      const a = { fwd: w.ship.fwd, up: w.ship.up, right: normalize(cross(w.ship.fwd, w.ship.up)) };
      w.ship.setControls({ ...noInput, turn });
      for (let i = 0; i < 20; i++) w.ship.update(DT);
      expect(check(a, { fwd: w.ship.fwd, up: w.ship.up })).toBeGreaterThan(0.05);
    }
  });

  it('grabs the sky: the middle of the view follows the pointer, holds still, and a flick coasts to rest', () => {
    const w = world();
    const H = 800;
    const f = H / 2 / Math.tan(FOV / 2);
    const p0 = w.ship.update(0);
    const d = p0.forward;
    w.ship.beginGrab();
    w.ship.grab(40, 25, H);
    const p1 = w.ship.pose;
    // Where the old middle of the view is now, in pixels from the middle.
    const z = dot(d, p1.forward);
    expect((f * dot(d, p1.right)) / z).toBeCloseTo(40, 0);
    expect((-f * dot(d, p1.up)) / z).toBeCloseTo(25, 0);
    // Held still, it doesn't drift.
    const held = w.ship.fwd;
    for (let i = 0; i < 30; i++) w.ship.update(DT);
    expect(angleBetween(w.ship.fwd, held)).toBeLessThan(1e-12);
    // A flick keeps turning after release, then comes to rest.
    for (let i = 0; i < 6; i++) {
      w.ship.grab(-20, 0, H);
      w.ship.update(DT);
    }
    w.ship.releaseGrab();
    const peak = length(w.ship.spin);
    expect(peak).toBeGreaterThan(0.5);
    for (let i = 0; i < 90; i++) w.ship.update(DT);
    expect(length(w.ship.spin)).toBeLessThan(0.01 * peak);
    // A press stops a flick at once.
    for (let i = 0; i < 6; i++) {
      w.ship.grab(-20, 0, H);
      w.ship.update(DT);
    }
    w.ship.releaseGrab();
    w.ship.beginGrab();
    const caught = w.ship.fwd;
    w.ship.update(DT);
    expect(angleBetween(w.ship.fwd, caught)).toBeLessThan(1e-12);
    w.ship.releaseGrab();
  });

  it('keeps an orthonormal basis', () => {
    const w = world();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < 10_000; i++) {
      if (i % 20 === 0) w.ship.setControls({ ...noInput, turn: [rnd(), rnd(), rnd()] });
      w.ship.update(DT);
    }
    expect(Math.abs(dot(w.ship.fwd, w.ship.up))).toBeLessThan(1e-12);
    expect(Math.abs(length(w.ship.fwd) - 1)).toBeLessThan(1e-12);
    expect(Math.abs(length(w.ship.up) - 1)).toBeLessThan(1e-12);
  });

  it('springs the head back to straight ahead, and flies along the heading while looking', () => {
    const w = world();
    const fwd = w.ship.fwd;
    w.ship.look(300, -100, 800);
    const p = w.ship.update(0);
    expect(angleBetween(p.forward, fwd)).toBeGreaterThan(10 * DEG);
    // Looking right: dragging left turns the head right, so the view looks right of the heading.
    expect(dot(p.forward, normalize(cross(w.ship.fwd, w.ship.up)))).toBeLessThan(0);
    const x0 = relTo(w, 'earth');
    w.ship.setControls({ ...noInput, thrust: [0, 0, 1] });
    for (let i = 0; i < 30; i++) w.ship.update(DT);
    const moved = normalize(sub(relTo(w, 'earth'), x0));
    expect(angleBetween(moved, fwd)).toBeLessThan(1e-6);
    w.ship.setControls(noInput);
    w.ship.releaseLook();
    for (let i = 0; i < 60; i++) w.ship.update(DT);
    expect(Math.abs(w.ship.head.yaw) + Math.abs(w.ship.head.pitch)).toBeLessThan(1e-3);
    expect(angleBetween(w.ship.pose.forward, w.ship.fwd)).toBeLessThan(1e-3);
  });
});

describe('ship: autopilot', () => {
  it('flies to Mars, arrives framed and facing it, and stays', () => {
    const w = world();
    w.ship.engage('mars');
    let prev = w.ship.pose.forward;
    let worstTurn = 0;
    let frames = 0;
    while (w.ship.flying && frames < 60 * 20) {
      w.ship.update(DT);
      frames++;
      worstTurn = Math.max(worstTurn, angleBetween(prev, w.ship.pose.forward));
      prev = w.ship.pose.forward;
      for (const id of ['earth', 'moon', 'sun', 'mars']) expect(length(relTo(w, id))).toBeGreaterThanOrEqual(shell(w, id) * (1 - 1e-9));
    }
    expect(w.ship.flying).toBe(false);
    for (let i = 0; i < 60; i++) w.ship.update(DT);
    expect(w.ship.focusId).toBe('mars');
    expect(w.ship.hold).toBe('mars');
    const Ad = framingDistance(w.targets.get('mars')!, FOV);
    const q = relTo(w, 'mars');
    expect(Math.abs(length(q) / Ad - 1)).toBeLessThan(0.01);
    expect(angleBetween(w.ship.pose.forward, normalize(scale(q, -1)))).toBeLessThan(0.5 * DEG);
    expect(worstTurn).toBeLessThan(2.5 * DEG);
    expect(length(w.ship.u) * w.ship.pace).toBeLessThan(1e-3 * Ad);
  });

  it('holds a moving Moon after arriving', () => {
    const w = world();
    w.now.speed = 1e-6;
    w.ship.engage('moon');
    for (let i = 0; i < 60 * 20 && w.ship.flying; i++) {
      w.now.t += DT;
      w.ship.update(DT);
    }
    expect(w.ship.flying).toBe(false);
    for (let i = 0; i < 120; i++) {
      w.now.t += DT;
      w.ship.update(DT);
    }
    const q0 = relTo(w, 'moon');
    for (let i = 0; i < 300; i++) {
      w.now.t += DT;
      w.ship.update(DT);
    }
    expect(w.ship.focusId).toBe('moon');
    expect(length(sub(relTo(w, 'moon'), q0)) / length(q0)).toBeLessThan(1e-6);
  });

  it('arrives at a black hole kiloparsecs away with the view pivoted exactly on it', () => {
    const w = world();
    w.ship.engage('far');
    for (let i = 0; i < 60 * 40 && w.ship.flying; i++) w.ship.update(DT);
    expect(w.ship.flying).toBe(false);
    for (let i = 0; i < 90; i++) w.ship.update(DT);
    const t = w.targets.get('far')!;
    expect(w.ship.focusId).toBe('far');
    expect(w.ship.pose.pivot).toEqual(t.pos());
    expect(Math.abs(length(w.ship.pose.offset) / t.framing! - 1)).toBeLessThan(0.01);
  });

  it('goes around a body in the way', () => {
    const w = world();
    // Earth sits between the ship and the Moon.
    w.ship.enter(poseAt(w, 'earth', [0, -3e7, 0], [0, 1, 0]), 'earth', ['earth', 'sun']);
    w.ship.engage('moon');
    let closest = Infinity;
    for (let i = 0; i < 60 * 30 && w.ship.flying; i++) {
      w.ship.update(DT);
      closest = Math.min(closest, length(relTo(w, 'earth')));
    }
    expect(w.ship.flying).toBe(false);
    expect(closest).toBeGreaterThan(1.2 * shell(w, 'earth'));
  });

  it('hands back to the pilot without a jump', () => {
    const w = world();
    w.ship.engage('mars');
    for (let i = 0; i < 150; i++) w.ship.update(DT);
    expect(w.ship.flying).toBe(true);
    const a = relTo(w, 'sun');
    w.ship.update(DT);
    const b = relTo(w, 'sun');
    w.ship.setControls({ ...noInput, turn: [0, 0.2, 0] });
    expect(w.ship.flying).toBe(false);
    w.ship.update(DT);
    const c = relTo(w, 'sun');
    const v0 = sub(b, a);
    expect(length(sub(sub(c, b), v0))).toBeLessThan(0.1 * length(v0));
  });

  it('turns to face a target without moving', () => {
    const w = world();
    const x0 = relTo(w, 'earth');
    w.ship.face('moon');
    for (let i = 0; i < 60 * 5 && w.ship.targetId; i++) w.ship.update(DT);
    expect(w.ship.targetId).toBe(null);
    expect(length(sub(relTo(w, 'earth'), x0))).toBeLessThan(1e-6);
    expect(angleBetween(w.ship.fwd, normalize(scale(relTo(w, 'moon'), -1)))).toBeLessThan(0.5 * DEG);
  });
});

describe('ship: throttle lever', () => {
  /** Heading straight out from Earth, 2e7 m up. */
  const outbound = () => {
    const w = world();
    w.ship.enter(poseAt(w, 'earth', [6.371e6 + 2e7, 0, 0], [1, 0, 0]), 'earth', ['earth', 'sun']);
    return w;
  };
  const run = (w: ReturnType<typeof world>, frames: number) => {
    for (let i = 0; i < frames; i++) w.ship.update(DT);
  };

  it('holds its pace with no keys held', () => {
    const w = outbound();
    const d0 = length(relTo(w, 'earth'));
    w.ship.setLever(1);
    run(w, 180);
    expect(Math.abs(dot(w.ship.u, w.ship.fwd) - 1)).toBeLessThan(0.02);
    expect(length(relTo(w, 'earth'))).toBeGreaterThan(5 * d0);
  });

  it('adds the keys on top', () => {
    const w = outbound();
    w.ship.setLever(1);
    w.ship.setControls({ ...noInput, thrust: [0, 0, 1] });
    run(w, 180);
    expect(Math.abs(dot(w.ship.u, w.ship.fwd) - 2)).toBeLessThan(0.05);
  });

  it('pulls back to stop and brakes, from the lever or an all-stop', () => {
    for (const halt of [(w: ReturnType<typeof world>) => w.ship.stop(), (w: ReturnType<typeof world>) => w.ship.setLever(0)]) {
      const w = outbound();
      w.ship.setLever(4);
      run(w, 60);
      halt(w);
      expect(w.ship.lever).toBe(0);
      run(w, 60);
      expect(length(w.ship.u)).toBeLessThan(0.01);
    }
  });

  it('stays within reverse and boost', () => {
    const w = outbound();
    w.ship.setLever(10);
    expect(w.ship.lever).toBe(4);
    w.ship.setLever(-5);
    expect(w.ship.lever).toBe(-1);
  });

  it('is the autopilot’s while it flies, and handed back at stop', () => {
    const w = world();
    w.ship.setLever(1);
    w.ship.engage('mars');
    expect(w.ship.lever).toBe(0);
    expect(w.ship.gauges().servo).toBe(true);
    for (let i = 0; i < 60 * 20 && w.ship.flying; i++) w.ship.update(DT);
    expect(w.ship.flying).toBe(false);
    expect(w.ship.lever).toBe(0);
    expect(w.ship.hold).toBe('mars');
    expect(w.ship.telemetry().servo).toBe(false);
  });

  it('takes over from the autopilot at the speed it was flying', () => {
    const w = world();
    w.ship.engage('mars');
    run(w, 150);
    expect(w.ship.flying).toBe(true);
    const drive = dot(w.ship.u, w.ship.fwd);
    const a = relTo(w, 'sun');
    w.ship.update(DT);
    const b = relTo(w, 'sun');
    const lever = w.ship.takeLever();
    expect(w.ship.flying).toBe(false);
    expect(lever).toBeCloseTo(Math.max(-1, Math.min(4, drive)), 6);
    w.ship.update(DT);
    const c = relTo(w, 'sun');
    const v0 = sub(b, a);
    expect(length(sub(sub(c, b), v0))).toBeLessThan(0.1 * length(v0));
  });

  it('keeps cruising while turning to face something', () => {
    const w = outbound();
    w.ship.setLever(1);
    run(w, 60);
    w.ship.face('mars');
    for (let i = 0; i < 60 * 5 && w.ship.targetId; i++) w.ship.update(DT);
    expect(w.ship.targetId).toBe(null);
    expect(w.ship.lever).toBe(1);
    expect(Math.abs(dot(w.ship.u, w.ship.fwd) - 1)).toBeLessThan(0.05);
  });

  it('starts at stop on entering', () => {
    const w = outbound();
    w.ship.setLever(2);
    w.ship.enter(w.cam.pose, 'earth', w.cam.viewChain);
    expect(w.ship.lever).toBe(0);
  });

  it('reads bank right wing down as positive, and level after leveling', () => {
    const w = world();
    w.ship.level();
    run(w, 180);
    expect(Math.abs(w.ship.gauges().bank)).toBeLessThan(0.5 * DEG);
    w.ship.setControls({ ...noInput, turn: [0, 0, 1] });
    run(w, 12);
    expect(w.ship.gauges().bank).toBeGreaterThan(2 * DEG);
  });
});

describe('ship: leaving', () => {
  it('hands the view back to the orbit camera exactly, then eases the roll', () => {
    const w = world();
    w.ship.setControls({ ...noInput, thrust: [0.3, 0, 1], turn: [0, 0, 0.5] });
    for (let i = 0; i < 60; i++) w.ship.update(DT);
    w.ship.setControls(noInput);
    const before = w.ship.update(0);
    const x = w.ship.exitView();
    w.cam.adopt(x.chain, x.view, x.r, { center: x.center, vel: x.vel, spin: x.spin });
    const p = w.cam.update(0);
    expect(length(sub(p.position, before.position)) / p.r).toBeLessThan(1e-9);
    expect(angleBetween(p.forward, before.forward)).toBeLessThan(1e-12);
    expect(angleBetween(p.up, before.up)).toBeLessThan(1e-9);
    for (let i = 0; i < 120; i++) w.cam.update(DT);
    expect(angleBetween(w.cam.view!.up, w.cam.upFor(w.cam.chain, w.cam.view!.r))).toBeLessThan(1e-6);
  });

  it('centers the body ahead when leaving while facing it', () => {
    const w = world();
    const x = w.ship.exitView();
    expect(x.center).toBe(true);
    w.cam.adopt(x.chain, x.view, x.r, { center: x.center });
    for (let i = 0; i < 120; i++) w.cam.update(DT);
    expect(w.cam.panned).toBe(false);
    const v = w.cam.view!;
    expect(length(sub(v.lookAt, w.resolve('earth')!.pos())) / v.r).toBeLessThan(1e-9);
  });
});

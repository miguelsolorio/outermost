import { describe, expect, it } from 'vitest';
import { CameraController, type FocusTarget, type View } from '../../src/engine/camera/controller.ts';
import { add, angleBetween, dot, length, normalize, scale, sub, type Vec3 } from '../../src/astro/vec.ts';

const AU = 1.496e11;
const FOV = (45 * Math.PI) / 180;
const DT = 1 / 60;
const TILT = (23.4 * Math.PI) / 180;

/** A small static solar system plus far-away targets. `now.t` moves Earth when set. */
function world() {
  const now = { t: 0, speed: 0 };
  const earth = (): Vec3 => {
    const a = now.t * now.speed;
    return [AU * Math.cos(a), AU * Math.sin(a), 0];
  };
  const body = (id: string, pos: () => Vec3, radius: number, parent: string | null, extra: Partial<FocusTarget> = {}): FocusTarget => ({
    id,
    radius,
    minAltitude: radius > 0 ? 0.01 * radius : 1e5,
    pos,
    pole: () => (radius > 0 ? [0, -Math.sin(TILT), Math.cos(TILT)] : null),
    handoff: null,
    parent,
    ...extra,
  });
  const targets = new Map<string, FocusTarget>();
  for (const t of [
    body('sun', () => [0, 0, 0], 6.96e8, null),
    body('earth', earth, 6.371e6, 'sun', { handoff: [0.3 * AU, 1.5 * AU] }),
    body('moon', () => add(earth(), [0, 3.84e8, 0]), 1.737e6, 'earth', { handoff: [1.2e9, 3.8e9] }),
    body('mars', () => [-1.2 * AU, 1.1 * AU, 0.03 * AU], 3.39e6, 'sun', { handoff: [0.46 * AU, 2.3 * AU] }),
    body('saturn', () => [8 * AU, -4 * AU, 0.3 * AU], 5.8e7, 'sun', { handoff: [2.9 * AU, 14 * AU] }),
    // Framed inside its own handoff range: landing must still match the free camera.
    body('craft', () => [100 * AU, 120 * AU, 30 * AU], 0, 'sun', { handoff: [2 * AU, 20 * AU], framing: 40 * AU }),
    // A black hole kiloparsecs away, framed at 110 rs.
    body('far', () => [6e19, 3e19, 2.5e19], 2.66e4, null, { framing: 110 * 2.66e4, minAltitude: 1e4 }),
    body('uni', () => [0, 0, 0], 0, null, { framing: 1.05e27 }),
  ])
    targets.set(t.id, t);
  const cam = new CameraController((id) => targets.get(id));
  cam.set(['earth', 'sun'], 2e7, [0.3, -0.9, 0.3]);
  cam.update(0);
  return { cam, targets, now };
}

interface Sample {
  /** Look point relative to `ref`, exact near it. */
  look: Vec3;
  r: number;
  forward: Vec3;
  up: Vec3;
}

const sample = (cam: CameraController, ref: Vec3): Sample => {
  const v = cam.view as View;
  return { look: add(sub(v.pivot, ref), v.shift), r: v.r, forward: cam.pose.forward, up: cam.pose.up };
};

/** Step the camera at 60 Hz until it lands (or `frames` run out), recording each frame. */
function run(cam: CameraController, ref: Vec3, frames: number, each?: (i: number) => void): Sample[] {
  const out = [sample(cam, ref)];
  for (let i = 0; i < frames; i++) {
    each?.(i);
    cam.update(DT);
    out.push(sample(cam, ref));
  }
  return out;
}

/** The worst per-frame motion: pan (in units of r), zoom (Δ ln r), turn and roll (rad), and their changes. */
function motion(s: Sample[]) {
  let pan = 0;
  let zoom = 0;
  let turn = 0;
  let roll = 0;
  let pan2 = 0;
  let zoom2 = 0;
  for (let i = 1; i < s.length; i++) {
    const [a, b] = [s[i - 1], s[i]];
    pan = Math.max(pan, length(sub(b.look, a.look)) / Math.min(a.r, b.r));
    zoom = Math.max(zoom, Math.abs(Math.log(b.r / a.r)));
    turn = Math.max(turn, angleBetween(a.forward, b.forward));
    roll = Math.max(roll, angleBetween(a.up, b.up));
    if (i >= 2) {
      const c = s[i - 2];
      const d2 = sub(sub(b.look, a.look), sub(a.look, c.look));
      pan2 = Math.max(pan2, length(d2) / a.r);
      zoom2 = Math.max(zoom2, Math.abs(Math.log(b.r / a.r) - Math.log(a.r / c.r)));
    }
  }
  return { pan, zoom, turn, roll, pan2, zoom2 };
}

const DEG = Math.PI / 180;

function expectSmooth(s: Sample[]) {
  const m = motion(s);
  expect(m.pan).toBeLessThan(0.06);
  expect(m.zoom).toBeLessThan(0.3);
  expect(m.turn).toBeLessThan(2.5 * DEG);
  expect(m.roll).toBeLessThan(2.5 * DEG);
  expect(m.pan2).toBeLessThan(0.005);
  expect(m.zoom2).toBeLessThan(0.02);
}

describe('camera flights', () => {
  it('glide from Earth to Mars without a whip or a hard stop', () => {
    const { cam, targets } = world();
    cam.flyTo('mars', FOV);
    const s = run(cam, targets.get('mars')!.pos(), 600);
    expect(cam.flying).toBe(false);
    expect(cam.focusId).toBe('mars');
    expectSmooth(s);
  });

  it('land exactly where the free camera takes over', () => {
    for (const id of ['moon', 'saturn', 'craft', 'far', 'uni']) {
      const { cam, targets } = world();
      cam.flyTo(id, FOV);
      let last: View | null = null;
      while (cam.flying) {
        cam.update(DT);
        last = { ...(cam.view as View) };
      }
      cam.update(DT);
      const next = cam.view as View;
      const ref = targets.get(id)!.pos();
      const gap = length(sub(add(sub(next.pivot, ref), next.shift), add(sub(last!.pivot, ref), last!.shift)));
      expect(gap / next.r, id).toBeLessThan(1e-12);
      expect(Math.abs(next.r / last!.r - 1), id).toBeLessThan(1e-12);
      expect(angleBetween(next.dir, last!.dir), id).toBeLessThan(1e-12);
      expect(angleBetween(next.up, last!.up), id).toBeLessThan(1e-9);
    }
  });

  it('land on the free camera pivot even when framed inside the handoff range', () => {
    const { cam } = world();
    cam.flyTo('craft', FOV);
    run(cam, [0, 0, 0], 600);
    cam.update(DT);
    const v = cam.view as View;
    expect(length(sub(v.lookAt, cam.pivotFor(cam.chain, v.r))) / v.r).toBeLessThan(1e-9);
  });

  it('keep the arrival swing off the pole, so the view never rolls fast', () => {
    const { cam, targets } = world();
    // From low on one side of Saturn to its lit side on the other: a straight slerp tips over the pole.
    cam.flyTo('saturn', FOV);
    const s = run(cam, targets.get('saturn')!.pos(), 400);
    expect(motion(s).roll).toBeLessThan(1.5 * DEG);
  });

  it('only turn up to the scales the trip is near', () => {
    const { cam, targets } = world();
    cam.flyTo('far', FOV);
    const s = run(cam, targets.get('far')!.pos(), 60 * 9);
    // Passing through galactic scales no longer rolls to galactic north and back.
    expect(motion(s).roll).toBeLessThan(0.5 * DEG);
  });

  it('stay smooth out to the universe, across to a black hole and home again', () => {
    const { cam, targets } = world();
    for (const id of ['uni', 'far', 'earth']) {
      cam.flyTo(id, FOV);
      const s = run(cam, targets.get(id)!.pos(), 60 * 9);
      expect(cam.flying, id).toBe(false);
      for (const x of s) expect(Number.isFinite(x.r) && x.look.every(Number.isFinite), id).toBe(true);
      const m = motion(s);
      expect(m.pan, id).toBeLessThan(0.06);
      expect(m.zoom, id).toBeLessThan(0.3);
      expect(m.turn, id).toBeLessThan(2.5 * DEG);
      expect(m.roll, id).toBeLessThan(2.5 * DEG);
    }
  });

  it('bend onto a new destination picked mid-flight', () => {
    const { cam, targets } = world();
    cam.flyTo('mars', FOV);
    const ref = targets.get('saturn')!.pos();
    const s = run(cam, ref, 600, (i) => {
      if (i === 80) cam.flyTo('saturn', FOV);
    });
    expect(cam.focusId).toBe('saturn');
    expectSmooth(s);
  });

  it('bend onto a new destination late in a flight, and again right away', () => {
    const { cam, targets } = world();
    cam.flyTo('saturn', FOV);
    const ref = targets.get('moon')!.pos();
    const s = run(cam, ref, 900, (i) => {
      if (i === 170) cam.flyTo('mars', FOV);
      if (i === 175) cam.flyTo('moon', FOV);
    });
    expect(cam.focusId).toBe('moon');
    const m = motion(s);
    expect(m.pan).toBeLessThan(0.06);
    expect(m.zoom).toBeLessThan(0.3);
    expect(m.turn).toBeLessThan(2.5 * DEG);
  });

  it('ignore a repeat of the flight under way', () => {
    const { cam } = world();
    cam.flyTo('mars', FOV);
    for (let i = 0; i < 60; i++) cam.update(DT);
    const before = cam.view!.r;
    cam.flyTo('mars', FOV);
    cam.update(0);
    expect(cam.view!.r).toBe(before);
  });

  for (const [what, grab] of [
    ['a drag', (cam: CameraController) => cam.orbit(0, 0, 800, FOV)],
    ['a scroll', (cam: CameraController) => cam.zoom(-0.2)],
  ] as const) {
    it(`hand over to ${what} mid-flight without re-aiming`, () => {
      const { cam, targets } = world();
      cam.flyTo('mars', FOV);
      for (let i = 0; i < 100; i++) cam.update(DT);
      const before = sample(cam, targets.get('mars')!.pos());
      grab(cam);
      expect(cam.flying).toBe(false);
      const s = [before, ...run(cam, targets.get('mars')!.pos(), 90)];
      // The first frame after the grab barely moves.
      expect(length(sub(s[1].look, s[0].look)) / s[0].r).toBeLessThan(0.02);
      expect(angleBetween(s[0].forward, s[1].forward)).toBeLessThan(0.3 * DEG);
      const m = motion(s);
      expect(m.pan).toBeLessThan(0.06);
      expect(m.turn).toBeLessThan(2.5 * DEG);
      // Settled back onto the focus pivot.
      const v = cam.view as View;
      expect(length(sub(v.lookAt, cam.pivotFor(cam.chain, v.r))) / v.r).toBeLessThan(1e-9);
    });
  }

  it('slow down through a frame hitch instead of skipping ahead', () => {
    const { cam } = world();
    cam.flyTo('moon', FOV);
    for (let i = 0; i < 20; i++) cam.update(0.1);
    expect(cam.flying).toBe(true);
  });

  it('treat a zero step as a pure read', () => {
    const { cam } = world();
    cam.flyTo('mars', FOV);
    for (let i = 0; i < 90; i++) cam.update(DT);
    cam.flyTo('saturn', FOV);
    cam.update(DT);
    const a = { ...(cam.view as View) };
    cam.update(0);
    const b = cam.view as View;
    expect(b.lookAt).toEqual(a.lookAt);
    expect(b.r).toBe(a.r);
  });

  it('track a moving destination and land on it', () => {
    const { cam, targets, now } = world();
    now.speed = 1e-3;
    cam.flyTo('moon', FOV);
    while (cam.flying) {
      now.t += DT;
      cam.update(DT);
    }
    const moon = targets.get('moon')!;
    const v = cam.view as View;
    expect(length(sub(v.lookAt, moon.pos())) / v.r).toBeLessThan(1e-9);
  });

  it('rise straight up to a set distance, then take off from there', () => {
    const { cam, targets } = world();
    const dir = cam.view!.dir;
    cam.flyTo('earth', FOV, { distance: 200 * 6.371e6, arrive: dir });
    let highAt = -1;
    const s = run(cam, targets.get('earth')!.pos(), 400, (i) => {
      if (highAt < 0 && cam.transit?.high) highAt = i;
      // Take off once high, mid ease-out, as a landmark visit does.
      if (highAt >= 0 && i === highAt + 20) cam.flyTo('earth', FOV, { from: 'moon' });
    });
    expect(highAt).toBeGreaterThan(0);
    expect(cam.focusId).toBe('earth');
    expect(angleBetween(cam.view!.dir, normalize(sub(targets.get('moon')!.pos(), targets.get('earth')!.pos())))).toBeLessThan(1e-9);
    const m = motion(s.slice(0, highAt));
    // Straight up: no turn while rising.
    expect(m.turn).toBeLessThan(1e-6);
    expectSmooth(s);
  });

  it('count a trip that starts far out as high from the outset', () => {
    const { cam } = world();
    cam.flyTo('uni', FOV);
    while (cam.flying) cam.update(DT);
    cam.flyTo('earth', FOV);
    cam.update(DT);
    expect(cam.transit?.high).toBe(true);
  });

  it('switch the view focus at the zoomed-out peak', () => {
    const { cam } = world();
    cam.flyTo('mars', FOV);
    const seen: string[] = [];
    while (cam.flying) {
      cam.update(DT);
      if (cam.flying) seen.push(cam.viewFocusId);
    }
    expect(seen[0]).toBe('earth');
    expect(seen.at(-1)).toBe('mars');
    expect(new Set(seen).size).toBe(2);
  });
});

describe('camera panning', () => {
  const H = 800;
  /** Camera position relative to `ref`. */
  const eye = (cam: CameraController, ref: Vec3): Vec3 => add(sample(cam, ref).look, scale((cam.view as View).dir, (cam.view as View).r));

  it('move the look point with the drag, keeping distance and direction', () => {
    const { cam, targets } = world();
    const e = targets.get('earth')!.pos();
    const before = sample(cam, e);
    const dir = (cam.view as View).dir;
    cam.pan(-100, 0, H, FOV);
    cam.stopInertia();
    cam.update(DT);
    const after = sample(cam, e);
    const d = sub(after.look, before.look);
    const m = (2 * before.r * Math.tan(FOV / 2)) / H;
    expect(length(d) / (100 * m)).toBeCloseTo(1, 6);
    expect(dot(normalize(d), cam.pose.right)).toBeCloseTo(1, 6);
    expect(after.r / before.r).toBeCloseTo(1, 9);
    expect(angleBetween((cam.view as View).dir, dir)).toBeLessThan(1e-12);
    expect(cam.panned).toBe(true);
  });

  it('keep the panned point while zooming out past the handoff to the Sun', () => {
    const { cam, targets } = world();
    const e = targets.get('earth')!.pos();
    cam.pan(-100, 0, H, FOV);
    cam.stopInertia();
    cam.update(DT);
    const a = sample(cam, e).look;
    cam.zoom(Math.log((2 * AU) / 2e7));
    run(cam, e, 300);
    const b = sample(cam, e);
    expect(b.r).toBeGreaterThan(AU);
    expect(length(sub(b.look, a))).toBeLessThan(1);
  });

  it('hold the point under the cursor still in free mode', () => {
    const { cam, targets } = world();
    const e = targets.get('earth')!.pos();
    cam.freeMode = true;
    const r0 = sample(cam, e).r;
    const d = normalize(add(cam.pose.forward, scale(cam.pose.right, 0.2)));
    const P = add(eye(cam, e), scale(d, r0 / dot(d, cam.pose.forward)));
    cam.zoom(-0.5, null, d);
    run(cam, e, 120);
    expect(sample(cam, e).r).toBeLessThan(0.8 * r0);
    expect(angleBetween(normalize(sub(P, eye(cam, e))), d)).toBeLessThan(1e-9);
  });

  it('settle onto the body the view was panned to, without moving the view', () => {
    const { cam, targets } = world();
    const e = targets.get('earth')!.pos();
    const m = targets.get('mars')!.pos();
    cam.offset = add(sub(m, e), [1e7, 0, 0]);
    cam.update(DT);
    const before = sample(cam, m);
    cam.reanchor(['sun', 'earth', 'moon', 'mars']);
    expect(cam.focusId).toBe('mars');
    cam.update(DT);
    const after = sample(cam, m);
    expect(length(sub(after.look, before.look)) / before.r).toBeLessThan(1e-9);
    expect(after.r / before.r).toBeCloseTo(1, 9);
    // Near Earth still: stay on Earth.
    const { cam: cam2 } = world();
    cam2.offset = [1e7, 0, 0];
    cam2.update(DT);
    cam2.reanchor(['sun', 'earth', 'moon', 'mars']);
    expect(cam2.focusId).toBe('earth');
    // Beside the Moon: the Moon, though Earth's neighborhood holds it too.
    const { cam: cam3 } = world();
    cam3.offset = [1e7, 3.84e8, 0];
    cam3.update(DT);
    cam3.reanchor(['sun', 'earth', 'moon', 'mars']);
    expect(cam3.focusId).toBe('moon');
  });

  it('fly on from a panned view without a jump, and land centered', () => {
    const { cam, targets } = world();
    const m = targets.get('mars')!.pos();
    cam.pan(-200, 50, H, FOV);
    cam.stopInertia();
    cam.update(DT);
    cam.flyTo('mars', FOV);
    const s = run(cam, m, 600);
    expect(cam.flying).toBe(false);
    expect(cam.panned).toBe(false);
    expectSmooth(s);
    expect(length(sample(cam, m).look)).toBeLessThan(1);
  });

  it('keep the camera out of the body when panned into it', () => {
    const { cam, targets } = world();
    const earth = targets.get('earth')!;
    const e = earth.pos();
    cam.offset = scale((cam.view as View).dir, -(cam.view as View).r);
    cam.update(DT);
    expect(length(eye(cam, e))).toBeGreaterThanOrEqual((earth.radius + earth.minAltitude) * (1 - 1e-9));
  });

  it('fly through a planet and out the far side', () => {
    const { cam, targets } = world();
    cam.anchors = ['sun', 'earth', 'moon', 'mars'];
    const earth = targets.get('earth')!;
    const e = earth.pos();
    const ahead = cam.pose.forward;
    const start = eye(cam, e);
    const s = run(cam, e, 1, () => cam.fly(-3, ahead));
    s.push(...run(cam, e, 180));
    const end = eye(cam, e);
    // Went straight on, past the center, and came out clear of the surface.
    expect(dot(sub(end, start), ahead) / length(sub(end, start))).toBeCloseTo(1, 9);
    expect(dot(end, ahead)).toBeGreaterThan(earth.radius);
    expect(length(end)).toBeGreaterThan(earth.radius + earth.minAltitude);
    expect(cam.focusId).toBe('earth');
    // Never pushed sideways on the way through.
    for (const x of s) expect(length(sub(x.forward, ahead))).toBeLessThan(1e-12);
  });

  it('clear the pan on a jump', () => {
    const { cam } = world();
    cam.pan(-100, 0, H, FOV);
    cam.set(['mars', 'sun'], 1e7, [0, 1, 0]);
    expect(cam.panned).toBe(false);
  });
});

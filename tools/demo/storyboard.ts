// The demo video's beat sheet: a title card and a minute of someone exploring Outermost. The
// viewport is 1280×720 CSS px. Times in comments are rough video seconds;
// flights take as long as the app makes them, so later beats float with them.
// Each beat is marked, and the recorder prints the marks when it finishes.

import { FPS, type Action, type Director, type Point } from './director.ts';

/** Where the script starts, after the title card: Earth's day side, live, from this far out (m), with "My location" pinned to Seattle. */
export const OPENING = { focus: 'earth', altitude: 2.4e7, location: [47.6062, -122.3321] };

/**
 * The title card, after the social preview image (public/og.png): Earth's
 * night side from this far out (m), with the Sun rising past the limb toward
 * this screen angle (degrees, 0 = right, 90 = up), and how long it all runs (s).
 */
const INTRO = { seconds: 7.4, altitude: 1.1e7, sunAngle: 35 };

/** In the page: frame the night-side shot and remember the day-side one the script opens on. */
function introSetup({ altitude, sunAngle, day }: { altitude: number; sunAngle: number; day: number }): void {
  const app = (window as any).app;
  const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a: number[]) => a.map((x) => x / Math.hypot(...a));
  const sun = app.world.get('sun').pos;
  const u = unit(sub(sun, app.world.get('earth').pos));
  const e1 = unit(cross(u, [0, 0, 1]));
  const e2 = cross(u, e1);
  const chain = app.chainFor('earth');
  const rho = Math.asin(6371e3 / (6371e3 + altitude));
  // The Sun starts just behind the limb and ends clear of it, where its glare flares along the crescent.
  const a0 = rho - (2.5 * Math.PI) / 180;
  const a1 = rho + (9.5 * Math.PI) / 180;
  const at = (q: number[], a: number) => unit(u.map((x, i) => -x * Math.cos(a) + q[i] * Math.sin(a)));
  // Which way round the night side puts the risen Sun at the wanted angle on screen.
  const tanV = Math.tan((22.5 * Math.PI) / 180);
  const tanH = (tanV * 16) / 9;
  let best = { off: Infinity, q: e1 };
  for (let k = 0; k < 72; k++) {
    const b = (k / 72) * 2 * Math.PI;
    const q = e1.map((x, i) => x * Math.cos(b) + e2[i] * Math.sin(b));
    app.camera.set(chain, altitude, at(q, a1));
    const pose = app.camera.update(0);
    const r = sub(sun, pose.position);
    const z = dot(r, pose.forward);
    const ang = (Math.atan2(dot(r, pose.up) / z / tanV, dot(r, pose.right) / z / tanH) * 180) / Math.PI;
    const off = Math.abs(((ang - sunAngle + 540) % 360) - 180);
    if (off < best.off) best = { off, q };
  }
  const orbits = app.settings.orbits;
  // Orbit lines would cross the planet; the controls fade in without them and they come back with the HUD.
  app.settings.orbits = false;
  (window as any).__intro = { u, q: best.q, a0, a1, chain, orbits, night: altitude, day, dayDir: app.defaultDir('earth') };
}

/** In the page, before frame t (s): the sunrise, the name coming up and going, and the swing round to the day side. */
function introFrame({ t, end }: { t: number; end: number }): void {
  const app = (window as any).app;
  const demo = (window as any).__demo;
  const I = (window as any).__intro;
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
  const unit = (a: number[]) => a.map((x) => x / Math.hypot(...a));
  // Smootherstep from a to b.
  const ease = (a: number, b: number) => {
    const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return k * k * k * (k * (6 * k - 15) + 10);
  };
  const alpha = I.a0 + (I.a1 - I.a0) * ease(0.2, 4.6);
  const night = unit(I.u.map((x: number, i: number) => -x * Math.cos(alpha) + I.q[i] * Math.sin(alpha)));
  const s = ease(4.3, end);
  const w = Math.acos(Math.min(1, Math.max(-1, dot(night, I.dayDir))));
  const dir = w < 1e-6 ? night : night.map((x, i) => (x * Math.sin((1 - s) * w) + I.dayDir[i] * Math.sin(s * w)) / Math.sin(w));
  app.camera.set(I.chain, Math.exp(Math.log(I.night) + (Math.log(I.day) - Math.log(I.night)) * s), dir);
  const hud = ease(end - 0.7, end);
  if (hud > 0) app.settings.orbits = I.orbits;
  demo.cover(1 - ease(0, 1));
  demo.titleCard(ease(1, 1.9) * (1 - ease(4, 4.6)), ease(1.5, 2.4) * (1 - ease(3.9, 4.5)), hud);
}

// The timeline's opening window (src/ui/timeline/view.ts), for aiming at a date before it's been zoomed.
const TL_PAD = 10;
const TL_START = Date.UTC(1900, 0, 1);
const TL_SPAN = Date.UTC(2130, 0, 1) - TL_START;

export async function* storyboard(d: Director): Action {
  const { page } = d;
  const track = async () => (await page.locator('.rail > .track').boundingBox())!;
  /** Where to grab the playhead: under the date, which rides it. */
  const playhead = async (): Promise<Point> => {
    const stamp = (await page.locator('.stamp').boundingBox())!;
    const t = await track();
    return [stamp.x + stamp.width / 2, t.y + t.height * 0.55];
  };
  /** Where a moment sits on the timeline, while it still shows its opening window. */
  const timelineX = async (ms: number): Promise<number> => {
    const t = await track();
    return t.x + TL_PAD + ((ms - TL_START) / TL_SPAN) * (t.width - 2 * TL_PAD);
  };
  /** Park the pointer clear of the palette (hovering a row selects it), ⌘K, type, check the pick, and go. */
  async function* palette(query: string, pick: string): Action {
    yield* d.moveTo(await d.clear([1050, 450]), { seconds: 0.45 });
    yield* d.key('ControlOrMeta+k', 0.25);
    yield* d.type(query);
    yield* d.hold(0.3);
    await d.expectPick('#palette-list', pick);
    yield* d.key('Enter');
    yield* d.waitFlight();
  }

  // 0–7: the title card. Earth's night side, Asia lit up, as the Sun rises
  // past the limb; the name comes up over it, then the camera swings round
  // to the day side over Seattle and the controls fade in.
  d.mark('intro');
  await page.evaluate(introSetup, { altitude: INTRO.altitude, sunAngle: INTRO.sunAngle, day: OPENING.altitude });
  const frames = Math.round(INTRO.seconds * FPS);
  for (let i = 0; i <= frames; i++) {
    await page.evaluate(introFrame, { t: i / FPS, end: INTRO.seconds });
    yield;
  }

  // 7–13: Earth, live, with "My location" on over Seattle. The cursor turns
  // the planet toward it and rests on the marker.
  d.mark('earth');
  yield* d.hold(0.3);
  yield* d.moveTo(await d.clear([700, 300]), { seconds: 1.0 });
  yield* d.drag([-120, 30], 1.3);
  yield* d.hold(0.2);
  yield* d.drag([110, 70], 1.3);
  yield* d.moveTo('.user-location .hit');
  yield* d.hold(0.9);

  // 13–24: to Mars. Turn it, then open the speed menu and pick an hour a
  // second, so the planet spins.
  d.mark('mars');
  yield* palette('mars', 'Mars');
  yield* d.moveTo(await d.clear([720, 380]), { seconds: 0.45 });
  yield* d.drag([-170, 18], 1.5);
  yield* d.click('button.speed-btn');
  yield* d.hold(0.2);
  yield* d.click('.menu .option:has-text("1 hr/s")');
  yield* d.hold(1.2);

  // 24–32: to the Sun, and drag the speed up a notch to a day a second.
  d.mark('sun');
  yield* palette('sun', 'Sun');
  yield* d.moveTo('button.speed-btn');
  yield* d.drag([34, -1], 0.6, { curve: 0 });
  yield* d.moveTo(await d.clear([900, 300]), { seconds: 0.6 });
  yield* d.hold(1.2);

  // 32–48: pause, and run back along the timeline to 1989, reading the
  // landmarks, to the outburst V404 Cygni had that year. Clicking it jumps
  // there and flies to the black hole, its accretion disk ablaze. Circle it.
  d.mark('v404');
  yield* d.click('button.play');
  yield* d.moveTo(await playhead());
  // Just left of the outburst's dot, so it's the landmark under the pointer rather than Voyager 2 at Neptune three months on.
  const to = (await timelineX(Date.parse('1989-05-22'))) - 2;
  yield* d.glide([to - d.cursor.x, 1], 1.9, { curve: 0 });
  yield* d.hold(0.45);
  const tip = await page.locator('.rail .tip b').textContent();
  if (tip !== 'V404 Cygni erupts in X-rays') throw new Error(`demo: expected the V404 Cygni outburst under the pointer, not "${tip}"`);
  yield* d.click();
  yield* d.waitFlight();
  yield* d.moveTo(await d.clear([760, 330]), { seconds: 0.5 });
  yield* d.drag([-200, -26], 2.1);
  d.mark('poster');

  // 48–53: flick outward, out of the Milky Way and past the cosmic web to
  // the microwave background at the edge of what we can see.
  d.mark('zoom-out');
  yield* d.moveTo(await d.clear([560, 460]), { seconds: 0.35 });
  for (const [px, pause] of [
    [4200, 0.1],
    [4500, 0.1],
    [4500, 0.1],
    [4400, 0.1],
    [4200, 0.3],
  ]) {
    yield* d.wheel(px, 0.85);
    yield* d.hold(pause);
  }

  // 53–end: run along the timeline from 1989 to the next total solar
  // eclipse, reading the landmarks, and click it: time jumps to August 2027
  // and the camera flies home to the Moon's shadow on Africa. Then circle
  // around to the night side, where the Sun comes out past the limb.
  d.mark('timeline');
  yield* d.moveTo(await playhead());
  yield* d.glide([260, 2], 2.4, { curve: 0, until: `document.querySelector('.rail .tip b')?.textContent.includes('North Africa')` });
  yield* d.hold(0.45);
  yield* d.click();
  yield* d.waitFlight();
  d.mark('eclipse');
  yield* d.hold(0.3);
  yield* d.moveTo(await d.clear([1000, 380]), { seconds: 0.5 });
  yield* d.drag([-380, 10], 1.7);
  // Around to the night side and down a little, until the Sun clears the limb (the new Moon is beside it, dark side on).
  yield* d.moveTo(await d.clear([1040, 470]), { seconds: 0.45 });
  yield* d.drag([-510, -160], 2.3);
  yield* d.hold(0.6);
}

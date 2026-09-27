// The demo video's beat sheet: a minute of someone exploring Outermost. The
// viewport is 1280×720 CSS px. Times in comments are rough video seconds;
// flights take as long as the app makes them, so later beats float with them.
// Each beat is marked, and the recorder prints the marks when it finishes.

import type { Action, Director, Point } from './director.ts';

/** How the recording opens: Earth's day side, live, from this far out (m). */
export const OPENING = { focus: 'earth', altitude: 2.4e7 };

export async function* storyboard(d: Director): Action {
  const { page } = d;
  /** Where to grab the playhead: under the date, which rides it. */
  const playhead = async (): Promise<Point> => {
    const stamp = (await page.locator('.stamp').boundingBox())!;
    const track = (await page.locator('.rail > .track').boundingBox())!;
    return [stamp.x + stamp.width / 2, track.y + track.height * 0.55];
  };

  // 0–5: Earth, live. The cursor comes in from the lower right, turns the
  // planet, and scrolls in toward the ground under it.
  d.mark('earth');
  yield* d.hold(0.3);
  yield* d.moveTo(await d.clear([700, 400]), { seconds: 1.0 });
  yield* d.drag([-130, 18], 1.3);
  yield* d.moveTo(await d.clear([610, 350]), { seconds: 0.45 });
  yield* d.wheel(-520, 1.1);
  yield* d.hold(0.2);

  // 5–11: the timeline. Pinch it from centuries down to about a month around
  // the playhead (re-aiming halfway, since a 2000× zoom magnifies any miss),
  // drag the playhead a few days ahead, then jump back to Live.
  d.mark('timeline');
  yield* d.moveTo(await playhead());
  yield* d.wheel(-330, 0.6, { ctrl: true });
  yield* d.moveTo(await playhead(), { seconds: 0.25 });
  yield* d.wheel(-310, 0.6, { ctrl: true });
  yield* d.hold(0.15);
  yield* d.moveTo(await playhead(), { seconds: 0.3 });
  yield* d.drag([160, 2], 1.6, { curve: 0.01 });
  yield* d.hold(0.2);
  yield* d.click('button.live');

  // 11–16: search for Saturn (with a slip of the finger) and fly there.
  d.mark('saturn');
  yield* d.click('input#search');
  yield* d.hold(0.15);
  yield* d.type('saturn', { typo: { at: 3, wrong: 'r' } });
  yield* d.hold(0.25);
  await d.expectTop('#search-list', 'Saturn');
  yield* d.key('Enter', 0.1);
  yield* d.key('Escape', 0.05);
  yield* d.waitFlight();

  // 16–21: drag the speed control up to a week a second so the moons race
  // around the rings, hold it there, and bring it back to real time.
  d.mark('speed');
  yield* d.moveTo('button.speed-btn');
  yield* d.hold(0.15);
  yield* d.press();
  yield* d.glide([102, -2], 1.0, { curve: 0 });
  yield* d.hold(1.7);
  yield* d.glide([-100, 1], 0.7, { curve: 0 });
  yield* d.hold(0.12);
  yield* d.release();

  // 21–28: the command palette, to M87*, the first black hole ever imaged.
  d.mark('m87');
  yield* d.moveTo(await d.clear([820, 330]), { seconds: 0.5 });
  yield* d.key('ControlOrMeta+k', 0.25);
  yield* d.type('powehi');
  yield* d.hold(0.35);
  await d.expectTop('#palette-list', 'M87');
  yield* d.key('Enter');
  yield* d.waitFlight();

  // 28–33: circle it slowly to watch the light bend, and peek at its facts.
  yield* d.moveTo(await d.clear([760, 360]), { seconds: 0.45 });
  yield* d.drag([-220, -24], 2.0);
  d.mark('poster');
  yield* d.moveTo({ sel: 'button.title', at: [0.3, 0.5] });
  yield* d.hold(1.2);

  // 33–40: on to Sagittarius A*, at the heart of our own galaxy.
  d.mark('sgr');
  yield* d.moveTo(await d.clear([900, 420]), { seconds: 0.5 });
  yield* d.key('/', 0.15);
  yield* d.type('sgr a*');
  yield* d.hold(0.3);
  await d.expectTop('#search-list', 'Sagittarius A');
  yield* d.key('Enter', 0.1);
  yield* d.key('Escape', 0.05);
  yield* d.waitFlight();
  yield* d.moveTo(await d.clear([640, 380]), { seconds: 0.45 });
  yield* d.drag([-90, -14], 1.1);

  // 40–46: flick outward: the Milky Way, the Local Group, the cosmic web,
  // and the microwave background at the edge of what we can see.
  d.mark('zoom-out');
  yield* d.moveTo(await d.clear([560, 460]), { seconds: 0.35 });
  for (const [px, pause] of [
    [2900, 0.15],
    [3300, 0.12],
    [3400, 0.9], // the Milky Way from outside
    [3300, 0.1],
    [3300, 0.3],
  ]) {
    yield* d.wheel(px, 0.9);
    yield* d.hold(pause);
  }

  // 46–end: home, for the next total solar eclipse, over North Africa.
  d.mark('eclipse');
  yield* d.key('ControlOrMeta+k', 0.25);
  yield* d.type('north africa');
  yield* d.hold(0.3);
  await d.expectTop('#palette-list', 'North Africa');
  yield* d.key('Enter');
  yield* d.waitFlight();
  d.mark('home');
  yield* d.moveTo([1060, 560], { seconds: 1.4 });
}

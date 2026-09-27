// The demo video's beat sheet: a minute of someone exploring Outermost. The
// viewport is 1280×720 CSS px. Times in comments are rough video seconds;
// flights take as long as the app makes them, so later beats float with them.
// Each beat is marked, and the recorder prints the marks when it finishes.

import type { Action, Director, Point } from './director.ts';

/** How the recording opens: Earth's day side, live, from this far out (m), with "My location" pinned to Seattle. */
export const OPENING = { focus: 'earth', altitude: 2.4e7, location: [47.6062, -122.3321] };

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

  // 0–6: Earth, live, with "My location" on over Seattle. The cursor turns
  // the planet toward it and rests on the marker.
  d.mark('earth');
  yield* d.hold(0.3);
  yield* d.moveTo(await d.clear([700, 300]), { seconds: 1.0 });
  yield* d.drag([-120, 30], 1.3);
  yield* d.hold(0.2);
  yield* d.drag([110, 70], 1.3);
  yield* d.moveTo('.user-location .hit');
  yield* d.hold(0.9);

  // 6–16: to Mars. Turn it, then open the speed menu and pick an hour a
  // second, so the planet spins.
  d.mark('mars');
  yield* palette('mars', 'Mars');
  yield* d.moveTo(await d.clear([720, 380]), { seconds: 0.45 });
  yield* d.drag([-170, 18], 1.5);
  yield* d.click('button.speed-btn');
  yield* d.hold(0.2);
  yield* d.click('.menu .option:has-text("1 hr/s")');
  yield* d.hold(1.2);

  // 16–23: to the Sun, and drag the speed up a notch to a day a second.
  d.mark('sun');
  yield* palette('sun', 'Sun');
  yield* d.moveTo('button.speed-btn');
  yield* d.drag([34, -1], 0.6, { curve: 0 });
  yield* d.moveTo(await d.clear([900, 300]), { seconds: 0.6 });
  yield* d.hold(1.2);

  // 23–36: to V404 Cygni, quiet today. Pause, then drag the playhead back to
  // 1989, where it snaps to the start of the outburst that year: the
  // accretion disk blazes up. Circle it.
  d.mark('v404');
  yield* palette('v404', 'V404 Cygni');
  yield* d.click('button.play');
  yield* d.moveTo(await playhead());
  // Just left of the outburst's landmark, so the snap picks it over Voyager 2 at Neptune three months on.
  const to = (await timelineX(Date.parse('1989-05-22'))) - 1;
  yield* d.drag([to - d.cursor.x, -1], 1.7, { curve: 0 });
  yield* d.moveTo(await d.clear([760, 330]), { seconds: 0.5 });
  yield* d.drag([-200, -26], 2.1);
  d.mark('poster');

  // 36–42: flick outward, out of the Milky Way and past the cosmic web to
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

  // 42–end: run along the timeline from 1989 to the next total solar
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

# Plan: black hole outbursts on the timeline

Status: implemented. Builds on phase 3 of [accretion-disks.md](accretion-disks.md), which switches thin disks on by sim date.

## Context

Two black holes draw an accretion disk only while they are in a recorded outburst. The dates live in `DiskDef.active` (`src/data/blackHoles.ts`), and `diskBrightness()` (`src/scene/providers/blackHoles.ts`) fades each disk in and out over 3 days at the ends of each range:

| Black hole | Outburst | Source (already cited) |
|---|---|---|
| A0620-00 | 1975-08-03 to 1976-03-15 | Kaluzienski et al. 1977 |
| V404 Cygni | 1989-05-22 to 1989-11-01 | Corbel et al. 2008 |
| V404 Cygni | 2015-06-15 to 2015-08-05 | Plotkin et al. 2017 |

Today, the only way to see these disks is to know the dates and type one into the date picker. The timeline already has what's needed to fix that: `src/data/landmarks.ts` lists notable moments, and the timeline draws each one as a dot. Clicking a dot sets the clock and flies to its target (`visit()` in `src/ui/Timeline.svelte`). The same list also feeds search (`src/ui/searchMatch.ts`) and Shift+arrow stepping (`TimelineView.onKey`). So adding the outbursts as landmarks makes them clickable, searchable and keyboard-reachable at once.

## Decisions (edit here before implementing if you disagree)

1. **One source of truth.** The outburst landmarks are generated from `BLACK_HOLES` rather than typed a second time into `LANDMARKS`. A new outburst added to the data then appears on the timeline automatically, and the dates can't drift apart. The landmark name for each outburst sits next to its dates in `blackHoles.ts`.
2. **A new kind, `outburst`.**
   - It gets its own tooltip label ("Outburst") and color.
   - The color is the stellar black hole coral (`BLACK_HOLE_CLASS_COLOR.stellar`, `#ff9478`), imported rather than copied. The marker then matches the dot those holes already have in search results.
3. **Land on the first day.**
   - Clicking goes to the `from` date (00:00 UTC), when the disk has just finished fading in (brightness 1).
   - The camera flies to the hole with no `from` override. The provider's thin-disk `approach` already frames the disk just above edge-on.
4. **Leave the clock alone.** As with every other landmark, the rate and play/pause state are kept. The Scrubber is designed never to change them on its own. Known cost: a flight to V404 Cygni takes up to about 7 s while the clock keeps running. At a month a second, the 7-week 2015 outburst would be over before the camera arrives. At the default 1× nothing visible changes.
5. **Show the span, click the dot.**
   - An outburst draws a faint bar along the lane from `from` to `to`, under the dots. Only the dot at the start is a hit target.
   - This matters because other landmarks fall inside the spans: Voyager 2 at Neptune (1989-08-25) is inside the 1989 outburst, and New Horizons at Pluto (2015-07-14) is inside the 2015 one. Those dots must stay on top and stay clickable.
   - Clicking the bar elsewhere scrubs there as usual, which is still inside the outburst.
6. **The tooltip shows the whole range**, for example "Outburst · May 22 – Nov 1, 1989 · V404 Cygni". Search rows keep showing just the start date, since that's where a pick lands.

## Implementation

### 1. Data: `src/data/blackHoles.ts`

Change `active` from date tuples to objects that also carry the landmark name:

```ts
/** Outbursts, when the disk shines: ISO dates and the name the timeline gives each; omit for always. */
active?: Array<{ from: string; to: string; name: string }>;
```

- `outburstDisk()` takes a `name` for each outburst and maps `({ from, to, name })` into `active`.
- Proposed names, in the copy voice of the existing landmarks (short sentences, no em dashes):

| Date | Name |
|---|---|
| 1975-08-03 | A0620-00 flares as an X-ray nova |
| 1989-05-22 | V404 Cygni erupts in X-rays |
| 2015-06-15 | V404 Cygni erupts again |

### 2. Provider: `src/scene/providers/blackHoles.ts`

In `diskBrightness()`, change the loop to read the new shape: `for (const { from, to } of disk.active)`. Nothing else changes.

### 3. Landmarks: `src/data/landmarks.ts`

```ts
import { BLACK_HOLE_CLASS_COLOR, BLACK_HOLES } from './blackHoles.ts';

export type LandmarkKind = 'mission' | 'sky' | 'discovery' | 'outburst';

export interface Landmark {
  ms: number;
  /** End of an event that lasts (UTC ms), such as an outburst. */
  until?: number;
  // name, kind, target, from as before
}

// KIND_LABEL gains outburst: 'Outburst'; KIND_COLOR gains outburst: BLACK_HOLE_CLASS_COLOR.stellar.

/** Every recorded outburst, from the dates that switch the disks on, so the two can't disagree. */
const OUTBURSTS: Landmark[] = BLACK_HOLES.flatMap((b) =>
  (b.disk?.active ?? []).map((o) => ({ ms: Date.parse(o.from), until: Date.parse(o.to), name: o.name, kind: 'outburst' as const, target: b.id })),
);

export const LANDMARKS: readonly Landmark[] = [/* the hand-written list, unchanged */, ...OUTBURSTS].sort((a, b) => a.ms - b.ms);
```

- **The sort is required.** `onKey` finds the previous and next landmark with `findLast` and `find`, which assumes date order. The fact-check test also asserts it.
- **Header comment:** add a sentence saying outbursts come from the black hole data.
- **Import cycle:** none. `blackHoles.ts` imports only types from `scene/registry.ts`.

### 4. Drawing: `src/ui/timeline/view.ts`

In `draw()`, after the lane line and the today tick and before the dots, draw each span:

```ts
// Outbursts: a faint bar under the dots, brighter while its dot is hovered.
for (const lm of LANDMARKS) {
  if (lm.until === undefined) continue;
  const xa = Math.max(x0, X(lm.ms)), xb = Math.min(x1, X(lm.until));
  if (xb - xa < 2) continue;
  ctx.globalAlpha = lm === this.hover ? 0.55 : 0.3;
  ctx.fillStyle = KIND_COLOR[lm.kind];
  ctx.fillRect(xa, LANE_Y - 1.5, xb - xa, 3);
}
ctx.globalAlpha = 1;
```

How wide the bars are on a 1200 px timeline:

| Timeline zoom | 1989 outburst | 2015 outburst |
|---|---|---|
| Default (1900–2130) | about 2 px (skipped) | under 1 px (skipped) |
| 50 yr | about 10 px | about 3 px |
| 10 yr | about 52 px | about 16 px |

`landmarkAt()`, the hover logic and the draw cache key need no change. Hit testing stays on `ms`, the start dot.

### 5. Tooltip: `src/ui/Timeline.svelte`

In `tipText`, use a date range when the landmark has `until`:

```ts
const fmtRange = (a: number, b: number) =>
  new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).formatRange(a, b);
// "May 22 – Nov 1, 1989", and "Aug 3, 1975 – Mar 15, 1976" across years
```

`formatRange` is in the ES2023 lib the project already targets.

### Gets it for free (no changes)

- **Search:** `EVENTS` in `searchMatch.ts` maps over `LANDMARKS`, so "V404" or "1989" finds the outbursts. `ResultRow` colors them from `KIND_COLOR` and names the target from the search index. The `event-${i}` result ids shift when landmarks are inserted, but nothing stores them.
- **Keyboard:** Shift+←/→ on the timeline steps onto outbursts.
- **Date line:** with the playhead on an outburst's first day, the name shows above the date, like any landmark.
- **Info card:** V404 Cygni's and A0620-00's cards already list each outburst as a fact.

## Tests

`tests/factcheck/landmarks.test.ts`: add a test that every recorded outburst is on the timeline and lands where its disk shines. For each black hole with `disk.active`, and each range in it:
- exactly one landmark exists with `kind === 'outburst'`, `target === b.id`, `ms === Date.parse(from)` and `until === Date.parse(to)`
- `diskBrightness(b.disk, lm.ms)` is 1
- there are 3 outburst landmarks in total, so the test notices if the derivation silently produces none

The existing "in date order, inside the simulation range" test still covers the merged list.

`tests/factcheck/blackHoles.test.ts`: update "outbursts match the record" to the object shape. The citation comments stay as they are.

## Verification

1. Run `npm run typecheck` and `npm test`.
2. **Start a dev server.** Other sessions often hold ports 5173, 5199 and 5211. If so, add a temporary `.claude/launch.json` entry on a free port, then revert it after verifying.
   - The Browser pane throttles rAF while hidden, so take a screenshot to force a frame before judging the canvas.
3. **Timeline:** zoom to about 10 yr around 1989.
   - A coral dot sits at 22 May with a bar running to 1 November.
   - Voyager 2's blue dot sits on top of the bar and still opens its own tooltip.
4. **Tooltip:** hover the coral dot. It reads "V404 Cygni erupts in X-rays / Outburst · May 22 – Nov 1, 1989 · V404 Cygni".
5. **Click the dot.**
   - The date line reads May 22, 1989 and the camera flies to V404 Cygni.
   - After the flight, the disk is drawn: `app` lenses show V404 Cygni with a disk at brightness 1.
6. Repeat steps 3–5 for 2015 (next to New Horizons) and for A0620-00 in 1975.
7. **Search:** "V404" lists the hole and both outbursts, each with a coral dot and its date. Picking one does the same as clicking it on the timeline.
8. **Keyboard:** with the timeline focused at 1975-01-01, Shift+→ lands on A0620-00's outburst.
9. Check the console for errors.

## Out of scope

- **Older or smaller outbursts that aren't in the data yet:**
  - V404 Cygni's 1938 eruption, recorded as Nova Cygni 1938
  - A0620-00's 1917 eruption, found on archival plates
  - V404 Cygni's smaller re-brightening in late December 2015

  Each needs a cited date range in `blackHoles.ts`. Once it has one, its disk and its timeline marker follow automatically. The plate-era dates are probably too loose for day-level ranges.
- Making the outburst facts on the info card clickable.

## Constraints

- Other sessions share this checkout, so stage and commit only the files this work touches, by path. Check `git diff --cached --stat` right before committing.
- Copy follows the existing voice: short and plain, no em dashes. The dates reuse the existing citations, so no new numbers need sources.

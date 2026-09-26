# Plan: accretion disks around black holes

Status: implemented (phases 1–3). Builds on commit `243bfac` ("Add 15 black holes with exact gravitational lensing").

## Context

Outermost already has 15 black holes (`src/data/blackHoles.ts`). The lensing pass (`src/engine/lensingPass.ts`) draws them as a black shadow that bends the scene behind them, exactly for a non-spinning (Schwarzschild) hole. Every card says "No accretion disk or jet is drawn."

The goal is the look of NASA Goddard's 2019 black hole visualization: a thin, bright disk seen nearly edge-on. Gravity lifts the image of the disk's far side over the top of the shadow and wraps its underside beneath, with a thin photon ring inside. Only black holes that really have a disk get one, oriented from measured inclinations, and each info card says what is measured, modeled and artistic.

| Black hole | What gets drawn | When |
|---|---|---|
| Cygnus X-1 | Thin disk, which gives the showcase look | Always (a persistent X-ray binary fed by its supergiant) |
| V404 Cygni | Thin disk | Only during its recorded outbursts, by sim date (phase 3) |
| A0620-00 | Thin disk | Only during its 1975 outburst (phase 3) |
| M87\*, Sagittarius A\* | Hot, thick, glowing flow: the EHT-style ring | Always (phase 2) |
| Everything else | No change | Gaia BH1–3 are dormant; the galaxy holes have no useful constraints |

## Decisions (already made; edit here before implementing if you disagree)

1. **Color.**
   - Thin disks use a warm palette like NASA's visualization: deep red → orange → yellow-white, mapped from observed brightness. The info card marks this **artistic** and says the true visible color of a million-kelvin disk is blue-white. This follows the "looks" precedent (`src/scene/looks.ts`: NASA-press-style color, labelled artistic).
   - M87\* and Sgr A\* use EHT's false-color palette. They are radio (1.3 mm) images, so this is also **artistic**.
   - Geometry, light bending, Doppler boosting and gravitational redshift are **model** (computed).
2. **Geometry is Schwarzschild.** It stays consistent with the existing lensing: a thin disk from the non-spinning innermost stable orbit, r_in = 3 r_s, out to r_out = 40 r_s with a soft outer fade. The card notes that Cygnus X-1 really spins near the maximum (a\* > 0.9985), so its real inner edge is closer in, and that the real disk extends far beyond 40 r_s but is much dimmer there.
3. **Quiescent systems get no disk.** In quiescence, the inner disks of V404 Cyg and A0620-00 are truncated and faint, so a bright NASA-style disk there would mislead. They get disks only between outburst dates, driven by the sim clock.
4. **Arrival view.** Holes with a disk are approached about 80° from the disk axis, just above edge-on. That is the NASA framing. The camera keeps the existing "look toward the Galactic Center / Milky Way" background where possible.
5. **One disk per frame.** The lensing pass handles up to 4 lenses, but only one of them (the strongest with a disk) gets the disk ray-march. That bounds the GPU cost.

## Physics (units: r_s = 1, so M = ½, G = c = 1)

**Ray setup.** Everything in this step already exists in the shader. For each pixel and lens, it has:
- `l`: view-space unit vector to the hole
- `t`: unit tangent in the plane of hole and ray
- `θ`: angle between the ray and `l`

The camera sits at r_o = D/r_s, and u = 1/r.

**Orbit equation.** Differentiating (du/dφ)² = u³ − u² + 1/b², the one the existing LUT uses, gives:

    u'' = 1.5 u² − u

**Initial conditions** for a static observer:

    u₀ = 1/r_o
    u₀' = u₀ √(1 − u₀) · cot θ

u₀' is positive for inward rays (θ < 90°) and negative for outward ones. It is equivalent to the existing impact parameter b = r_o sin θ / √(1 − u₀).

**Photon position** relative to the hole, as the ray is traced backward from the camera through azimuth φ:

    p(φ) = (1/u) · (−l cos φ + t sin φ)

This matches the existing background mapping `src = l cos β + t sin β` with Δφ = π − β. Use that as a consistency test.

**Disk-plane crossings.** The disk has unit axis `n` (its angular momentum direction) and passes through the hole. Then dot(p, n) = 0 gives:

    φ_k = φ₀ + kπ,   φ₀ = atan2(l·n, t·n), shifted into (0, π]

These angles are analytic, so no root-finding is needed; only u(φ_k) is required, from RK4 integration of the orbit equation. At each crossing k = 0, 1, 2:
- if r = 1/u falls in [r_in, r_out], that pixel sees the disk, and the first such crossing wins because a thin disk is opaque;
- if u ≥ 1, the ray fell in;
- if u ≤ 0, it escaped;
- crossings k = 1 and 2 are the image lifted over the top and the photon-ring image.

**Redshift and Doppler boosting.** The emitter is on a circular Keplerian orbit:

    Ω = 1/√(2r³)
    u^t = 1/√(1 − 1.5/r)

The photon's angular momentum about the disk axis is conserved, so compute it once at the camera. Use the forward-travelling photon, which is the reverse of the traced ray:

    L_z = b · dot(cross(l, t), n)

Then:

    g = √(1 − 1.5/r) / ( √(1 − u₀) · (1 − Ω·L_z) )

- T_obs = g·T_emit.
- Bolometric brightness scales as g⁴.
- Checks: face-on with a distant observer, g(r = 3) = √0.5. The side moving toward the camera has g > 1.

**Temperature profile** (thin disk, zero torque at r_in):

    T(r) ∝ (r_in/r)^{3/4} · (1 − √(r_in/r))^{1/4}

It peaks at r = (49/36)·r_in. Normalize so the peak is 1, and brightness ∝ g⁴ T⁴.

**Thick flow (M87\*, Sgr A\*, phase 2).** This one is optically thin, so it accumulates emission along the path instead of stopping at a plane crossing:
- Step φ from 0 until u ≥ 1 or u ≤ 0, at most 3π.
- At each step: p(φ), height z = p·n, cylindrical R = |p − z·n|.
- Emissivity: j ∝ r^{−2.5} · exp(−z² / (2(0.3R)²)), zero for r < 1.2.
- Intensity: I += g³ · j · dl, where dl = (1/u²)·√(u² + u'²)·dφ. Use sub-Keplerian rotation for the flow's Ω.
- The photon ring and the shadow emerge on their own.

## Values (every ⚠ must be checked against the paper, e.g. with WebFetch on the arXiv page, before committing)

| Black hole | Disk axis vs line of sight to Earth | Axis position angle on the sky | Other | Source |
|---|---|---|---|---|
| Cygnus X-1 | 27.51 (+0.77 / −0.57)° (orbital inclination) | Not measured; see orientation below | Inner-disk temperature ≈ 0.5 keV ≈ 6 MK in the soft state ⚠ | Miller-Jones et al. 2021, Science 371, 1046 (inclination, already cited in the app); temperature e.g. Gou et al. 2011, ApJ 742, 85 ⚠ |
| V404 Cygni | 67 (+3 / −1)° ⚠ | Not measured | Outbursts: 2015-06-15 to about 2015-08 ⚠; 1989-05-22 to about 1989-08 ⚠ | Khargharia, Froning & Robinson 2010, ApJ 716, 1105. The inclination is in the body, not the abstract ⚠ |
| A0620-00 | 50.98 ± 0.87° | Not measured | Outburst: 1975-08-03 to about 1975-10 ⚠ | Cantrell et al. 2010, ApJ 710, 1127 (already cited) |
| M87\* | Spin axis 17° from the line of sight, pointing away from Earth (the flow rotates clockwise on the sky) ⚠ | Approaching jet at PA ≈ 288° ⚠ | — | Walker et al. 2018, ApJ 855, 128 (17°, not in the abstract) ⚠; EHT 2019 Paper V, ApJL 875, L5 (PA 288°, clockwise) ⚠ |
| Sgr A\* | ≤ 30°. EHT disfavors > 50°; its best-fitting MAD models have ≤ 30°. Use 30°. | Unconstrained: choose one and say so | — | EHT 2022 Paper V, ApJL 930, L16 (https://ui.adsabs.harvard.edu/abs/2022ApJ...930L..16E/abstract) |

**Orientation where the sky position angle isn't measured.**
- Let e be the unit vector from the hole toward the Sun, N the sky-plane north at the hole (`skyNorth` in `src/scene/providers/blackHoles.ts`), and i the inclination.
- Set the axis to n = rotate(e, about N, by i), i.e. n = e·cos i + (N × e)·sin i.
- The line of nodes then runs north–south. For Cygnus X-1, the hole's offset from HD 226868 (placed toward N) lies in the disk plane, so the companion sits in the orbital plane.
- The sense of rotation isn't measured either; choose it and say so in the card.

**Orientation where the position angle is known (M87\*).**
- The approaching jet points along j = e·cos 17° + s·sin 17°, where s = N·cos PA + E·sin PA and E = normalize(cross([0,0,1], û)).
- The disk axis is n = −j (rotation clockwise as seen from Earth).

## Implementation

### 1. Data: `src/data/blackHoles.ts`

Add an optional `disk` to `BlackHoleDef`:

```ts
export interface DiskDef {
  kind: 'thin' | 'thick';
  /** Angle between the disk's angular-momentum axis and the direction to Earth (deg). */
  inclinationDeg: number;
  inclinationSource: Cite;
  /** Position angle (deg east of north) of the axis on the sky; omit when unmeasured. */
  axisPaDeg?: number;
  /** Axis points away from Earth, i.e. clockwise rotation on the sky (M87*). */
  axisAway?: boolean;
  rInRs: number; // 3 for thin disks
  rOutRs: number; // 40 for thin disks, ~10 for thick flows
  /** Inner-edge temperature (K), for the card; the palette is artistic. */
  tInnerK?: number;
  /** ISO date ranges when the disk shines (outbursts); omit for always. */
  active?: Array<[string, string]>;
  facts: InfoFact[];
  notes: ObjectInfo['notes'];
}
```

- Fill it in for `bh-cyg-x-1` (phase 1), `bh-m87` and `bh-sgr-a-star` (phase 2), and `bh-v404-cyg` and `bh-a0620-00` (phase 3), from the table above.
- **Cygnus X-1 facts:**
  - "Accretion disk": "Fed by its supergiant's wind; tilted 27.5° to our line of sight" (measured, Miller-Jones 2021)
  - "Inner disk temperature": "≈ 6 million K, shining in X-rays" (measured ⚠)
- **Cygnus X-1 notes:**
  - **model:** "Drawn as a thin disk from the innermost stable orbit of a non-spinning hole (3 r_s) to 40 r_s, with its light bent, Doppler-boosted and redshifted exactly. The real disk reaches much farther but is far dimmer there, and Cygnus X-1 spins so fast that its inner edge sits closer in. The disk's tilt is measured; which way it leans on the sky is not, so that is chosen."
  - **artistic:** "Colors follow NASA's visualizations. The disk shines mostly in X-rays; in visible light it would look blue-white. The streaks and their speed are illustrative."

### 2. Pure math: `src/astro/blackHole.ts` (tested in TS, mirrored in GLSL)

- `orbitRk4(u, du, h): [u, du]`: one RK4 step of u'' = 1.5u² − u.
- `diskCrossings(l, t, n): number[]`: φ₀, φ₀ + π, φ₀ + 2π.
- `traceToDisk(theta, ro, l, t, n, rIn, rOut, steps)`: returns `{ r, phi, k } | null`. This is the TS reference for the shader loop.
- `diskRedshift(r, Lz, ro)`: g, using the formula above.
- `thinDiskTemperature(r, rIn)`: normalized to peak 1.
- `diskAxis(e, north, inclDeg, paDeg?, away?)`: the orientation rules above.

### 3. Provider: `src/scene/providers/blackHoles.ts`

- `diskAxisWorld(def)`: EQJ unit vector, computed from the hole's current position (e = toward the Sun).
- `LensSource` gains `disk?: { axis: Vec3; kind: 'thin' | 'thick'; rIn: number; rOut: number }`.
  - `lenses(ctx)` fills it only when the disk is active at `this.world.ms`.
  - For `active` ranges, fade brightness in and out over about 3 days.
- Change the approach for disk holes to about 80° from the axis, toward the side of the old approach direction w:

  ```
  a = normalize(n·cos 80° + normalize(w − (w·n)·n)·sin 80°)
  ```

  w is the current Galactic-Center-facing approach vector.
- `info()`:
  - append `disk.facts`
  - replace the "No accretion disk or jet is drawn." note with `disk.notes` when the hole has a disk
  - for phase-3 holes, keep that note but say when the disk appears ("Shown during its 2015 outburst")

### 4. Layer: `src/scene/layers/blackHoles.ts`

- `Lens` gains `disk?` with the axis in view space: dot the world axis with `pose.right`, `pose.up` and `−pose.forward`, the same way `update()` builds `view`. It also carries `ro = D / rs` and the params.
- Choose the disk slot: the first selected lens that has a disk, and only if the disk's apparent radius asin(min(1, r_out/r_o)) exceeds about 2 px.
- `selectLenses` stays as it is.
- Pass `uTime` from the wall clock for the streak animation, which is artistic and not tied to the sim rate.

### 5. Shader: `src/engine/lensingPass.ts`

- **New uniforms:**
  - `uDiskLens` (int, −1 = none)
  - `uDiskAxis` (vec3, view space)
  - `uDiskParams` (vec4: rIn, rOut, ro, brightness)
  - `uDiskKind` (int: 0 = thin, 1 = thick)
  - `uTime`
  - `noiseTex`: bind `noiseTexture()` and paste `${noiseChunk}` from `src/scene/shaders/noise.ts`
- **New defines:** `DISK_STEPS 32` (RK4 steps per half-turn) and `MAX_CROSSINGS 3`.
- **Palette:** author it the way `src/scene/shaders/sun.ts` does, and paste `${agxChunk}` from `src/scene/shaders/agx.ts` (`agxVivid`). Otherwise AgX tone mapping turns the oranges salmon.
- **Placement in the loop:** inside the lens loop, before `src` is deflected, and when `i == uDiskLens`, evaluate the disk with the current `l`, `t`, `θ` into a premultiplied `vec4 disk`. After the loop:

  ```
  gl_FragColor = vec4(disk.rgb + (1 − disk.a) · bg · (1 − shadow), 1)
  ```

  The disk can sit in front of the shadow, so the shadow must not darken it. Pixels in front of the hole by depth skip the lens, and so also skip the disk, as now.

Sketch of the thin-disk march, to mirror exactly in the TS reference:

```glsl
vec2 orbitD(vec2 y) { return vec2(y.y, 1.5 * y.x * y.x - y.x); }
vec2 rk4(vec2 y, float h) {
  vec2 a = orbitD(y), b = orbitD(y + 0.5 * h * a), c = orbitD(y + 0.5 * h * b), d = orbitD(y + h * c);
  return y + h / 6.0 * (a + 2.0 * b + 2.0 * c + d);
}
vec4 thinDisk(vec3 l, vec3 t, float theta) {
  float ro = uDiskParams.z, uo = 1.0 / ro;
  vec2 y = vec2(uo, uo * sqrt(1.0 - uo) * cos(theta) / max(sin(theta), 1e-6));
  vec3 n = uDiskAxis;
  float phi0 = atan(dot(l, n), dot(t, n));
  if (phi0 <= 0.0) phi0 += PI;
  float phi = 0.0;
  for (int k = 0; k < MAX_CROSSINGS; k++) {
    float target = phi0 + float(k) * PI;
    float h = (target - phi) / float(DISK_STEPS);
    for (int s = 0; s < DISK_STEPS; s++) {
      y = rk4(y, h);
      if (y.x >= 1.0 || y.x <= 0.0) return vec4(0.0); // fell in, or escaped before the plane
    }
    phi = target;
    float r = 1.0 / y.x;
    if (r >= uDiskParams.x && r <= uDiskParams.y) {
      float b = ro * sin(theta) / sqrt(1.0 - uo);
      float g = sqrt(1.0 - 1.5 / r) / (sqrt(1.0 - uo) * (1.0 - inversesqrt(2.0 * r * r * r) * b * dot(cross(l, t), n)));
      // Brightness ∝ g⁴ T(r)⁴, streaks from fbm in (ln r, disk azimuth − Ω_vis(r)·uTime),
      // palette via agxVivid, alpha fades to 0 at r_out and in the last few % above r_in.
      return shadeThin(r, g, -l * cos(phi) + t * sin(phi), n);
    }
  }
  return vec4(0.0);
}
```

- **Degenerate case:** when the ray plane contains the axis (`|l·n|` and `|t·n|` both ≈ 0, an edge-on ray through the disk's own plane), skip the disk. Real disks have thickness, but this is rare and sub-pixel.
- **Far away:** beyond r_o = 10⁴ (the LUT's last row) the disk is sub-pixel for every hole we have. Skip the march there.

### 6. Performance

The march is at most 3 × 32 RK4 steps, and only for the one disk lens.
- **Budget:** under 4 ms per frame at 1280×800 on the dev Mac. Measure with the FPS readout (`ui.fps`), comparing lensing only against lensing plus disk.
- **If over budget:**
  1. Skip pixels farther than asin(min(1, 1.3·r_out/r_o)) + 2θ_E from the hole.
  2. Drop `DISK_STEPS` to 24.
  3. As a last resort, render the disk at half resolution into its own target, the way `GalaxyLayer` does.

### 7. Phase 3: outbursts on the clock

- **`active` ranges:** V404 Cyg in 2015 and 1989, and A0620-00 in 1975, faded over about 3 days.
- **Optional landmarks** in `src/data/landmarks.ts` via `at(iso, name, 'sky', 'bh-v404-cyg')`, for example "V404 Cygni erupts" on 2015-06-15. `tests/factcheck/landmarks.test.ts` requires date order.
- **Cards** for these holes say when the disk is shown.

## Tests

`tests/unit/accretionDisk.test.ts`:
- **Orbit vs LUT:** integrating `orbitRk4` from the camera until u ≤ 0 gives a total Δφ equal to `π − exactSourceAngle(θ, ro)` within 1e-3 rad, for several θ at r_o = 40 and 1000. This ties the march to the existing exact lensing.
- **Capture:** a ray with θ < shadow radius reaches u ≥ 1.
- **Crossings:** p(φ_k) is in the disk plane (|p·n| < 1e-9) for random l, t, n.
- **Redshift:**
  - face-on with a distant observer (L_z = 0, u₀ → 0): g(3) = √0.5
  - the approaching side has g > 1 and the receding side g < 1, at an edge-on view
- **Temperature:** zero at r_in, peak at (49/36)·r_in.
- **Orientation:**
  - Cygnus X-1's axis makes 27.51° with the direction to the Sun
  - its companion offset lies in the disk plane (dot ≈ 0)
  - M87\*'s axis makes 163° with the direction to Earth (pointing away)
- **Provider:** `lenses()` includes V404's disk on 2015-06-20 but not on 2020-01-01.

`tests/factcheck/blackHoles.test.ts`: assert the inclinations against literature constants, with a citation comment per value, as the file already does.

## Verification

1. Run `npm run typecheck` and `npm test`.
2. Take visual checks with headless Chromium against a dev server; the Browser pane may be hidden and throttled. Add a `.claude/launch.json` entry on a free port if 5173 is taken by another session. This script flies to each hole, steps the app, and screenshots it:

```js
// node shoot.mjs <outDir> <id>...   (server on http://localhost:PORT)
import { chromium } from './node_modules/playwright/index.mjs';
const [out, ...ids] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:PORT/#f=earth');
await page.waitForFunction(() => window.app?.stars?.catalog && window.app.cosmos.local?.length > 0, null, { timeout: 90000 });
for (const id of ids) {
  await page.evaluate((id) => { const a = window.app; a.flyTo(id); for (let i = 0; i < 200 && a.camera.flying; i++) a.tick(0.1); for (let i = 0; i < 20; i++) a.tick(0.05); }, id);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${id}.png` });
}
await browser.close();
```

3. **Expected results:**
   - **Cygnus X-1:** the NASA look, with the disk's far side arched over the shadow, its underside wrapped below, one side brighter (Doppler), and a thin inner ring.
   - **Orbiting to face-on** (`app.camera.orbit(0, 300, 800, 0.785)`): a flat ring.
   - **Sgr A\* and M87\*:** fuzzy asymmetric donuts when viewed from Earth's direction.
   - **V404 Cyg:** no disk at today's date; a disk after `app.clock.set(Date.parse('2015-06-20'))`.
4. Repeat one shot with `?logdepth` for the logarithmic-depth path.
5. Check the console for errors. Confirm each card's new facts and notes by opening the card: click `.where button`, then read `#facts`.

## Constraints

- Other sessions may share this checkout, so stage and commit only the files this work touches, by path. Check `git diff --cached --stat` right before committing.
- No asset pipeline changes, so no new asset release is needed.
- Keep the copy voice of the existing cards: short, plain, no em dashes. Every number carries a source, and every note carries a `kind` badge.

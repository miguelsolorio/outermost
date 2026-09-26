# Outermost

An objective-free exploration of the observable universe in the browser, at true scale and with real positions. You can scroll from a regional, Google-Earth-style view of Earth out through the solar system, the nearby stars, the Milky Way seen from outside, the Local Group and the cosmic web, to the cosmic microwave background at the edge of what we can observe.

Everything shown comes from NASA, ESA, JPL, USGS, the IAU and published catalogs. Every fact on an info card cites its source. An automated fact-check suite compares the rendered universe against JPL Horizons, SIMBAD, the IAU and VizieR.

## What's in it

**Planets and moons**
- Real-time positions and rotations for the Sun, the planets, 21 major moons, the dwarf planets and Vesta.
- Surfaces from mission mosaics.
- Planet colors enhanced in the style of NASA's press images, with moving atmospheres: flowing bands on the giant planets, drifting clouds on Earth and Venus, and Neptune's Great Dark Spot. Info cards mark both as Artistic.
- The Sun up close in the style of SDO's extreme-ultraviolet images.
- Earth: monthly Blue Marble imagery streamed down to about 2.4 km per pixel, plus:
  - an atmosphere with single scattering
  - clouds that cast shadows
  - city lights
  - sun glint on the oceans
- The Moon and Mars also get detail tiles, 0.67 km and 1.3 km per pixel respectively.
- Terrain relief from measured elevation: LOLA for the Moon, MOLA for Mars, GEBCO for Earth. Craters and canyons catch the light near the terminator.
- Real eclipses:
  - the Moon's shadow on Earth
  - a red Moon inside Earth's umbra
  - moons' shadows on their planets
- Saturn's rings from the Voyager occultation profile.
- Mars's dust haze at the limb.

**Small bodies and spacecraft**
- About 200,000 real asteroids and trans-Neptunian objects from the JPL Small-Body Database. Their orbits are propagated on the GPU.
- The ISS, propagated with SGP4 from current elements.
- Voyager 1 and 2, New Horizons and JWST, on their JPL Horizons trajectories.

**Stars and the Milky Way**
- 119,000 stars from the HYG and AT-HYG catalogs, at Gaia distances, with their true colors and brightnesses.
- The IAU constellations, which distort as you travel away from the Sun.
- A model of the Milky Way built from Reid et al. (2019) spiral arms.

**Galaxies and cosmology**
- The Local Group and the Local Volume. Hubble, ESO and NOIRLab photographs are placed at each galaxy's true position, size and orientation.
- The 2MASS and SDSS redshift surveys, and SDSS quasars.
- The Planck CMB map at the computed distance of last scattering.

**Time**
- Opens at the current moment.
- You can pause, speed up, rewind or jump to any date.

## Controls

| | Mouse / keyboard | Touch |
|---|---|---|
| Zoom | Scroll, `+` / `-` | Pinch |
| Orbit | Drag, arrow keys | Drag |
| Tilt toward the horizon | Shift-drag or right-drag | |
| Fly to an object | Double-click it, or search with `/` | Double-tap |
| Play or pause time | `Space` | Time bar |

Menu (☰) toggles:
- labels
- orbits
- constellations
- asteroids and the Kuiper belt
- size boost, which enlarges tiny bodies and is flagged on screen when active

The speaker button mutes the ambient sound. The sound is procedural, and browsers start it only after your first interaction.

## Accuracy

Each fact carries one of these badges:

| Badge | Meaning |
|---|---|
| **measured** | Observed values |
| **derived** | Computed from measured values |
| **model** | Physical or statistical models |
| **artistic** | Illustrative only |

`npm test` runs the checks below from committed fixtures, offline:

| Checked | Tolerance |
|---|---|
| Planet positions vs JPL Horizons | < 1′ as seen from Earth |
| Moon position | < 25 km |
| Moons' orbital phases | < 2° (Galilean moons < 0.5°) |
| Pluto (barycenter plus Charon wobble) | < 100 km |
| Asteroids vs Horizons | < 0.05° |
| Sub-observer points, which catch flipped or shifted textures | Checked for every textured body |
| Earth's subsolar point | < 0.05° |
| Bright stars vs SIMBAD | Checked |
| All 88 IAU constellations | Lines resolve; boundaries within 0.02° of VizieR VI/49 |
| Galactic frame | Matches the Hipparcos matrix |
| Local Group distances (M31, M33, LMC, SMC) | Match published values |
| Cosmology | Planck 2018 |
| ISS | Altitude, inclination and period checked |
| 2026 eclipses | Solar: the Moon's shadow falls within 1° of NASA's greatest-eclipse point. Lunar: the Moon sits deep in Earth's umbra |

## Development

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck
npm test             # unit + fact-check (asset checks run when assets exist)
npm run test:e2e     # Playwright smoke test and journey (Chromium + WebKit), needs `npm run build`
```

Without processed assets the app still runs, with bodies in flat colors. There are two ways to get assets:

- **Download them:** `npm run pull` fetches the newest `assets-*` GitHub Release into `public/assets/`. It needs the `gh` CLI.
- **Build them from the original sources:**

  ```bash
  brew install vips basis_universal uv
  npm run doctor       # checks the toolchain and disk space
  npm run pipeline     # downloads ~5 GB of sources into .cache/, writes ~500 MB to public/assets/
  npm run pipeline textures:earth-01   # or a single job
  ```

`npm run bake` refreshes the small reference data committed under `data/baked/` and `tests/fixtures/` from JPL Horizons, the SBDB, SIMBAD, CelesTrak and NSSDCA. The app itself never calls Horizons: it has no CORS headers, so everything is baked at build time.

### Layout

```
src/astro/     pure TypeScript astronomy: time, frames, ephemerides, orientation, Kepler, SGP4, cosmology, color
src/engine/    renderer (reversed-Z or log depth), camera controller, input, labels, asset loading
src/scene/     layers (bodies, detail tiles, rings, stars, constellations, Milky Way, galaxies, CMB, …) and providers (search, info cards)
src/ui/        Svelte HUD
src/audio/     procedural ambient sound
tools/bake/    build-time data fetchers → data/baked, tests/fixtures
tools/pipeline/ asset pipeline → public/assets (+ manifest.json with hashes and sources)
tools/pack/    asset bundle for GitHub Releases (pack / pull)
data/sources.json  registry of every source, with license and credit
```

### Precision

Distances in the scene span about 10⁶ m to 10²⁷ m. The camera sits at the origin and every object is positioned relative to it in float64. The depth buffer is reversed-Z with a float depth buffer, falling back to logarithmic depth where `EXT_clip_control` is missing. Point clouds use float32 in their native units (AU, pc, Mpc).

## Deployment

`.github/workflows/deploy.yml` deploys to GitHub Pages on every push to `main`. It pulls the asset bundle from the newest `assets-*` release, runs the tests, builds, and publishes.

To publish a new asset bundle, run `npm run pack`. It prints the `gh release create` command to run. Processed assets total about 500 MB, which is within the 1 GB Pages limit.

## Credits and licenses

The in-app **About & credits** page, reachable from the menu and the corner link, is generated from `data/sources.json`. It lists every dataset and image with its license.

- Most imagery and data are public domain (NASA, USGS, JPL).
- Galaxy photographs from ESA/Hubble, ESO and NOIRLab, and Jupiter from Hubble OPAL, are CC BY 4.0.
- Star data (HYG, AT-HYG) and constellation figures (Stellarium) are CC BY-SA 4.0. They ship as separate files with their license.

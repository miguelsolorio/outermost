// Application orchestrator: owns the clock, world, renderer, camera and layers,
// and runs the frame loop.

import * as THREE from 'three';
import { SimClock } from './astro/time.ts';
import { AU, DEG, PC } from './astro/units.ts';
import { length, normalize, smoothstep, sub, type Vec3 } from './astro/vec.ts';
import { Assets } from './engine/assets.ts';
import { CameraController } from './engine/camera/controller.ts';
import { formatDistance } from './engine/format.ts';
import { attachInput } from './engine/input.ts';
import { LabelLayer, type LabelItem, type Occluder } from './engine/labels.ts';
import { createRenderContext, FOV_DEG, type RenderContext } from './engine/renderer.ts';
import { readUrlState, writeUrlState } from './engine/urlState.ts';
import { BODIES, BODY_BY_ID, meanRadius } from './scene/catalog.ts';
import type { FrameCtx, Settings } from './scene/frame.ts';
import { rel } from './scene/frame.ts';
import { BodiesLayer } from './scene/layers/bodies.ts';
import { ConstellationsLayer, type ConstellationData } from './scene/layers/constellations.ts';
import { OrbitsLayer } from './scene/layers/orbits.ts';
import { SkyLayer } from './scene/layers/sky.ts';
import { loadStarCatalog, StarsLayer } from './scene/layers/stars.ts';
import { StarBodyLayer } from './scene/layers/starBody.ts';
import { GalaxyLayer } from './scene/layers/galaxy.ts';
import { GalaxyProvider } from './scene/providers/galaxy.ts';
import { SpacecraftLayer } from './scene/layers/spacecraft.ts';
import { SmallBodiesLayer } from './scene/layers/smallBodies.ts';
import { UserLocationLayer } from './scene/layers/userLocation.ts';
import { Ambient } from './audio/ambient.ts';
import { CosmosLayer } from './scene/layers/cosmos.ts';
import { CosmosProvider } from './scene/providers/cosmos.ts';
import { BlackHolesProvider } from './scene/providers/blackHoles.ts';
import { BlackHoleLayer } from './scene/layers/blackHoles.ts';
import { GalaxySpritesLayer } from './scene/layers/galaxySprites.ts';
import { SunGlareLayer } from './scene/layers/sunGlare.ts';
import { BodiesProvider } from './scene/providers/bodies.ts';
import { starDisplayName, StarsProvider } from './scene/providers/stars.ts';
import { Registry, type SearchEntry } from './scene/registry.ts';
import { World } from './scene/world.ts';
import { loadEphemerisTables } from './data/tables.ts';
import { bindActions, ui } from './ui/state.svelte.ts';

/**
 * How far out (in radii of the body in view) a landmark visit rises. The clock
 * jumps partway up, once the body is a dot, and the flight to the landmark
 * takes over before the rise ends, so the camera never stops.
 */
const PULL_BACK_RADII = 400;

/** Bodies a panned view can settle onto, so it moves with whatever it's looking at. */
const ANCHOR_IDS = BODIES.map((b) => b.id);

export class App {
  readonly clock: SimClock;
  readonly world = new World();
  readonly rc: RenderContext;
  readonly assets: Assets;
  readonly registry = new Registry();
  readonly camera: CameraController;
  readonly bodies: BodiesLayer;
  readonly orbits = new OrbitsLayer();
  readonly glare = new SunGlareLayer();
  readonly stars = new StarsLayer();
  readonly starBody = new StarBodyLayer(this.stars);
  readonly sky: SkyLayer;
  readonly constellations = new ConstellationsLayer();
  readonly galaxy: GalaxyLayer;
  readonly spacecraft: SpacecraftLayer;
  readonly cosmos: CosmosLayer;
  readonly cosmosProvider: CosmosProvider;
  readonly blackHoles: BlackHolesProvider;
  readonly blackHoleLayer: BlackHoleLayer;
  readonly sprites: GalaxySpritesLayer;
  readonly smallBodies: SmallBodiesLayer;
  readonly audio = new Ambient();
  readonly labels: LabelLayer;
  readonly userLocation: UserLocationLayer;
  settings: Settings = { labels: true, orbits: true, boost: false, constellations: false, smallBodies: true, location: true };
  private last = performance.now();
  private frames = 0;
  private fpsT = 0;
  private uiT = 0;
  private urlT = 0;
  private selected: string | null = null;
  /** A deep-linked focus whose catalog is still loading; the URL is left alone until it resolves. */
  private pendingFocus: string | null = null;
  /** "My location" pinned by the link (degrees), kept in the URL as it's rewritten. */
  private pinnedLocation: [number, number] | null = null;
  private searchIndex: SearchEntry[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    labelRoot: HTMLElement,
  ) {
    const params = new URLSearchParams(location.search);
    this.rc = createRenderContext(canvas, params.has('logdepth'));
    this.assets = new Assets(this.rc.renderer);
    this.bodies = new BodiesLayer(this.assets);
    this.sky = new SkyLayer(this.assets);
    this.galaxy = new GalaxyLayer(this.rc.renderer);
    this.spacecraft = new SpacecraftLayer(this.world);
    this.cosmos = new CosmosLayer(this.assets);
    this.sprites = new GalaxySpritesLayer(this.assets, this.cosmos);
    this.cosmosProvider = new CosmosProvider(this.world, this.cosmos, this.sprites);
    this.blackHoles = new BlackHolesProvider(this.world, (id) => this.registry.target(id), (id) => this.registry.info(id), this.stars);
    this.blackHoleLayer = new BlackHoleLayer(this.rc.lensing, this.rc.depthMode, this.rc.pixelRatio);
    this.smallBodies = new SmallBodiesLayer(this.assets, this.world);
    this.rc.scene.add(
      this.sky.mesh,
      this.galaxy.composite,
      this.cosmos.group,
      this.sprites.group,
      this.stars.points,
      this.stars.sun,
      this.constellations.group,
      this.bodies.group,
      this.orbits.group,
      this.glare.mesh,
      this.starBody.group,
      this.spacecraft.group,
      this.smallBodies.group,
    );

    this.registry.add(new BodiesProvider(this.world));
    this.registry.add(new StarsProvider(this.world, this.stars));
    this.registry.add(new GalaxyProvider(this.world));
    this.registry.add(this.spacecraft);
    this.registry.add(this.cosmosProvider);
    this.registry.add(this.blackHoles);
    this.registry.add(this.smallBodies);
    this.camera = new CameraController((id) => this.registry.target(id));
    this.camera.anchors = ANCHOR_IDS;
    this.labels = new LabelLayer(labelRoot, (id) => this.flyTo(id), (id) => (ui.hoverId = id));
    this.userLocation = new UserLocationLayer(labelRoot);

    const url = readUrlState();
    if (url.location) this.pinLocation(url.location);
    this.clock = new SimClock(url.time ?? Date.now());
    if (url.rate !== undefined) this.clock.rate = url.rate;
    if (url.paused) this.clock.paused = true;
    this.world.update(this.clock.ms);
    const focus = url.focus && this.registry.target(url.focus) ? url.focus : 'earth';
    if (url.focus && focus !== url.focus) this.pendingFocus = url.focus;
    this.camera.set(this.chainFor(focus), url.altitude ?? 3.2e7, url.dir ?? this.defaultDir(focus));

    attachInput(canvas, this.camera, {
      surfaceDirAt: (x, y) => this.surfaceDirAt(x, y),
      pick: (x, y) => this.pick(x, y),
      select: (id) => this.select(id),
      flyTo: (id) => this.flyTo(id),
      rayAt: (x, y) => this.rayAt(x, y),
      fovRad: () => FOV_DEG * DEG,
      freeMode: () => this.camera.freeMode,
      toggleFreeMode: () => this.setFreeMode(!this.camera.freeMode),
      recenter: () => this.recenter(),
      onUserInteraction: () => {},
      togglePause: () => {
        this.clock.setPaused(!this.clock.paused);
        ui.paused = this.clock.paused;
      },
    });

    window.addEventListener('resize', () => this.resize());
    // Deep links pasted or edited by hand (replaceState never fires this).
    window.addEventListener('hashchange', () => this.applyUrl());
    this.resize();
    this.bindUi();
  }

  private chainFor(id: string): string[] {
    return CameraController.chainFor(id, (x) => this.registry.target(x));
  }

  private pinLocation(at: [number, number]): void {
    this.pinnedLocation = at;
    this.userLocation.pin(at[0], at[1]);
  }

  private applyUrl(): void {
    const url = readUrlState();
    if (url.location) this.pinLocation(url.location);
    if (url.time !== undefined) this.clock.set(url.time);
    if (url.rate !== undefined) this.clock.setRate(url.rate);
    this.clock.setPaused(!!url.paused);
    this.world.update(this.clock.ms);
    const focus = url.focus && this.registry.target(url.focus) ? url.focus : this.camera.focusId;
    this.camera.set(this.chainFor(focus), url.altitude ?? this.camera.altitude, url.dir ?? this.defaultDir(focus));
  }

  /** Start looking at the day side from slightly north of the orbit plane. */
  private defaultDir(id: string): Vec3 {
    const t = this.registry.target(id);
    const p = t ? t.pos() : ([0, 0, 0] as Vec3);
    if (length(p) < 1) return normalize([0.2, -0.9, 0.4]);
    const toSun = normalize([-p[0], -p[1], -p[2]]);
    const side = normalize([toSun[1], -toSun[0], 0.35]);
    return normalize([toSun[0] + side[0] * 0.9, toSun[1] + side[1] * 0.9, toSun[2] + 0.35]);
  }

  async init(): Promise<void> {
    await this.assets.init();
    ui.assetsMissing = !this.assets.manifest;
    ui.depthMode = this.rc.depthMode;
    this.refreshSearch();
    ui.ready = true;
    requestAnimationFrame(this.frame);
    void this.bodies.init();
    void this.spacecraft.refreshTle();
    this.userLocation.setEnabled(this.settings.location);
    void this.smallBodies.init().then(() => this.refreshSearch());

    // Galaxy catalogs, Horizons tables (dwarf planets, spacecraft) and stars stream in after the first frame.
    void this.cosmos.init().then(async () => {
      this.refreshSearch();
      await this.sprites.init();
    });
    void loadEphemerisTables().then(() => this.refreshSearch());
    const cat = await loadStarCatalog(this.assets);
    if (cat) {
      this.stars.setCatalog(cat);
      const cons = await this.assets.json<ConstellationData>('stars/constellations.json');
      if (cons) this.constellations.build(cons, cat);
      this.refreshSearch();
      this.resolvePending();
    }
  }

  private bindUi(): void {
    ui.settings = { ...this.settings };
    ui.soundOn = this.audio.on;
    bindActions({
      setRate: (r) => {
        this.clock.setRate(r);
        this.clock.setPaused(false);
      },
      setSpeed: (r) => this.clock.setRate(r),
      readClock: () => ({ ms: this.clock.ms, rate: this.clock.rate, paused: this.clock.paused }),
      setPaused: (p) => this.clock.setPaused(p),
      setTime: (ms) => this.clock.set(ms),
      now: () => {
        this.clock.set(Date.now());
        this.clock.setRate(1);
        this.clock.setPaused(false);
      },
      flyTo: (id, opts) => this.flyTo(id, opts),
      pullBack: () => this.pullBack(),
      setFreeMode: (on) => this.setFreeMode(on),
      recenter: () => this.recenter(),
      flightHigh: () => this.camera.transit?.high ?? true,
      select: (id) => this.select(id),
      nearby: (limit) => this.nearby(limit),
      distanceTo: (id) => this.distanceTo(id),
      setSound: (on) => {
        this.audio.setEnabled(on);
        ui.soundOn = on;
      },
      toggle: (key) => {
        this.settings[key] = !this.settings[key];
        ui.settings = { ...this.settings };
        if (key === 'location') this.userLocation.setEnabled(this.settings.location);
      },
    });
  }

  /** Apply a deep link once its target's catalog has loaded (a star, a galaxy's black hole). */
  private resolvePending(): void {
    const f = this.pendingFocus;
    if (!f || !this.registry.target(f)) return;
    this.pendingFocus = null;
    if (!this.camera.flying) this.applyUrl();
  }

  /** On the way somewhere: flying, or a landmark visit's pull-back and clock jump before its flight. */
  get travelling(): boolean {
    return this.camera.flying || ui.visiting;
  }

  /** `from`: arrive on the side of `id` facing this object. */
  flyTo(id: string, opts: { from?: string } = {}): void {
    if (!this.registry.target(id)) return;
    this.pendingFocus = null;
    this.select(id);
    this.camera.flyTo(id, FOV_DEG * DEG, { from: opts.from });
  }

  /**
   * Before the clock jumps: rise straight up from the body in view, looking the
   * same way, so it's a dot (not seen spinning) by the time the clock moves.
   * Nothing to do when already that far out, or mid-flight.
   */
  pullBack(): void {
    if (this.camera.flying) return;
    const id = this.camera.viewFocusId;
    const t = this.registry.target(id);
    const view = this.camera.view;
    if (!t || !view || t.radius <= 0) return;
    const clear = PULL_BACK_RADII * t.radius;
    if (view.r >= clear) return;
    this.camera.flyTo(id, FOV_DEG * DEG, { distance: clear, arrive: view.dir });
  }

  setFreeMode(on: boolean): void {
    this.camera.freeMode = on;
    ui.freeMode = on;
  }

  /** Glide back to center on the body a pan left, at the same distance and angle. */
  recenter(): void {
    const view = this.camera.view;
    if (!this.camera.panned || !view) return;
    this.camera.flyTo(this.camera.focusId, FOV_DEG * DEG, { distance: view.r, arrive: view.dir });
  }

  select(id: string | null): void {
    this.selected = id;
    ui.selectedId = id;
  }

  private refreshSearch(): void {
    // Kept unproxied here: nearby() walks every entry.
    this.searchIndex = this.registry.search();
    ui.searchIndex = this.searchIndex;
  }

  nearby(limit: number): SearchEntry[] {
    const out: Array<{ entry: SearchEntry; dist: number }> = [];
    for (const entry of this.searchIndex) {
      if (entry.diffuse || entry.id === this.camera.focusId) continue;
      const dist = this.distanceTo(entry.id);
      if (dist !== null) out.push({ entry, dist });
    }
    return out
      .sort((a, b) => a.dist - b.dist)
      .slice(0, limit)
      .map((x) => x.entry);
  }

  /** Camera to surface (m); null when the target has no position now or the camera is inside it. */
  distanceTo(id: string): number | null {
    const t = this.registry.target(id);
    if (!t) return null;
    const d = length(rel(t.pos(), this.camera.pose.position)) - t.radius;
    return Number.isFinite(d) && d >= 0 ? d : null;
  }

  private resize(): void {
    this.rc.resize();
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.orbits.setResolution(w, h);
    this.galaxy.setSize(w, h, this.rc.pixelRatio);
    this.constellations.setResolution(w, h);
    this.spacecraft.setResolution(w, h);
  }

  // ---- picking ---------------------------------------------------------------

  private screenOf(p: Vec3): { x: number; y: number; z: number } | null {
    const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(this.rc.camera.matrixWorldInverse);
    if (v.z >= 0) return null;
    const depth = -v.z;
    v.applyMatrix4(this.rc.camera.projectionMatrix);
    return { x: (v.x * 0.5 + 0.5) * this.canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * this.canvas.clientHeight, z: depth };
  }

  pick(x: number, y: number): string | null {
    const cam = this.camera.pose.position;
    let best: { id: string; score: number } | null = null;
    for (const def of BODIES) {
      const vis = this.bodies.visuals.get(def.id)!;
      if (!this.world.get(def.id).valid) continue;
      const s = this.screenOf(rel(this.world.get(def.id).pos, cam));
      if (!s) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      const reach = Math.max(vis.apparentPx + 4, 12);
      if (d > reach) continue;
      // Prefer bodies whose disk contains the cursor, then nearer ones.
      const score = (d <= vis.apparentPx ? 0 : 1e6) + s.z * 1e-12 + d;
      if (!best || score < best.score) best = { id: def.id, score };
    }
    if (best) return best.id;
    // Then the visible named stars (their labels are the main way to click them).
    for (const id of this.labels.visibleIds) {
      if (!id.startsWith('star-')) continue;
      const t = this.registry.target(id);
      const s = t && this.screenOf(rel(t.pos(), cam));
      if (s && Math.hypot(s.x - x, s.y - y) < 10) return id;
    }
    return null;
  }

  /** World ray (unit) through a pixel; the camera sits at the origin. */
  private rayAt(x: number, y: number): Vec3 {
    const ndc = new THREE.Vector3((x / this.canvas.clientWidth) * 2 - 1, -(y / this.canvas.clientHeight) * 2 + 1, 0.5);
    ndc.unproject(this.rc.camera);
    return normalize([ndc.x, ndc.y, ndc.z]);
  }

  /** Direction from the focus center to the surface point under a pixel, if hit. */
  private surfaceDirAt(x: number, y: number): Vec3 | null {
    const target = this.camera.focus;
    if (target.radius <= 0) return null;
    const d = this.rayAt(x, y);
    const c = rel(target.pos(), this.camera.pose.position);
    const b = d[0] * c[0] + d[1] * c[1] + d[2] * c[2];
    const cc = c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
    const disc = b * b - (cc - target.radius * target.radius);
    if (disc < 0) return null;
    const t = b - Math.sqrt(disc);
    if (t <= 0) return null;
    const hit: Vec3 = [d[0] * t, d[1] * t, d[2] * t];
    return normalize(sub(hit, c));
  }

  // ---- frame loop -----------------------------------------------------------

  private frame = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.tick(dt, now);
    requestAnimationFrame(this.frame);
  };

  /** Advance and render one frame. Public so tests can step deterministically. */
  tick(dt: number, now = performance.now()): void {
    this.clock.tick(dt);
    this.world.update(this.clock.ms);
    if (!this.registry.target(this.camera.focusId)) {
      // The focus has no data at this time (e.g. before a spacecraft launched).
      this.camera.set(this.chainFor('sun'), Math.max(this.camera.pose.r, 5 * 1.496e11), this.camera.dir);
    }
    const pose = this.camera.update(dt);

    // Camera: fixed at the origin, rotated to the pose basis.
    const cam3 = this.rc.camera;
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...pose.right),
      new THREE.Vector3(...pose.up),
      new THREE.Vector3(-pose.forward[0], -pose.forward[1], -pose.forward[2]),
    );
    cam3.quaternion.setFromRotationMatrix(m);

    // Near plane: a tenth of the distance to the nearest surface.
    let nearest = Infinity;
    for (const def of BODIES) {
      if (!this.world.get(def.id).valid) continue;
      const d = length(rel(this.world.get(def.id).pos, pose.position)) - meanRadius(def) * (this.bodies.visuals.get(def.id)?.boost ?? 1);
      nearest = Math.min(nearest, d);
    }
    // Mid-flight both ends of the trip count, so the destination isn't clipped until landing.
    const transit = this.camera.transit;
    for (const id of transit ? [transit.fromChain[0], transit.toChain[0]] : [this.camera.focusId]) {
      const t = this.registry.target(id);
      if (t && t.radius > 0) nearest = Math.min(nearest, length(rel(t.pos(), pose.position)) - t.radius);
    }
    cam3.near = Math.min(1e7, Math.max(1, nearest * 0.1));
    cam3.far = 1e30;
    cam3.updateProjectionMatrix();
    cam3.updateMatrixWorld();

    const ctx = this.frameCtx(dt);
    this.sky.update(ctx);
    this.galaxy.update(ctx);
    this.cosmos.update(ctx);
    this.sprites.update(ctx);
    this.stars.update(ctx);
    // The focused (or selected) catalog star is drawn as a sphere when close.
    const starId = [this.camera.viewFocusId, this.selected].find((x) => x?.startsWith('star-'));
    const starT = starId ? this.registry.target(starId) : undefined;
    // A black hole's companion star (Cygnus X-1's) is drawn beside it at its published size and temperature.
    const companion = starT ? null : this.blackHoles.companion(this.camera.viewFocusId);
    if (companion) this.starBody.update(ctx, companion.index, companion.radius, companion.color);
    else this.starBody.update(ctx, starId && starT ? Number(starId.slice(5)) : -1, starT?.radius ?? 0);
    this.constellations.update(ctx);
    this.bodies.update(ctx);
    this.orbits.update(ctx);
    this.spacecraft.update(ctx);
    this.smallBodies.update(ctx);
    this.glare.update(ctx);
    this.audio.update(pose.r, length(rel(this.world.get('sun').pos, pose.position)));
    this.blackHoleLayer.update(ctx, this.blackHoles.lenses(ctx));
    this.updateLabels(ctx);
    const earth = this.bodies.visuals.get('earth')!;
    this.userLocation.update(ctx, earth.apparentPx, earth.boost);

    this.galaxy.render();
    this.rc.render();
    this.syncUi(now, dt);
  }

  /** Exposure follows a focused body (or its planet) and relaxes to 1 AU when zoomed out to distance r. */
  private exposureFor(id: string, r: number): number {
    const focusDef = BODY_BY_ID.get(id);
    if (!focusDef) return AU;
    const planet = focusDef.kind === 'moon' ? BODY_BY_ID.get(focusDef.parent!)! : focusDef;
    const planetDist = Math.max(this.world.get(planet.id).sunDist, 0.2 * AU);
    const w = planet.semiMajorAxis ? smoothstep(Math.log(0.3 * planet.semiMajorAxis), Math.log(1.5 * planet.semiMajorAxis), Math.log(r)) : 1;
    return Math.exp(Math.log(planetDist) * (1 - w) + Math.log(AU) * w);
  }

  private frameCtx(dt: number): FrameCtx {
    const pose = this.camera.pose;
    const h = this.canvas.clientHeight;
    const fov = FOV_DEG * DEG;
    // Mid-flight, blend from the origin's exposure to the destination's as the pan goes.
    const transit = this.camera.transit;
    const exposureDist = transit
      ? Math.exp(Math.log(this.exposureFor(transit.fromChain[0], pose.r)) * (1 - transit.w) + Math.log(this.exposureFor(transit.toChain[0], pose.r)) * transit.w)
      : this.exposureFor(this.camera.focusId, pose.r);
    const bodyOf = (chain: string[]): string => chain.find((id) => BODY_BY_ID.has(id)) ?? 'sun';
    return {
      world: this.world,
      pose,
      cam: pose.position,
      camera: this.rc.camera,
      viewportH: h,
      viewportW: this.canvas.clientWidth,
      fov,
      pxPerRad: h / fov,
      exposureDist,
      skyBrightness: 0.4,
      focusId: this.camera.viewFocusId,
      focusBody: bodyOf(this.camera.viewChain),
      focusBlend: transit ? { from: bodyOf(transit.fromChain), to: bodyOf(transit.toChain), w: transit.w } : null,
      selectedId: this.selected,
      settings: this.settings,
      dt,
    };
  }

  private updateLabels(ctx: FrameCtx): void {
    const items: LabelItem[] = [];
    const occluders: Occluder[] = [];
    for (const def of BODIES) {
      const st = this.world.get(def.id);
      const vis = this.bodies.visuals.get(def.id)!;
      const p = rel(st.pos, ctx.cam);
      const R = meanRadius(def) * vis.boost;
      occluders.push({ id: def.id, center: p, radius: R });
      // Hide a moon's label when it sits on top of its planet on screen.
      let alpha = 1;
      if (def.kind === 'moon' && def.parent) {
        const pp = rel(this.world.get(def.parent).pos, ctx.cam);
        const sepPx = (def.semiMajorAxis / Math.max(length(pp), 1)) * ctx.pxPerRad;
        alpha = smoothstep(14, 30, sepPx);
      }
      // Planet labels fade out once we are among the stars; the Sun's label
      // hands over to the Milky Way's once we see the Galaxy from outside.
      const fromSun = length(rel(this.world.get('sun').pos, ctx.cam));
      if (def.kind !== 'star') alpha *= 1 - smoothstep(Math.log(2000 * AU), Math.log(20000 * AU), Math.log(fromSun));
      else if (this.camera.focusId !== 'sun') alpha *= 1 - smoothstep(Math.log(40 * PC * 1000), Math.log(400 * PC * 1000), Math.log(fromSun));
      if (vis.apparentPx > ctx.viewportH * 0.9 || !st.valid) alpha = 0;
      const focused = def.id === this.camera.focusId || def.id === this.selected;
      items.push({
        id: def.id,
        text: def.name,
        priority: (focused ? 1000 : 0) + (def.kind === 'star' ? 90 : def.kind === 'planet' ? 80 : def.kind === 'dwarf-planet' ? 60 : 50),
        pos: p,
        offsetPx: Math.min(vis.apparentPx, 200),
        kind: def.kind,
        alpha,
        focused,
      });
    }

    // Named stars, prioritized by their apparent brightness from the camera.
    const cat = this.stars.catalog;
    if (cat) {
      const sunRel = rel(this.world.get('sun').pos, ctx.cam);
      for (const m of cat.meta) {
        const isFocus = this.camera.focusId === `star-${m.i}` || this.selected === `star-${m.i}`;
        if (!m.name && !isFocus) continue;
        const sp = this.stars.starPos(m.i, this.world.ms);
        const p: Vec3 = [sunRel[0] + sp[0], sunRel[1] + sp[1], sunRel[2] + sp[2]];
        const dpc = length(p) / PC;
        const mag = m.absmag + 5 * Math.log10(Math.max(dpc, 1e-9) / 10);
        if (mag > 2.6 && !isFocus) continue;
        const R = isFocus ? (this.registry.target(`star-${m.i}`)?.radius ?? 0) : 0;
        const diskPx = R ? Math.asin(Math.min(1, R / Math.max(length(p), R))) * ctx.pxPerRad : 0;
        items.push({
          id: `star-${m.i}`,
          text: starDisplayName(m),
          priority: (isFocus ? 1000 : 0) + 40 - mag * 5,
          pos: p,
          offsetPx: Math.max(4, Math.min(diskPx, 300)),
          kind: 'star-catalog',
          alpha: isFocus ? 1 : smoothstep(2.6, 1.2, mag),
          focused: isFocus,
        });
      }
    }

    for (const c of this.spacecraft.labels()) {
      const focused = this.camera.focusId === c.id || this.selected === c.id;
      items.push({ id: c.id, text: c.name, priority: focused ? 1000 : 45, pos: rel(c.pos, ctx.cam), offsetPx: 6, kind: 'craft', alpha: focused ? 1 : c.alpha, focused });
    }

    // Named asteroids and trans-Neptunian objects, and the populations' names.
    for (const c of this.smallBodies.labels(ctx)) {
      const focused = this.camera.focusId === c.id || this.selected === c.id;
      items.push({ id: c.id, text: c.name, priority: (focused ? 1000 : 0) + c.priority, pos: rel(c.pos, ctx.cam), offsetPx: 5, kind: c.group ? 'region' : 'smallbody', alpha: focused ? 1 : c.alpha, focused });
    }

    // Famous galaxies, clusters and superclusters at their catalog positions.
    {
      const fromSunMpc = length(rel(this.world.get('sun').pos, ctx.cam)) / (PC * 1e6);
      for (const c of this.cosmosProvider.labels()) {
        const focused = this.camera.focusId === c.id || this.selected === c.id;
        const vis = smoothstep(Math.log(c.minMpc), Math.log(c.minMpc * 3), Math.log(fromSunMpc)) * (1 - smoothstep(Math.log(c.maxMpc), Math.log(c.maxMpc * 3), Math.log(fromSunMpc)));
        if (vis < 0.02 && !focused) continue;
        items.push({ id: c.id, text: c.name, priority: (focused ? 1000 : 0) + c.priority, pos: rel(c.pos, ctx.cam), offsetPx: 8, kind: 'galaxy', alpha: focused ? 1 : vis, focused });
      }
    }

    // Black holes: stellar ones once we are out among the stars, supermassive ones inside their galaxy.
    for (const c of this.blackHoles.labels(ctx)) {
      const focused = this.camera.focusId === c.id || this.selected === c.id;
      if (c.alpha < 0.02 && !focused) continue;
      items.push({ id: c.id, text: c.name, priority: (focused ? 1000 : 0) + c.priority, pos: c.rel, offsetPx: c.offsetPx, kind: 'blackhole', alpha: focused ? 1 : c.alpha, focused });
    }

    // The Galaxy's own label once we can see it from outside.
    {
      const fromSun = length(rel(this.world.get('sun').pos, ctx.cam));
      const mw = this.registry.target('milky-way')!;
      const focused = this.camera.focusId === 'milky-way' || this.selected === 'milky-way';
      items.push({
        id: 'milky-way',
        text: 'Milky Way',
        priority: focused ? 1000 : 95,
        pos: rel(mw.pos(), ctx.cam),
        offsetPx: 12,
        kind: 'galaxy',
        alpha: focused ? 1 : smoothstep(3 * PC * 1000, 12 * PC * 1000, fromSun),
        focused,
      });
    }

    // Constellation names, placed on the sky from the Sun's point of view.
    if (this.settings.constellations) {
      const fromSunPc = length(rel(this.world.get('sun').pos, ctx.cam)) / PC;
      const a = 1 - smoothstep(30, 300, fromSunPc);
      for (const c of this.constellations.labels) {
        items.push({
          id: `con-${c.abbr}`,
          text: c.name.toUpperCase(),
          priority: 10,
          pos: [c.dir[0] * 1e20, c.dir[1] * 1e20, c.dir[2] * 1e20],
          offsetPx: -20,
          kind: 'constellation',
          alpha: a * 0.8,
        });
      }
    }
    // Behind a black hole, what you see is bent elsewhere: drop labels inside its Einstein ring.
    const shown = items.filter((it) => it.kind === 'blackhole' || it.focused || !this.blackHoleLayer.hides(it.pos));
    this.labels.update(shown, ctx.camera, ctx.viewportW, ctx.viewportH, occluders, this.settings.labels);
  }

  private syncUi(now: number, dt: number): void {
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 1) {
      ui.fps = Math.round(this.frames / this.fpsT);
      this.frames = 0;
      this.fpsT = 0;
    }
    if (now - this.uiT > 100) {
      this.uiT = now;
      // A deep link waits here until its catalog (stars, galaxies) has streamed in.
      if (this.pendingFocus) this.resolvePending();
      this.camera.reanchor();
      ui.panned = this.camera.panned;
      ui.freeMode = this.camera.freeMode;
      ui.timeMs = this.clock.ms;
      ui.rate = this.clock.rate;
      ui.paused = this.clock.paused;
      // The title names a clicked object until it is deselected; otherwise where the camera is.
      const picked = this.selected && this.selected !== this.camera.focusId && this.registry.target(this.selected) ? this.selected : null;
      const id = picked ?? (this.camera.flying ? this.camera.focusId : this.camera.dominantId());
      if (ui.card?.id !== id) ui.card = this.registry.info(id) ?? null;
      ui.focusId = id;
      ui.focusName = ui.card?.name ?? id;
      const focus = this.registry.target(id) ?? this.camera.focus;
      // Panned, the camera's altitude measures to the look point, not the body.
      const alt = id === this.camera.focusId && !this.camera.panned ? this.camera.altitude : length(rel(focus.pos(), this.camera.pose.position)) - focus.radius;
      const def = BODY_BY_ID.get(id);
      ui.distanceText =
        def?.kind === 'star' || !def
          ? id === 'observable-universe'
            ? `${formatDistance(length(rel(focus.pos(), this.camera.pose.position)))} from Earth`
            : `${formatDistance(length(rel(focus.pos(), this.camera.pose.position)))} from ${def ? 'the center of the ' : ''}${ui.focusName}`
          : alt < 0
            ? `Passing through ${ui.focusName}`
            : alt < 50 * focus.radius
            ? `Altitude ${formatDistance(alt)} above ${ui.focusName}`
            : `${formatDistance(length(rel(focus.pos(), this.camera.pose.position)))} from ${ui.focusName}`;
    }
    if (now - this.urlT > 1000 && !this.camera.flying && !this.pendingFocus) {
      this.urlT = now;
      writeUrlState({
        focus: this.camera.focusId,
        altitude: this.camera.altitude,
        dir: this.camera.dir,
        time: this.clock.ms,
        rate: this.clock.rate,
        paused: this.clock.paused,
        location: this.pinnedLocation ?? undefined,
      });
    }
  }
}

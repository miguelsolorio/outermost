// Loads the app, checks it renders without errors, and flies from Earth to
// the edge of the observable universe and back.
import { expect, test, type Page } from '@playwright/test';

interface AppHandle {
  stars: { catalog: unknown };
  galaxy: { ready: boolean };
  camera: { focusId: string; pose: { position: number[]; r: number } };
  clock: { ms: number };
  flyTo(id: string): void;
  tick(dt: number): void;
}

async function ready(page: Page) {
  await page.waitForFunction(() => {
    const a = (window as unknown as { app?: AppHandle }).app;
    return !!a?.stars?.catalog;
  }, null, { timeout: 60_000 });
}

test('renders the default view without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await ready(page);
  await expect(page.locator('.focus')).toHaveText('Earth');
  // The canvas shows something: the screenshot isn't a single flat color.
  const shot = await page.locator('canvas#scene').screenshot();
  expect(new Set(shot.subarray(1000, 60_000)).size).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test('search finds Saturn and flies there', async ({ page }) => {
  await page.goto('/#p=1');
  await ready(page);
  await page.keyboard.press('/');
  await page.keyboard.type('saturn');
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const a = (window as unknown as { app: AppHandle }).app;
    for (let i = 0; i < 400; i++) a.tick(1 / 30);
  });
  await expect(page.locator('.focus')).toHaveText('Saturn');
});

test('command palette finds Jupiter and flies there', async ({ page }) => {
  await page.goto('/#p=1');
  await ready(page);
  await page.keyboard.press('ControlOrMeta+K');
  const palette = page.getByRole('dialog', { name: 'Go to' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('jupiter');
  await expect(palette.getByRole('option').first()).toContainText('Jupiter');
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await page.evaluate(() => {
    const a = (window as unknown as { app: AppHandle }).app;
    for (let i = 0; i < 400; i++) a.tick(1 / 30);
  });
  await expect(page.locator('.focus')).toHaveText('Jupiter');
});

test('searching an event jumps the clock to it and flies to its object', async ({ page }) => {
  await page.goto('/#p=1');
  await ready(page);
  await page.keyboard.press('ControlOrMeta+K');
  await page.keyboard.type('apollo 11');
  await expect(page.getByRole('option').first()).toContainText('Apollo 11 lands on the Moon');
  // Note how far out the camera is when the clock first moves.
  await page.evaluate(() => {
    const w = window as unknown as { app: AppHandle; rAtJump?: number };
    const ms0 = w.app.clock.ms;
    const watch = () => {
      if (w.app.clock.ms !== ms0) w.rAtJump = w.app.camera.pose.r;
      else requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await page.keyboard.press('Enter');
  const landing = Date.parse('1969-07-20T20:17Z');
  await page.waitForFunction((ms) => Math.abs((window as unknown as { app: AppHandle }).app.clock.ms - ms) < 60_000, landing);
  // It pulled back first, so Earth was a dot (not seen spinning) while the clock jumped.
  expect(await page.evaluate(() => (window as unknown as { rAtJump?: number }).rAtJump)).toBeGreaterThan(50 * 6.371e6);
  await page.evaluate(() => {
    const a = (window as unknown as { app: AppHandle }).app;
    for (let i = 0; i < 400; i++) a.tick(1 / 30);
  });
  await expect(page.locator('.focus')).toHaveText('Moon');
});

test('journey: Earth -> observable universe -> Earth keeps a finite, consistent camera', async ({ page }) => {
  await page.goto('/#f=earth&h=2e7&p=1');
  await ready(page);
  const result = await page.evaluate(() => {
    const a = (window as unknown as { app: AppHandle }).app;
    const out: Array<{ focus: string; r: number; finite: boolean }> = [];
    for (const id of ['moon', 'sun', 'milky-way', 'local-group', 'observable-universe', 'earth']) {
      a.flyTo(id);
      for (let i = 0; i < 600; i++) a.tick(1 / 30);
      const p = a.camera.pose;
      out.push({ focus: a.camera.focusId, r: p.r, finite: p.position.every(Number.isFinite) && Number.isFinite(p.r) });
    }
    return out;
  });
  for (const step of result) expect(step.finite, JSON.stringify(step)).toBe(true);
  expect(result.map((s) => s.focus)).toEqual(['moon', 'sun', 'milky-way', 'local-group', 'observable-universe', 'earth']);
  // Back home at a sensible distance (not stuck at cosmological scale).
  expect(result[result.length - 1].r).toBeLessThan(1e9);
});

test('flights glide: no per-frame jumps, including a retarget and a grab mid-flight', async ({ page }) => {
  await page.goto('/#f=earth&h=2e7&p=1');
  await ready(page);
  // Spacecraft and black holes come from catalogs that load after the first frame.
  await page.waitForFunction(() => {
    const r = (window as unknown as { app: { registry: { target(id: string): unknown } } }).app.registry;
    return ['voyager-1', 'bh-v404-cyg'].every((id) => r.target(id));
  }, null, { timeout: 60_000 });
  const result = await page.evaluate(() => {
    type V = [number, number, number];
    interface Cam {
      view: { pivot: V; shift: V; r: number };
      pose: { forward: V };
      flying: boolean;
      focusId: string;
      orbit(dx: number, dy: number, h: number, fov: number): void;
    }
    const a = (window as unknown as { app: { camera: Cam; registry: { target(id: string): { pos(): V } | undefined }; flyTo(id: string): void; tick(dt: number): void } }).app;
    const sub = (p: V, q: V): V => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    const len = (p: V) => Math.hypot(p[0], p[1], p[2]);
    const dot = (p: V, q: V) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    // Worst per-frame change over a trip at 60 Hz: pan in view distances, zoom in e-folds, turn in degrees.
    const trip = (id: string, events: Record<number, () => void> = {}, frames = 0, ref = id) => {
      let prev: { look: V; r: number; f: V } | null = null;
      const worst = { pan: 0, zoom: 0, turn: 0 };
      a.flyTo(id);
      for (let i = 0; i < 600 && (i < frames || a.camera.flying); i++) {
        events[i]?.();
        a.tick(1 / 60);
        const v = a.camera.view;
        // Measured from the destination, exact near it.
        const look = sub(v.pivot, a.registry.target(ref)!.pos()).map((x, k) => x + v.shift[k]) as V;
        const cur = { look, r: v.r, f: a.camera.pose.forward };
        if (prev) {
          worst.pan = Math.max(worst.pan, len(sub(cur.look, prev.look)) / Math.min(cur.r, prev.r));
          worst.zoom = Math.max(worst.zoom, Math.abs(Math.log(cur.r / prev.r)));
          worst.turn = Math.max(worst.turn, (Math.acos(Math.min(1, dot(cur.f, prev.f))) * 180) / Math.PI);
        }
        prev = cur;
      }
      return { id, focus: a.camera.focusId, offCenter: len(prev!.look) / prev!.r, ...worst };
    };
    return [
      // A new destination picked mid-flight bends onto the new path.
      trip('mars', { 80: () => a.flyTo('saturn') }, 0, 'saturn'),
      // Framed inside the craft's old handoff range: it used to snap to the Sun on landing.
      trip('voyager-1'),
      trip('bh-v404-cyg'),
      trip('moon'),
      // A drag late in the flight hands over without re-aiming, then settles on the focus.
      trip('earth', { 90: () => a.camera.orbit(0, 0, 800, Math.PI / 4) }, 200),
    ];
  });
  for (const t of result) {
    expect(t.pan, JSON.stringify(t)).toBeLessThan(0.06);
    expect(t.zoom, JSON.stringify(t)).toBeLessThan(0.3);
    expect(t.turn, JSON.stringify(t)).toBeLessThan(2.5);
    expect(t.offCenter, JSON.stringify(t)).toBeLessThan(1e-6);
  }
  expect(result.map((t) => t.focus)).toEqual(['saturn', 'voyager-1', 'bh-v404-cyg', 'moon', 'earth']);
});

test('ship mode: fly from the cockpit, autopilot to Mars, and hand back to the orbit camera', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#f=earth&h=2e7&p=1');
  await ready(page);
  type V = [number, number, number];
  interface Ship {
    pose: { position: V; pivot: V; offset: V; r: number };
    focusId: string;
    flying: boolean;
    hold: string | null;
  }
  const state = () =>
    page.evaluate(() => {
      const a = (window as unknown as { app: { shipMode: boolean; ship: Ship; registry: { target(id: string): { pos(): V } } } }).app;
      const e = a.registry.target('earth').pos();
      const p = a.ship.pose;
      return {
        shipMode: a.shipMode,
        focus: a.ship.focusId,
        flying: a.ship.flying,
        hold: a.ship.hold,
        fromEarth: Math.hypot(...p.position.map((x, i) => x - e[i])),
        finite: p.position.every(Number.isFinite) && Number.isFinite(p.r),
      };
    });
  const tick = (n: number) =>
    page.evaluate((n) => {
      const a = (window as unknown as { app: AppHandle }).app;
      for (let i = 0; i < n; i++) a.tick(1 / 30);
    }, n);

  await page.keyboard.press('v');
  await expect(page.locator('.cockpit')).toBeVisible();
  await tick(2);
  const start = await state();
  expect(start.shipMode).toBe(true);

  // Thrust ahead (the ship faces Earth, as the camera did).
  await page.keyboard.down('KeyW');
  await tick(60);
  await page.keyboard.up('KeyW');
  await tick(30);
  const moved = await state();
  expect(moved.finite).toBe(true);
  expect(moved.fromEarth).toBeLessThan(start.fromEarth * 0.9);

  // The palette sends the autopilot.
  await page.keyboard.press('ControlOrMeta+K');
  await page.keyboard.type('mars');
  await expect(page.getByRole('option').first()).toContainText('Mars');
  await page.keyboard.press('Enter');
  await tick(900);
  const there = await state();
  expect(there).toMatchObject({ focus: 'mars', flying: false, hold: 'mars', finite: true });
  await expect(page.locator('.focus')).toHaveText('Mars');

  // Leaving the cockpit hands Mars to the orbit camera.
  await page.keyboard.press('v');
  await expect(page.locator('.cockpit')).toBeHidden();
  await tick(60);
  expect(await page.evaluate(() => (window as unknown as { app: AppHandle }).app.camera.focusId)).toBe('mars');
  expect(errors).toEqual([]);
});

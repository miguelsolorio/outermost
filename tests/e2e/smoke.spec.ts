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
  await page.keyboard.press('Enter');
  const landing = Date.parse('1969-07-20T20:17Z');
  await page.waitForFunction((ms) => Math.abs((window as unknown as { app: AppHandle }).app.clock.ms - ms) < 60_000, landing);
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

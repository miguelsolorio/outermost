// Headless screenshot helper for visual checks during development.
//   node tools/shot.ts <url> <out.png> [js-to-evaluate] [width] [height]
// Waits for the app, star catalog and galaxy model to be ready, optionally
// runs a snippet (e.g. `app.flyTo('saturn'); for (...) app.tick(1/30)`),
// then renders a few frames and saves a PNG.

// Set BROWSER=webkit to check the logarithmic-depth fallback (no EXT_clip_control).
import { chromium, webkit } from '@playwright/test';

const [url, out, js, w = '1280', h = '800'] = process.argv.slice(2);
const browser =
  process.env.BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.error(`[${m.type()}] ${m.text().slice(0, 400)}`);
});
page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => {
  const a = (window as unknown as { app?: { stars?: { catalog: unknown }; galaxy?: { ready: boolean } } }).app;
  return !!a?.stars?.catalog && !!a?.galaxy?.ready;
}, null, { timeout: 90_000 });
if (js) await page.evaluate(`(async () => { ${js} })()`);
// Let textures stream and a few frames render.
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
  return { renderer: dbg ? gl!.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', hash: location.hash };
});
console.log(JSON.stringify(info));
await page.screenshot({ path: out });
await browser.close();

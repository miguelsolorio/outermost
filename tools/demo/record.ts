// Renders the demo video: a minute of Outermost driven the way a person would
// (tools/demo/storyboard.ts), with the app's own ambient soundtrack.
//   npm run demo                                 build, render, write docs/demo.mp4 and its poster
//   node tools/demo/record.ts --draft            1280×720 at 30 fps, to .cache/demo/draft.mp4
//   node tools/demo/record.ts --draft --start 30 simulate the first 30 s, record the rest
//   --headed       watch it render         --url <url>   record a running server (npm run dev)
//   --seed <n>     vary the hand motion and the audio's noise
// Frames are stepped on a fake clock instead of captured live, so motion is
// smooth however slow the machine is, and a seed always plays out the same way.

import { chromium, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { preview } from 'vite';
import { Director, FPS, VIEW } from './director.ts';
import { inject, type DemoHooks } from './inject.ts';
import { OPENING, storyboard } from './storyboard.ts';

const { values: args } = parseArgs({
  options: {
    draft: { type: 'boolean', default: false },
    start: { type: 'string', default: '0' },
    headed: { type: 'boolean', default: false },
    url: { type: 'string' },
    seed: { type: 'string', default: '7' },
    out: { type: 'string', default: 'docs/demo.mp4' },
    poster: { type: 'string', default: 'docs/screenshots/demo.jpg' },
  },
});

const SECONDS = 60;
/** The day the recording claims to be "live". */
const T0 = Date.UTC(2026, 8, 26, 17, 30);
/** App time per video frame. The fake clock fires animation frames every 16 ms, so one step is exactly one frame. */
const STEP_MS = 16;
/** Where performance.now() stands when recording starts, on every run (a multiple of 16 ms and of the app's 100 ms and 1 s throttles). */
const START_TICKS = 600_000;
const FADE = 1.2;
/** Tag frames as BT.709 so players don't guess (and shift the dark scenes). */
const BT709 = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';
const CACHE = '.cache/demo';
const draft = args.draft;
const start = Number(args.start);
const seed = Number(args.seed);
const final = !draft && start === 0;
const every = draft ? 2 : 1;
/**
 * 1280×720 CSS px at 1.5× is 1920×1080, and the renderer caps its pixel ratio
 * at 1.5. The scale is set at launch rather than emulated: a scaled CDP capture
 * drops Playwright's emulation back to 1×, and emulation also rescales wheel deltas.
 */
const DPR = draft ? 1 : 1.5;

type Win = Window & { app: any; __demo: DemoHooks };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function run(cmd: string, argv: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (b) => (err += b));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`${cmd} ${argv.join(' ')}\n${err.slice(-2000)}`))));
  });
}

const stats = { gateWaits: 0, gateCaps: 0, ackMisses: 0 };

/** Wait for asset loads to finish, re-rendering once they land, so nothing pops in a frame late. */
async function settle(page: Page, capMs: number): Promise<void> {
  const pending = () => page.evaluate(() => (window as unknown as Win).__demo.pending);
  for (let round = 0; round < 4; round++) {
    if ((await pending()) === 0) return;
    stats.gateWaits++;
    const t0 = Date.now();
    while ((await pending()) > 0) {
      if (Date.now() - t0 > capMs) {
        stats.gateCaps++;
        console.warn(`\n[demo] still loading after ${capMs} ms; rendering anyway`);
        return;
      }
      await sleep(8);
    }
    await page.evaluate(() => (window as unknown as Win).app.tick(0));
  }
}

async function main(): Promise<void> {
  await run('ffmpeg', ['-hide_banner', '-version']).catch((e) => {
    throw new Error(`demo: ffmpeg (with libx264) is needed on PATH, and it didn't run:\n${e.message}`);
  });
  await mkdir(CACHE, { recursive: true });
  const server = args.url ? null : await preview({ preview: { port: 4183, strictPort: false, open: false }, logLevel: 'warn' });
  const url = args.url ?? server!.resolvedUrls!.local[0];

  const browser = await chromium.launch({
    headless: !args.headed,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', `--force-device-scale-factor=${DPR}`, `--window-size=${VIEW.width},${VIEW.height}`],
  });
  let encoder: ReturnType<typeof spawn> | null = null;
  try {
    const context = await browser.newContext({ viewport: null, locale: 'en-US', timezoneId: 'UTC' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    if (args.headed) {
      // A visible window's frame and toolbar come out of --window-size; grow it so the page is still 1280×720.
      const [dw, dh] = await page.evaluate(() => [outerWidth - innerWidth, outerHeight - innerHeight]);
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: VIEW.width + dw, height: VIEW.height + dh } });
    }
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') console.error(`\n[${m.type()}] ${m.text().slice(0, 400)}`);
    });
    page.on('pageerror', (e) => console.error(`\n[pageerror] ${e.message}`));
    // Ours first, so the clock's fakes are installed on top of it.
    await page.addInitScript(inject);
    await page.clock.install({ time: T0 });
    await page.goto(`${url}#f=${OPENING.focus}`);

    // Loaded: catalogs, both black holes' host galaxies, fonts, and every asset in flight.
    await page.waitForFunction(
      () => {
        const a = (window as unknown as Win).app;
        return !!a?.stars?.catalog && !!a?.galaxy?.ready && !!a.registry.target('bh-m87') && !!a.registry.target('bh-sgr-a-star');
      },
      null,
      { timeout: 120_000 },
    );
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => Promise.all(['400', '500', '600'].map((w) => document.fonts.load(`${w} 13px Inter`)).concat(['400', '500'].map((w) => document.fonts.load(`${w} 13px "JetBrains Mono"`)))));
    const gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      return dbg ? String(gl!.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    if (/swiftshader|llvmpipe/i.test(gpu)) throw new Error(`demo: no GPU (renderer: ${gpu})`);
    const checkScale = async (when: string) => {
      const [w, h, dpr] = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
      if (w !== VIEW.width || h !== VIEW.height || dpr !== DPR) throw new Error(`demo: ${when}, the page is ${w}×${h} at ${dpr}×, not ${VIEW.width}×${VIEW.height} at ${DPR}×`);
    };
    await checkScale('after loading');
    console.log(`[demo] ${url}  gpu: ${gpu}`);

    // Stop the clock. performance.now() has counted up from the page load, which
    // takes a different time on each run, and the app throttles some updates on
    // it, so skip ahead to the same reading every time.
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 1000);
    const ticks = await page.evaluate(() => performance.now());
    if (ticks > START_TICKS) throw new Error(`demo: loading took over ${START_TICKS / 1000} s`);
    await page.clock.fastForward(START_TICKS - ticks);
    const at = await page.evaluate(() => performance.now());
    if (at !== START_TICKS) console.warn(`[demo] the clock stopped at ${at} ms, not ${START_TICKS}`);

    // Visit every stop once, stepping the app by hand, so its textures are cached before the camera gets there.
    process.stdout.write('[demo] warming up');
    for (const id of ['saturn', 'bh-m87', 'bh-sgr-a-star', 'observable-universe', OPENING.focus]) {
      await page.evaluate((id) => {
        const app = (window as unknown as Win).app;
        app.flyTo(id);
        for (let i = 0; i < 260; i++) app.tick(1 / 30);
      }, id);
      await settle(page, 30_000);
      process.stdout.write('.');
    }
    console.log();

    // The opening shot: live at T0.
    await page.clock.setSystemTime(T0);
    await page.evaluate(({ focus, altitude }) => {
      const app = (window as unknown as Win).app;
      app.select(null);
      app.clock.set(Date.now());
      app.clock.setRate(1);
      app.clock.setPaused(false);
      app.camera.set(app.chainFor(focus), altitude, app.defaultDir(focus));
      app.camera.stopInertia();
      (window as unknown as Win).__demo.control();
    }, OPENING);

    const d = new Director(page, seed);
    await page.mouse.move(d.cursor.x, d.cursor.y);
    const delivered = () =>
      page.evaluate(async () => {
        const demo = (window as unknown as Win).__demo;
        await demo.flush();
        return { pointermove: demo.counts.pointermove, wheel: demo.counts.wheel };
      });
    let acked = await delivered();
    Object.assign(d.sent, acked);

    const step = async (capture: boolean) => {
      // The input sent for this frame has reached the page before the app steps.
      const t0 = Date.now();
      while (d.sent.pointermove > acked.pointermove || d.sent.wheel > acked.wheel) {
        acked = await delivered();
        if (Date.now() - t0 > 250) {
          stats.ackMisses++;
          Object.assign(d.sent, acked);
          break;
        }
      }
      await page.clock.runFor(STEP_MS);
      await settle(page, 15_000);
      await page.evaluate(([t, dt, cursor]) => (window as unknown as Win).__demo.frame(t, dt, cursor), [d.t, STEP_MS, d.cursor] as const);
      if (!capture) return;
      const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true });
      if (!encoder!.stdin!.write(Buffer.from(shot.data, 'base64'))) await once(encoder!.stdin!, 'drain');
    };

    // Settle into the opening shot, then start the soundtrack's log afresh.
    for (let i = 0; i < 45; i++) await step(false);
    await page.evaluate(() => ((window as unknown as Win).__demo.track.length = 0));

    const video = `${CACHE}/video.mp4`;
    const shown = SECONDS - start;
    encoder = spawn(
      'ffmpeg',
      [
        ...['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS / every), '-c:v', 'mjpeg', '-i', '-'],
        // Chrome's JPEGs are full-range BT.601; tag and convert to broadcast BT.709 so dark scenes don't shift.
        ...['-vf', `scale=in_color_matrix=bt601:in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p,${BT709},fade=t=out:st=${shown - FADE}:d=${FADE}`],
        ...['-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'slow', '-crf', draft ? '20' : '14', '-x264-params', 'aq-mode=3'],
        ...['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', video],
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    const encoded = once(encoder, 'close');

    const total = SECONDS * FPS;
    const first = Math.round(start * FPS);
    const story = storyboard(d);
    let rest: AsyncGenerator<void, void, void> | null = null;
    const began = Date.now();
    while (d.frame < total) {
      if (!rest && (await story.next()).done) {
        console.log(`\n[demo] storyboard finished at ${(d.t / 1000).toFixed(2)} s; holding to ${SECONDS} s`);
        rest = d.hold(SECONDS);
      }
      if (rest) await rest.next();
      await step(d.frame >= first && d.frame % every === 0);
      d.frame++;
      if (d.frame % 30 === 0) {
        const el = (Date.now() - began) / 1000;
        process.stdout.write(`\r[demo] ${(d.t / 1000).toFixed(1)} s / ${SECONDS} s  (${(d.frame / el).toFixed(1)} frames/s, ${stats.ackMisses} input misses, ${stats.gateWaits} load waits)   `);
      }
    }
    if (!rest) console.warn(`\n[demo] the storyboard runs past ${SECONDS} s; cut there`);
    await checkScale('after recording');
    encoder.stdin!.end();
    const [code] = await encoded;
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);

    // The soundtrack: the same Web Audio graph, rendered offline along the camera's path.
    console.log('\n[demo] rendering audio');
    const wav = await page.evaluate(
      async ({ seconds, seed }) => {
        const w = window as unknown as Win;
        const buf: AudioBuffer = await w.app.audio.renderOffline(w.__demo.track, seconds, { seed });
        const n = buf.length;
        const ch = buf.numberOfChannels;
        const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
        const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
        str(0, 'RIFF');
        data.setUint32(4, 36 + n * ch * 2, true);
        str(8, 'WAVEfmt ');
        data.setUint32(16, 16, true);
        data.setUint16(20, 1, true);
        data.setUint16(22, ch, true);
        data.setUint32(24, buf.sampleRate, true);
        data.setUint32(28, buf.sampleRate * ch * 2, true);
        data.setUint16(32, ch * 2, true);
        data.setUint16(34, 16, true);
        str(36, 'data');
        data.setUint32(40, n * ch * 2, true);
        const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
        for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) data.setInt16(o, Math.max(-1, Math.min(1, chans[c][i])) * 32767, true);
        const bytes = new Uint8Array(data.buffer);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
      },
      { seconds: SECONDS, seed },
    );
    const audio = `${CACHE}/audio.wav`;
    await writeFile(audio, Buffer.from(wav, 'base64'));

    // Two-pass loudness: measure, then normalize linearly so the slow drone doesn't pump.
    // A slow drone has a wide loudness range; allow it so the gain stays linear.
    const LOUD = 'I=-18:TP=-1.5:LRA=20';
    const trim = start ? ['-ss', String(start)] : [];
    const measured = JSON.parse(/\{[^{}]*"input_i"[^{}]*\}/.exec(await run('ffmpeg', ['-hide_banner', '-nostats', ...trim, '-i', audio, '-af', `loudnorm=${LOUD}:print_format=json`, '-f', 'null', '-']))![0]);
    const norm = `loudnorm=${LOUD}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
    const master = draft ? `${CACHE}/draft.mp4` : `${CACHE}/outermost-demo-master.mp4`;
    await run('ffmpeg', [
      ...['-hide_banner', '-y', '-i', video, ...trim, '-i', audio],
      ...['-af', `${norm},afade=t=in:d=0.3,afade=t=out:st=${shown - FADE}:d=${FADE},aresample=48000`],
      ...['-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', master],
    ]);
    console.log(`[demo] wrote ${master}`);

    if (final) {
      // The committed copy: two-pass at about 4 Mbit/s, comfortably under GitHub's 50 MB warning.
      const x264 = ['-c:v', 'libx264', '-preset', 'slow', '-b:v', '4M', '-maxrate', '8M', '-bufsize', '16M', '-x264-params', 'aq-mode=3', '-passlogfile', `${CACHE}/x264`];
      const tags = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
      await run('ffmpeg', ['-hide_banner', '-y', '-i', master, ...x264, '-pass', '1', '-an', '-f', 'mp4', '/dev/null']);
      await run('ffmpeg', ['-hide_banner', '-y', '-i', master, ...x264, '-pass', '2', '-vf', BT709, ...tags, '-c:a', 'copy', '-movflags', '+faststart', args.out]);
      console.log(`[demo] wrote ${args.out}`);
      if (d.marks.poster !== undefined) {
        await run('ffmpeg', ['-hide_banner', '-y', '-ss', String(d.marks.poster), '-i', master, '-frames:v', '1', '-vf', 'scale=1600:-2', '-q:v', '3', args.poster]);
        console.log(`[demo] wrote ${args.poster}`);
      }
      await rm(`${CACHE}/x264-0.log`, { force: true });
      await rm(`${CACHE}/x264-0.log.mbtree`, { force: true });
    }
    console.log(`[demo] ${JSON.stringify({ marks: d.marks, ...stats, minutes: +((Date.now() - began) / 60000).toFixed(1) })}`);
  } finally {
    if (encoder && encoder.exitCode === null) encoder.kill('SIGKILL');
    await browser.close();
    await server?.close();
  }
}

await main();

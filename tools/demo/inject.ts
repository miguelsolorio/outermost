// The in-page half of the demo recorder, installed with page.addInitScript
// before the app loads. It puts everything that would otherwise run on the
// wall clock under the recorder's control, one video frame at a time:
//   - WAAPI and CSS animations (Svelte transitions, hover fades) are paused at
//     birth and advanced by the frame step, since the fake clock can't reach them
//   - asset loads are counted, so a frame waits for its textures instead of
//     showing them pop in a few frames late
//   - input events are counted, so each lands before its frame renders
//   - a drawn cursor (headless capture has none) follows the real pointer
//   - SVG (SMIL) animations, like the location marker's pulse, follow the frame step
//   - the intro's title card and the fades to and from black are drawn over the page
// Everything here must be self-contained: Playwright serializes the function.

export interface CursorState {
  x: number;
  y: number;
  down: boolean;
  /** Hidden while typing, like macOS, until the pointer moves again. */
  hidden: boolean;
  /** Video time (ms) of the last press, for the click ripple. */
  pressedAt: number;
}

export interface DemoHooks {
  pending: number;
  counts: Record<'pointermove' | 'pointerdown' | 'pointerup' | 'wheel' | 'keydown', number>;
  /** Take over the page's animations (after loading, before the first frame). */
  control(): void;
  /** After the app has stepped one frame: advance animations, draw the cursor, log the audio sample. */
  frame(t: number, dt: number, cursor: CursorState): void;
  /** Where the pointer can safely press or scroll the scene near (x, y): not on a label or the HUD. */
  clearPoint(x: number, y: number): [number, number];
  /** Resolve after a real rendering frame, when Chrome delivers queued pointer and wheel events. */
  flush(): Promise<void>;
  /** Black over everything, cursor included: 0 clear to 1 black. */
  cover(opacity: number): void;
  /** The intro: how far the name and the tagline have come in (0 to 1), and how much of the app's HUD shows. */
  titleCard(title: number, tagline: number, hud: number): void;
  track: { t: number; viewScale: number; fromSun: number }[];
}

export function inject(): void {
  if (window.top !== window) return;
  try {
    localStorage.setItem('hints-seen-v1', '1');
    localStorage.removeItem('ambient-muted');
  } catch {
    // about:blank has no storage
  }

  const counts = { pointermove: 0, pointerdown: 0, pointerup: 0, wheel: 0, keydown: 0 };
  for (const type of Object.keys(counts) as (keyof typeof counts)[]) {
    window.addEventListener(type, () => counts[type]++, { capture: true, passive: true });
  }

  const hooks = {
    pending: 0,
    counts,
    track: [] as DemoHooks['track'],
  } as DemoHooks;
  (window as unknown as { __demo: DemoHooks }).__demo = hooks;
  // Chrome holds pointer moves and wheel events for the next rendering frame,
  // and with the page's rAF faked nothing asks for one. The real rAF (taken
  // before the clock is installed) does, and the events arrive ahead of it.
  const nativeRaf = window.requestAnimationFrame.bind(window);
  hooks.flush = () => new Promise((resolve) => nativeRaf(() => resolve()));

  // ---- loads ------------------------------------------------------------------

  const counted = <T,>(p: T): T => {
    if (p && typeof (p as { then?: unknown }).then === 'function') {
      hooks.pending++;
      const done = () => hooks.pending--;
      (p as unknown as Promise<unknown>).then(done, done);
    }
    return p;
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (...args: Parameters<typeof fetch>) => counted(nativeFetch(...args));

  // main.ts publishes the app right after init() starts; count its asset
  // loads, which include the KTX2 transcode that runs after the fetch.
  let app: { assets: Record<string, unknown>; audio: { update(a: number, b: number): void } } | undefined;
  let audioArgs: [number, number] | null = null;
  Object.defineProperty(window, 'app', {
    configurable: true,
    get: () => app,
    set: (v) => {
      app = v;
      const assets = v.assets as Record<string, (...a: unknown[]) => unknown>;
      for (const k of ['texture', 'compressed', 'json', 'binary']) {
        const f = assets[k].bind(assets);
        assets[k] = (...a: unknown[]) => counted(f(...a));
      }
      const au = v.audio;
      const update = au.update.bind(au);
      au.update = (viewScale: number, fromSun: number) => {
        audioArgs = [viewScale, fromSun];
        update(viewScale, fromSun);
      };
    },
  });

  // ---- animations ---------------------------------------------------------------

  let controlling = false;
  let frameNo = 0;
  const born = new WeakMap<Animation, number>();
  const live = new Set<Animation>();
  const adopt = (a: Animation, keepTime = false) => {
    if (born.has(a)) return;
    born.set(a, frameNo);
    live.add(a);
    try {
      a.pause();
      if (!keepTime) a.currentTime = 0;
    } catch {
      // already cancelled
    }
  };
  const nativeAnimate = Element.prototype.animate;
  Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
    const a = nativeAnimate.apply(this, args);
    if (controlling) adopt(a);
    return a;
  };
  hooks.control = () => {
    controlling = true;
    for (const a of document.getAnimations()) adopt(a, true);
  };

  const num = (v: CSSNumberish | null | undefined) => Number(v ?? 0);
  const stepAnimations = (dt: number) => {
    for (const a of live) {
      if (a.playState === 'idle' || a.playState === 'finished') live.delete(a);
      else if (born.get(a)! < frameNo) a.currentTime = num(a.currentTime) + dt;
    }
    // Finishing one can start the next (Svelte runs a zero-length placeholder
    // first), so settle in a few passes; newborns start at 0 and show that frame.
    for (let pass = 0; pass < 4; pass++) {
      for (const a of document.getAnimations()) adopt(a);
      let fired = false;
      for (const a of live) {
        const end = num(a.effect?.getComputedTiming().endTime);
        if (!Number.isFinite(end) || num(a.currentTime) < end) continue;
        live.delete(a);
        // Call the handler now rather than on Chrome's next real frame.
        const onfinish = a.onfinish;
        a.onfinish = null;
        a.finish();
        if (onfinish) {
          onfinish.call(a, new AnimationPlaybackEvent('finish'));
          fired = true;
        }
      }
      if (!fired) break;
    }
    frameNo++;
  };

  // ---- cursor -------------------------------------------------------------------

  // 24-unit glyphs drawn at 26 px. Hands are the same shapes twice: a black
  // stroked pass for the outline (which also draws the finger gaps), then white.
  const hand = (shapes: string) =>
    `<g fill="#000" stroke="#000" stroke-width="2.2" stroke-linejoin="round">${shapes}</g><g fill="#fff">${shapes}</g>`;
  const r = (x: number, y: number, w: number, h: number, rx = 1.3, rot = '') =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"${rot ? ` transform="rotate(${rot})"` : ''}/>`;
  const GLYPHS: Record<string, { svg: string; hx: number; hy: number }> = {
    default: {
      svg: '<path d="M5.5 3.2v16.1l3.9-3.7 2.6 5.9 2.7-1.2-2.6-5.8h5.4z" fill="#000" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>',
      hx: 5.5,
      hy: 3.2,
    },
    pointer: {
      svg: hand(r(8.3, 2.4, 2.6, 11) + r(11, 7.2, 2.6, 7) + r(13.7, 8, 2.6, 6.5) + r(16.4, 9.2, 2.4, 5.5, 1.2) + r(8.3, 11.5, 10.5, 9, 3.6) + r(4.3, 11.3, 2.6, 6.5, 1.3, '-38 5.6 14.5')),
      hx: 9.6,
      hy: 2.6,
    },
    grab: {
      svg: hand(r(7.4, 5, 2.6, 9) + r(10.1, 3.6, 2.6, 10) + r(12.8, 4.2, 2.6, 9.6) + r(15.5, 6.2, 2.6, 8) + r(7.4, 10.5, 10.7, 9, 3.8) + r(3.6, 10.8, 2.6, 6.2, 1.3, '-42 4.9 13.9')),
      hx: 12,
      hy: 11,
    },
    grabbing: {
      svg: hand(r(7.6, 8.2, 2.6, 5) + r(10.3, 7.6, 2.6, 5.5) + r(13, 7.8, 2.6, 5.3) + r(15.7, 8.6, 2.6, 4.6) + r(7.4, 10, 10.9, 9.5, 3.8) + r(5, 11.6, 2.6, 5, 1.3, '-30 6.3 14.1')),
      hx: 12,
      hy: 12,
    },
    'ew-resize': {
      svg: '<path d="M2.5 12 7.8 7.2v3.3h8.4V7.2l5.3 4.8-5.3 4.8v-3.3H7.8v3.3z" fill="#000" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>',
      hx: 12,
      hy: 12,
    },
    text: {
      svg: ['#fff" stroke-width="3.2', '#000" stroke-width="1.4']
        .map((s) => `<path d="M8.5 4.5h1.8c.8 0 1.3.3 1.7.9.4-.6.9-.9 1.7-.9h1.8M12 5.4v13.2M8.5 19.5h1.8c.8 0 1.3-.3 1.7-.9.4.6.9.9 1.7.9h1.8" fill="none" stroke="${s}" stroke-linecap="round"/>`)
        .join(''),
      hx: 12,
      hy: 12,
    },
  };
  const SIZE = 26;
  const K = SIZE / 24;

  let cursorEl: HTMLDivElement | null = null;
  let rippleEl: HTMLDivElement | null = null;
  let shown = '';
  let pressedEl: Element | null = null;
  let wasDown = false;
  let alpha = 1;
  const build = () => {
    const base = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483646;transition:none;will-change:transform,opacity;';
    rippleEl = document.createElement('div');
    rippleEl.style.cssText = `${base}width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2px solid rgb(255 255 255 / 0.85);background:rgb(255 255 255 / 0.14);opacity:0;`;
    cursorEl = document.createElement('div');
    cursorEl.style.cssText = `${base}width:${SIZE}px;height:${SIZE}px;filter:drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.5));`;
    document.documentElement.append(rippleEl, cursorEl);
  };
  const kindAt = (el: Element | null): string => {
    if (!el) return 'default';
    const c = getComputedStyle(el).cursor;
    if (c in GLYPHS) return c;
    if (c === 'auto' && el.matches('input:not([type=button]):not([type=checkbox]), textarea, [contenteditable]')) return 'text';
    return 'default';
  };
  const drawCursor = (t: number, c: CursorState) => {
    if (!cursorEl) build();
    if (c.down && !wasDown) pressedEl = document.elementFromPoint(c.x, c.y);
    if (!c.down) pressedEl = null;
    wasDown = c.down;
    // While pressed the glyph stays with what was pressed (pointer capture keeps
    // a drag going over labels), and the scene's open hand closes.
    let kind = kindAt(pressedEl ?? document.elementFromPoint(c.x, c.y));
    if (c.down && kind === 'grab') kind = 'grabbing';
    if (kind !== shown) {
      shown = kind;
      cursorEl!.innerHTML = `<svg viewBox="0 0 24 24" width="${SIZE}" height="${SIZE}">${GLYPHS[kind].svg}</svg>`;
    }
    const g = GLYPHS[kind];
    alpha = c.hidden ? Math.max(0, alpha - 0.25) : Math.min(1, alpha + 0.34);
    const s = c.down ? 0.92 : 1;
    cursorEl!.style.opacity = String(alpha);
    cursorEl!.style.transformOrigin = `${g.hx * K}px ${g.hy * K}px`;
    cursorEl!.style.transform = `translate(${c.x - g.hx * K}px, ${c.y - g.hy * K}px) scale(${s})`;
    const age = t - c.pressedAt;
    if (age >= 0 && age < 420) {
      const k = age / 420;
      const e = 1 - Math.pow(1 - k, 3);
      rippleEl!.style.opacity = String(0.9 * (1 - k));
      rippleEl!.style.transform = `translate(${c.x}px, ${c.y}px) scale(${0.25 + 0.75 * e})`;
    } else rippleEl!.style.opacity = '0';
  };

  hooks.clearPoint = (x, y) => {
    const scene = document.getElementById('scene');
    const clear = (px: number, py: number) => {
      const el = document.elementFromPoint(px, py);
      if (el !== scene) return false;
      // Keep a margin from labels, which drift.
      for (const [dx, dy] of [[14, 0], [-14, 0], [0, 14], [0, -14]]) if (document.elementFromPoint(px + dx, py + dy) !== scene) return false;
      return true;
    };
    if (clear(x, y)) return [x, y];
    for (let rad = 16; rad <= 160; rad += 16) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const px = x + Math.cos(a) * rad;
        const py = y + Math.sin(a) * rad;
        if (clear(px, py)) return [px, py];
      }
    }
    return [x, y];
  };

  // ---- title card and fades ----------------------------------------------------------

  let coverEl: HTMLDivElement | null = null;
  hooks.cover = (opacity) => {
    if (!coverEl) {
      coverEl = document.createElement('div');
      coverEl.style.cssText = 'position:fixed;inset:0;background:#000;pointer-events:none;z-index:2147483647;transition:none;';
      document.documentElement.append(coverEl);
    }
    coverEl.style.opacity = String(opacity);
  };

  // Set like the social preview image (public/og.png): the name large over the planet's night side, a quiet line under it.
  let nameEl: HTMLDivElement | null = null;
  let taglineEl: HTMLDivElement | null = null;
  hooks.titleCard = (title, tagline, hud) => {
    if (!nameEl) {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:8.5vw;top:56vh;pointer-events:none;z-index:2147483645;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;text-shadow:0 2px 24px rgb(0 0 0 / 0.6);';
      nameEl = document.createElement('div');
      nameEl.textContent = 'Outermost';
      nameEl.style.cssText = 'font-size:104px;font-weight:600;letter-spacing:-0.025em;line-height:1;color:#f3f5f9;';
      taglineEl = document.createElement('div');
      taglineEl.textContent = 'Explore the observable universe to scale.';
      taglineEl.style.cssText = 'margin-top:26px;font-size:26px;font-weight:400;color:rgb(196 204 220 / 0.88);';
      box.append(nameEl, taglineEl);
      document.documentElement.append(box);
    }
    for (const [el, k] of [[nameEl, title], [taglineEl!, tagline]] as const) {
      el.style.opacity = String(k);
      el.style.transform = `translateY(${((1 - k) * 16).toFixed(2)}px)`;
    }
    for (const id of ['ui', 'labels']) {
      const el = document.getElementById(id);
      if (el) el.style.opacity = hud >= 1 ? '' : String(hud);
    }
  };

  hooks.frame = (t, dt, cursor) => {
    stepAnimations(dt);
    for (const svg of document.querySelectorAll<SVGSVGElement>('svg')) {
      if (!svg.querySelector('animate')) continue;
      svg.pauseAnimations();
      svg.setCurrentTime(t / 1000);
    }
    drawCursor(t, cursor);
    if (audioArgs) hooks.track.push({ t: t / 1000, viewScale: audioArgs[0], fromSun: audioArgs[1] });
  };

  // A steady caret: its blink runs on the wall clock and would flicker between frames.
  const caret = () => {
    const style = document.createElement('style');
    style.textContent = CSS.supports('caret-animation', 'manual') ? 'input, textarea { caret-animation: manual; }' : 'input, textarea { caret-color: transparent !important; }';
    document.head.append(style);
  };
  if (document.head) caret();
  else document.addEventListener('DOMContentLoaded', caret, { once: true });
}

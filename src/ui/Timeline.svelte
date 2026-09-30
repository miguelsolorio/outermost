<script lang="ts">
  import { onMount } from 'svelte';
  import { actions, nav, ui } from './state.svelte.ts';
  import { formatRate } from '../engine/format.ts';
  import { DAY_MS, MAX_MS, MIN_MS } from '../astro/time.ts';
  import { KIND_LABEL, nearestLandmark, type Landmark } from '../data/landmarks.ts';
  import DatePicker from './DatePicker.svelte';
  import { Scrubber } from './timeline/scrub.ts';
  import { TimelineView } from './timeline/view.ts';
  import { RATES } from './timeRates.ts';

  const PICKER_W = 272;

  const scrub = new Scrubber({
    read: () => actions.readClock(),
    setTime: (ms) => actions.setTime(ms),
    setPaused: (p) => actions.setPaused(p),
  });

  let track: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let stamp: HTMLDivElement;
  let whenBtn: HTMLButtonElement;
  let speedMenu: HTMLElement;
  let picker = $state<HTMLElement>();
  let view: TimelineView | undefined;

  // Refreshed from the clock every frame; assigning an unchanged value doesn't re-render.
  // Landmarks are held raw so they stay the same objects the view compares against.
  let ms = $state(Date.now());
  let rate = $state(1);
  let paused = $state(false);
  /** The landmark the playhead is on. */
  let here = $state.raw<Landmark | null>(null);
  let tipFor = $state.raw<Landmark | null>(null);
  let tipX = $state(0);
  let zoomLabel = $state('');
  let canZoomIn = $state(true);
  let canZoomOut = $state(true);
  let zoomPos = $state(0);
  /** Pointer x while dragging the zoom label, which zooms like a pinch. */
  let zoomDragX: number | null = null;

  const zoomDown = (e: PointerEvent) => {
    zoomDragX = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  // Dragging right widens the span shown, as scrubbing a number up would: ×2.7 per 50 px.
  const zoomMove = (e: PointerEvent) => {
    if (zoomDragX === null) return;
    view?.zoomBy(Math.exp((e.clientX - zoomDragX) / 50));
    zoomDragX = e.clientX;
  };
  const zoomUp = () => (zoomDragX = null);
  const zoomKey = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? 1 : 0;
    if (!dir) return;
    view?.zoomStep(dir);
    e.preventDefault();
    e.stopPropagation();
  };

  // Dragging the speed button sideways steps through the presets, one per 24 px; a press
  // that barely moves is still a click and opens the menu.
  const SPEED_STEP_PX = 24;
  let speedDrag: { x: number; i: number; moved: boolean } | null = null;
  let speedDragged = false;
  const rateIndex = (r: number) => {
    let best = 0;
    for (let i = 1; i < RATES.length; i++) if (Math.abs(Math.log(RATES[i] / r)) < Math.abs(Math.log(RATES[best] / r))) best = i;
    return best;
  };
  const setRateIndex = (i: number) => {
    const next = RATES[Math.max(0, Math.min(RATES.length - 1, i))];
    if (next !== Math.abs(rate)) actions.setSpeed((rate < 0 ? -1 : 1) * next);
  };
  const speedDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    speedDrag = { x: e.clientX, i: rateIndex(Math.abs(rate)), moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const speedMove = (e: PointerEvent) => {
    if (!speedDrag) return;
    const dx = e.clientX - speedDrag.x;
    if (!speedDrag.moved && Math.abs(dx) < 4) return;
    speedDrag.moved = true;
    speedOpen = dateOpen = false;
    setRateIndex(speedDrag.i + Math.trunc(dx / SPEED_STEP_PX));
  };
  const speedUp = () => {
    speedDragged = !!speedDrag?.moved;
    speedDrag = null;
  };
  const speedClick = () => {
    if (speedDragged) return void (speedDragged = false);
    speedOpen = !speedOpen;
    dateOpen = false;
  };
  const speedKey = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir || speedOpen) return;
    setRateIndex(rateIndex(Math.abs(rate)) + dir);
    e.preventDefault();
    e.stopPropagation();
  };

  let leftW = $state(0);
  let rightW = $state(0);
  let railW = $state(0);
  let stampW = $state(0);
  let tipW = $state(0);
  let stampLeft = 0;

  let speedOpen = $state(false);
  let dateOpen = $state(false);
  let pickerX = $state(0);

  const fmtDate = (t: number) => new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  // "May 22 – Nov 1, 1989", or "Aug 3, 1975 – Mar 15, 1976" across years.
  const fmtRange = (a: number, b: number) =>
    new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).formatRange(a, b);
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const rateLabel = (r: number) => capitalize(formatRate(Math.abs(r)));

  const dateText = $derived(fmtDate(ms));
  const timeText = $derived(new Date(ms).toISOString().slice(11, 19) + ' UTC');
  // At an hour a second the seconds are a blur, and at a month a second so is the time of day.
  const shownTime = $derived(
    Math.abs(rate) >= RATES[5] ? '' : Math.abs(rate) >= RATES[2] ? timeText.slice(0, 5) + ' UTC' : timeText,
  );
  // At a year a second the month and day are a blur too: just the year.
  const shownDate = $derived(Math.abs(rate) >= RATES[6] ? String(new Date(ms).getUTCFullYear()) : dateText);
  const live = $derived(!paused && rate === 1 && Math.abs(ms - Date.now()) < 5000);
  const backward = $derived(rate < 0);
  const valueText = $derived(`${dateText} ${timeText}${here ? `, ${here.name}` : ''}`);
  const shortRate = $derived(`${rate < 0 ? '−' : ''}${Math.abs(rate) === 1 ? '1×' : formatRate(Math.abs(rate))}`);
  const tipText = $derived.by(() => {
    if (!tipFor) return '';
    const kind = tipFor.ms > Date.now() ? 'Predicted' : KIND_LABEL[tipFor.kind];
    const target = ui.searchIndex.find((e) => e.id === tipFor!.target)?.name ?? tipFor.target;
    const when = tipFor.until ? fmtRange(tipFor.ms, tipFor.until) : fmtDate(tipFor.ms);
    return `${kind} · ${when} · ${target}`;
  });

  /** A landmark visit waiting for the camera to climb before the clock moves. */
  let pending: { lm: Landmark; stay: boolean } | null = null;

  /**
   * Clicking a landmark sets the camera rising and moves time once it's far
   * enough out that the planet in view isn't seen spinning, while it's still
   * rising. When the clock lands, the flight to the landmark's object (which may
   * only exist at that date) takes over mid-rise, so it's one motion. A landmark
   * on the body already in view skips the rise: the clock moves in place and
   * the camera turns to the landmark's side at the same distance.
   */
  function visit(lm: Landmark) {
    scrub.cancelTween();
    ui.visiting = true;
    // In the cockpit, stow the timeline again to watch the visit out of the window.
    ui.timeOpen = false;
    pending = { lm, stay: actions.pullBack(lm.target) };
  }

  function jumpWhenHigh() {
    // Scrubbing by hand in the meantime overrides the visit's jump.
    if (pending && scrub.active) {
      pending = null;
      ui.visiting = false;
    }
    if (!pending || !actions.flightHigh()) return;
    const { lm, stay } = pending;
    pending = null;
    scrub.animateTo(lm.ms, 650, () => {
      ui.visiting = false;
      actions.flyTo(lm.target, { from: lm.from, stay });
    });
  }

  function goLive() {
    pending = null;
    ui.visiting = false;
    scrub.reset();
    actions.now();
  }

  function toggleDate() {
    dateOpen = !dateOpen;
    speedOpen = false;
    // The picker opens above the date and stays put while the date moves.
    if (dateOpen) pickerX = Math.max(0, Math.min(railW - PICKER_W, stampLeft + stampW / 2 - PICKER_W / 2));
  }

  onMount(() => {
    nav.visit = visit;
    nav.togglePlay = () => scrub.togglePlay();
    const v = new TimelineView(track, canvas, { scrub, visit });
    view = v;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      jumpWhenHigh();
      scrub.step(now);
      const c = actions.readClock();
      v.frame(dt, c);
      ms = c.ms;
      rate = c.rate;
      paused = scrub.shownPaused(c.paused);
      here = nearestLandmark(c.ms, DAY_MS);
      // The date line already names the landmark the playhead is on, so a tooltip would only cover
      // it: none while scrubbing or flying to a landmark, and none for the one we're at.
      tipFor = v.hover && !scrub.active && v.hover !== here ? v.hover : null;
      if (tipFor) tipX = Math.max(tipW / 2, Math.min(v.width - tipW / 2, v.xOf(tipFor.ms)));
      zoomLabel = v.zoomLabel;
      canZoomIn = v.canZoomIn;
      canZoomOut = v.canZoomOut;
      zoomPos = Math.round(v.zoomFraction * 100);
      // The date rides the playhead, kept clear of the corner controls.
      let lo = leftW + 12 + stampW / 2;
      let hi = v.width - rightW - 12 - stampW / 2;
      if (lo > hi) lo = hi = (lo + hi) / 2;
      stampLeft = Math.max(lo, Math.min(hi, v.playheadX)) - stampW / 2;
      stamp.style.transform = `translateX(${stampLeft}px)`;
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      v.destroy();
    };
  });
</script>

<svelte:window
  onpointerdown={(e) => {
    const t = e.target as Node;
    if (speedOpen && !speedMenu?.contains(t)) speedOpen = false;
    if (dateOpen && !picker?.contains(t) && !whenBtn?.contains(t)) dateOpen = false;
  }}
  onkeydown={(e) => {
    if (e.key !== 'Escape') return;
    // In the cockpit, Escape with no menu open stows the timeline back under the console.
    if (!speedOpen && !dateOpen && ui.timeOpen) ui.timeOpen = false;
    speedOpen = dateOpen = false;
  }}
/>

<!-- In the cockpit the timeline is stowed (the console has the clock) until TIME raises it over the console.
     It stays mounted: landmark visits from search run through it. -->
<div class="scrim" class:away={ui.shipMode} aria-hidden="true"></div>

<div
  class="dock"
  class:stowed={ui.shipMode && !ui.timeOpen}
  class:raised={ui.shipMode && ui.timeOpen}
  inert={ui.shipMode && !ui.timeOpen}
  role="group"
  aria-label="Time controls"
>
  <div class="corners">
    <div class="grp" bind:offsetWidth={leftW}>
      <button class="btn play" onclick={() => scrub.togglePlay()} title={paused ? 'Play (Space)' : 'Pause (Space)'} aria-label={paused ? 'Play' : 'Pause'}>
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          {#if paused}
            <path d="M4.5 2.5v11l9-5.5z" fill="currentColor" />
          {:else}
            <rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
            <rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
          {/if}
        </svg>
      </button>

      <div class="speed" bind:this={speedMenu}>
        <button
          class="btn speed-btn"
          class:open={speedOpen}
          onclick={speedClick}
          onpointerdown={speedDown}
          onpointermove={speedMove}
          onpointerup={speedUp}
          onpointercancel={speedUp}
          onkeydown={speedKey}
          aria-haspopup="true"
          aria-expanded={speedOpen}
          title="Choose how fast time runs, or drag sideways to change it"
        >
          <span>{shortRate}</span>
          <svg class="chev" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        {#if speedOpen}
          <!-- Speed and direction only: whether time runs stays with Play. -->
          <div class="menu" role="menu" aria-label="Time speed">
            <div class="segmented" role="group" aria-label="Direction">
              <button role="menuitemradio" aria-checked={backward} class:on={backward} onclick={() => actions.setSpeed(-Math.abs(rate))}>
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M7.5 3.5v9L1.5 8zM14.5 3.5v9L8.5 8z" fill="currentColor" /></svg>
                Backward
              </button>
              <button role="menuitemradio" aria-checked={!backward} class:on={!backward} onclick={() => actions.setSpeed(Math.abs(rate))}>
                Forward
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M1.5 3.5v9l6-4.5zM8.5 3.5v9l6-4.5z" fill="currentColor" /></svg>
              </button>
            </div>
            <div class="heading">Speed</div>
            {#each RATES as r (r)}
              {@const current = Math.abs(Math.abs(rate) - r) < 1e-9}
              <button class="option" role="menuitemradio" aria-checked={current} class:on={current} onclick={() => ((speedOpen = false), actions.setSpeed((backward ? -1 : 1) * r))}>
                <span>{rateLabel(r)}</span>
                {#if current}
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="grp" bind:offsetWidth={rightW}>
      <div class="zoom" role="group" aria-label="Zoom">
        <button class="btn zb" onclick={() => view?.zoomStep(-1)} disabled={!canZoomOut} title="Zoom out (−) · showing {zoomLabel}" aria-label="Zoom out">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        </button>
        <span
          class="zl"
          role="slider"
          tabindex="0"
          aria-label="Time span shown"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={zoomPos}
          aria-valuetext={zoomLabel}
          title="Drag sideways to zoom"
          onpointerdown={zoomDown}
          onpointermove={zoomMove}
          onpointerup={zoomUp}
          onpointercancel={zoomUp}
          onkeydown={zoomKey}>{zoomLabel}</span
        >
        <button class="btn zb" onclick={() => view?.zoomStep(1)} disabled={!canZoomIn} title="Zoom in (+) · showing {zoomLabel}" aria-label="Zoom in">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        </button>
      </div>
      <button class="btn live" class:on={live} onclick={goLive} disabled={live} title={live ? 'Showing the current time' : 'Jump to now, in real time'}>
        <span class="dot" aria-hidden="true"></span>
        Live
      </button>
    </div>
  </div>

  <div class="rail" bind:clientWidth={railW}>
    <div
      class="track"
      bind:this={track}
      role="slider"
      tabindex="0"
      aria-label="Timeline. Drag to move through time, pinch or scroll to zoom, click a landmark to go there"
      aria-valuemin={MIN_MS}
      aria-valuemax={MAX_MS}
      aria-valuenow={Math.round(ms)}
      aria-valuetext={valueText}
      onkeydown={(e) => {
        // In the scene, arrows and +/- move the camera from a window listener; keep them here.
        if (view?.onKey(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <canvas bind:this={canvas}></canvas>
    </div>

    <div class="stamp" bind:this={stamp} bind:offsetWidth={stampW}>
      <div class="lm">{here?.name ?? ''}</div>
      <button class="when" bind:this={whenBtn} onclick={toggleDate} aria-haspopup="dialog" aria-expanded={dateOpen} title="Pick a date and time (UTC)">
        <span class="d">{shownDate}</span>{#if shownTime}<span class="t">{shownTime}</span>{/if}
      </button>
    </div>

    {#if tipFor}
      <div class="tip" bind:offsetWidth={tipW} style:left="{tipX}px">
        <b>{tipFor.name}</b>
        <span>{tipText}</span>
      </div>
    {/if}

    {#if dateOpen}
      <div class="picker-anchor" bind:this={picker} style:left="{pickerX}px">
        <DatePicker {ms} onpick={(t) => actions.setTime(t)} onnow={() => ((dateOpen = false), goLive())} onclose={() => (dateOpen = false)} />
      </div>
    {/if}
  </div>
</div>

<style>
  /* No panel: a soft fade keeps the controls readable over the scene. */
  .scrim {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: 170px;
    background: linear-gradient(to top, rgb(2 4 9 / 0.72), rgb(2 4 9 / 0.38) 45%, transparent);
  }
  .dock {
    position: fixed;
    left: 50%;
    bottom: 26px;
    transform: translateX(-50%);
    width: min(1200px, calc(100% - 48px));
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-variant-numeric: tabular-nums;
    /* The speed menu opens over the search list on short screens. */
    z-index: 3;
  }
  /* Only the controls and the timeline take the pointer; the gaps pass through to the scene. */
  :global(#ui) > .scrim,
  :global(#ui) > .dock {
    pointer-events: none;
  }
  .grp,
  .track,
  .when,
  .picker-anchor {
    pointer-events: auto;
  }

  button {
    font: inherit;
    color: var(--text);
    cursor: pointer;
  }
  button:focus-visible,
  .track:focus-visible {
    outline: 2px solid var(--accent-dim);
    outline-offset: 2px;
    border-radius: 8px;
  }

  .corners {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .grp {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 32px;
    min-width: 32px;
    padding: 0 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    font-size: 12.5px;
    text-shadow: 0 1px 8px rgb(0 0 0 / 0.85);
    transition:
      background 0.12s,
      color 0.12s;
  }
  .btn:hover:not(:disabled) {
    background: rgb(255 255 255 / 0.08);
  }
  .btn:disabled {
    cursor: default;
  }
  .play {
    width: 34px;
    height: 34px;
    padding: 0;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.1);
  }
  .play:hover:not(:disabled) {
    background: rgb(255 255 255 / 0.17);
  }

  .speed {
    position: relative;
  }
  .speed-btn {
    gap: 4px;
    padding: 0 6px 0 8px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
    cursor: ew-resize;
    touch-action: none;
    user-select: none;
  }
  .speed-btn:hover,
  .speed-btn.open {
    color: var(--text);
  }
  .chev {
    transform: rotate(180deg);
    transition: transform 0.15s;
    opacity: 0.8;
  }
  .speed-btn.open .chev {
    transform: none;
  }

  .menu {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 0;
    width: 200px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.45);
  }
  .segmented {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: rgb(255 255 255 / 0.05);
  }
  .segmented button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 28px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    font-size: 12px;
  }
  .segmented button:hover {
    color: var(--text);
  }
  .segmented button.on {
    background: rgb(255 255 255 / 0.12);
    color: var(--text);
  }
  .heading {
    padding: 8px 8px 2px;
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    font-size: 13px;
    text-align: left;
  }
  .option:hover {
    background: var(--hover);
  }
  .option.on {
    color: var(--accent);
  }

  .zoom {
    display: flex;
    align-items: center;
  }
  .zb {
    width: 32px;
    min-width: 32px;
    padding: 0;
    color: var(--muted);
  }
  .zb:hover:not(:disabled) {
    color: var(--text);
  }
  .zb:disabled {
    opacity: 0.3;
  }
  .zl {
    min-width: 44px;
    padding: 6px 2px;
    border-radius: 6px;
    text-align: center;
    cursor: ew-resize;
    touch-action: none;
    user-select: none;
    font-size: 11.5px;
    color: var(--muted);
    text-shadow: 0 1px 8px rgb(0 0 0 / 0.85);
  }
  .zl:hover,
  .zl:focus-visible {
    color: var(--text);
  }

  .live {
    gap: 6px;
    font-size: 12px;
    color: var(--muted);
  }
  .live:hover:not(:disabled) {
    color: var(--text);
  }
  .live .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.7;
  }
  .live.on {
    color: var(--accent);
  }
  .live.on .dot {
    opacity: 1;
    box-shadow: 0 0 0 3px rgb(143 184 255 / 0.22);
  }

  .rail {
    position: relative;
  }
  .track {
    position: relative;
    height: 52px;
    cursor: pointer;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .track canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  /* The date rides above the playhead, level with the corner controls. */
  .stamp {
    position: absolute;
    left: 0;
    bottom: calc(100% + 11px);
    text-align: center;
    white-space: nowrap;
    text-shadow: 0 1px 8px rgb(0 0 0 / 0.85);
    will-change: transform;
  }
  .lm {
    height: 17px;
    font-size: 12px;
    color: var(--accent);
  }
  .when {
    padding: 1px 6px;
    border: 0;
    border-radius: 6px;
    background: transparent;
  }
  .when:hover,
  .when[aria-expanded='true'] {
    background: rgb(255 255 255 / 0.07);
  }
  .when .d {
    font-size: 14px;
    font-weight: 500;
  }
  .when .t {
    margin-left: 7px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
  }

  .tip {
    position: absolute;
    bottom: calc(100% - 4px);
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 10px;
    border-radius: 9px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
    white-space: nowrap;
    font-size: 12px;
    pointer-events: none;
  }
  .tip b {
    font-weight: 500;
  }
  .tip span {
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--muted);
  }

  /* DatePicker positions itself above its parent. */
  .picker-anchor {
    position: absolute;
    bottom: calc(100% + 40px);
  }

  .scrim,
  .dock {
    transition:
      transform 0.28s cubic-bezier(0.2, 0.7, 0.2, 1),
      opacity 0.2s;
  }
  .scrim.away {
    opacity: 0;
  }
  .dock.stowed {
    transform: translate(-50%, calc(100% + 80px));
    opacity: 0;
    visibility: hidden;
    transition:
      transform 0.28s cubic-bezier(0.2, 0.7, 0.2, 1),
      opacity 0.2s,
      visibility 0s 0.28s;
  }
  /* Raised over the cockpit console, on a panel of its own. */
  .dock.raised {
    padding: 10px 14px 12px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 18px 48px rgb(0 0 0 / 0.6);
  }

  @media (max-width: 640px) {
    .dock {
      width: calc(100% - 20px);
      bottom: 24px;
    }
    .chev,
    .zl,
    .when .t {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .scrim,
    .dock,
    .dock.stowed {
      transition: none;
    }
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cockpit, ui } from './state.svelte.ts';
  import { formatDistance, formatDistanceShort } from '../engine/format.ts';
  import { C } from '../astro/units.ts';
  import type { CockpitFrame } from '../engine/cockpit.ts';

  // The view from the ship: the canopy frame and the markers move with the
  // view every frame (written straight to the SVG by the engine's frame loop),
  // the instruments update about ten times a second.

  let svg: SVGSVGElement;
  let roof: SVGPathElement;
  let sides: SVGPathElement;
  let dash: SVGPathElement;
  let frame: SVGPathElement;
  let rim: SVGPathElement;
  let nose: SVGGElement;
  let drift: SVGGElement;
  let bracket: SVGGElement;
  let arrow: SVGGElement;
  let targetText: SVGTextElement;

  const KEY = 'ship-hints-seen-v1';
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  let keysOpen = $state(false);

  const r = $derived(ui.ship);

  function speedText(v: number): string {
    return `${formatDistance(v)}/s`;
  }

  function lightText(v: number): string {
    const c = v / C;
    if (c < 0.001) return '';
    if (c < 1) return `${c.toFixed(c < 0.01 ? 4 : 3)} c`;
    return `${new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 }).format(c)} × c`;
  }

  const deg = (x: number, signed = false) => `${signed && x >= 0 ? '+' : ''}${x.toFixed(1)}°`;
  const PHASE = { turning: 'Turning toward', cruising: 'Autopilot to', arriving: 'Arriving at', facing: 'Turning to face' } as const;

  const show = (el: Element, on: boolean) => el.setAttribute('visibility', on ? 'visible' : 'hidden');
  const at = (el: Element, x: number, y: number, rot = 0) => el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})${rot ? ` rotate(${rot.toFixed(1)})` : ''}`);

  let last: CockpitFrame | null = null;

  function draw(f: CockpitFrame) {
    // The canopy only changes when you look around or resize.
    if (!last || last.w !== f.w || last.h !== f.h) svg.setAttribute('viewBox', `0 0 ${f.w} ${f.h}`);
    if (last?.canopy !== f.canopy) {
      roof.setAttribute('d', f.roof);
      sides.setAttribute('d', f.sides);
      dash.setAttribute('d', f.dash);
      frame.setAttribute('d', f.canopy);
      rim.setAttribute('d', f.canopy);
    }
    last = f;
    show(nose, !!f.nose);
    if (f.nose) at(nose, f.nose.x, f.nose.y);
    show(drift, !!f.drift);
    if (f.drift) at(drift, f.drift.x, f.drift.y);
    const t = f.target;
    show(bracket, !!t && !t.edge);
    show(arrow, !!t && t.edge);
    if (t) {
      if (t.edge) at(arrow, t.x, t.y, (-t.angle * 180) / Math.PI);
      else at(bracket, t.x, t.y);
      targetText.textContent = formatDistanceShort(t.dist);
      at(targetText, t.edge ? t.x - Math.cos(t.angle) * 26 : t.x, t.edge ? t.y + Math.sin(t.angle) * 26 + 4 : t.y + 34);
      targetText.setAttribute('text-anchor', t.edge ? (Math.cos(t.angle) > 0.3 ? 'end' : Math.cos(t.angle) < -0.3 ? 'start' : 'middle') : 'middle');
    }
    show(targetText, !!t);
  }

  onMount(() => {
    cockpit.sink = draw;
    let seen = false;
    try {
      seen = !!localStorage.getItem(KEY);
      localStorage.setItem(KEY, '1');
    } catch {
      // storage unavailable
    }
    keysOpen = !seen;
    const t = setTimeout(() => (keysOpen = false), 12_000);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === '?') keysOpen = !keysOpen;
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cockpit.sink = null;
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  });

  const keys = touch
    ? [
        ['Drag', 'grab to steer'],
        ['Pinch', 'fly forward or back'],
        ['Double-tap', 'autopilot'],
      ]
    : [
        ['Scroll · W/S', 'fly'],
        ['A/D · R/F', 'strafe · rise, sink'],
        ['Drag', 'grab to steer'],
        ['Q/E', 'roll'],
        ['Right-drag', 'look around'],
        ['Shift · Alt', 'boost · fine'],
        ['X', 'stop'],
        ['C', 'face selection'],
        ['L', 'level'],
        ['Double-click', 'autopilot'],
        ['H', 'hide cockpit'],
        ['V', 'leave'],
      ];
</script>

<div class="cockpit" class:hidden={ui.hudHidden} aria-hidden={ui.hudHidden}>
  <svg bind:this={svg} class="overlay" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="dash-fill" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="1200">
        <stop offset="0.5" stop-color="rgb(14 18 28)" stop-opacity="0.8" />
        <stop offset="0.8" stop-color="rgb(6 8 13)" stop-opacity="0.94" />
      </linearGradient>
    </defs>
    <path bind:this={roof} class="roof" />
    <path bind:this={sides} class="sides" />
    <path bind:this={dash} class="dash" fill="url(#dash-fill)" />
    <!-- Struts: a light edge under a dark core, so they read against black space and bright planets alike. -->
    <path bind:this={rim} class="rim" />
    <path bind:this={frame} class="frame" />
    <!-- The nose: where the ship points (off center while looking around). -->
    <g bind:this={nose} class="mark" visibility="hidden">
      <path d="M-22 0h9l4 6 4-6h10M-4 0h0M13 0h9" />
      <circle r="1.6" class="fill" />
    </g>
    <!-- Drift: where the ship is moving. -->
    <g bind:this={drift} class="mark drift" visibility="hidden">
      <circle r="7" />
      <path d="M-7 0h-7M7 0h7M0 -7v-7" />
    </g>
    <g bind:this={bracket} class="mark target" visibility="hidden">
      <path d="M-22 -14v-8h8M14 -22h8v8M22 14v8h-8M-14 22h-8v-8" />
    </g>
    <g bind:this={arrow} class="mark target" visibility="hidden">
      <path d="M14 0L-6 -11L-2 0L-6 11Z" class="fill" />
    </g>
    <text bind:this={targetText} class="target-text" visibility="hidden"></text>
  </svg>

  {#if r}
    <div class="panel left">
      <div class="cap">Speed</div>
      <div class="big">{speedText(r.speed)}</div>
      <div class="sub">{lightText(r.speed)}</div>
      <div class="throttle" aria-label="Throttle">
        <div class="bar" style:height="{Math.abs(r.throttle) * 50}%" style:bottom={r.throttle >= 0 ? '50%' : `${50 - Math.abs(r.throttle) * 50}%`}></div>
      </div>
      <div class="flags">
        <span class:on={r.boost}>Boost</span>
        <span class:on={r.fine}>Fine</span>
      </div>
    </div>

    <div class="panel right">
      {#if r.nearest}
        <div class="cap">Nearest</div>
        <div class="val">{r.nearest.name}</div>
        <div class="sub">{formatDistanceShort(Math.max(r.nearest.altitude, 0))} above</div>
      {/if}
      <div class="more">
        <div class="cap">Moving with</div>
        <div class="val">{r.frame}</div>
        <div class="cap">Heading <span class="sys">{r.heading.system}</span></div>
        <div class="val mono">{deg(r.heading.lon)} {deg(r.heading.lat, true)}</div>
      </div>
    </div>

    {#if r.autopilot}
      <div class="status" transition:fade={{ duration: 150 }}>
        <span class="dot"></span>
        {PHASE[r.autopilot.phase]} <b>{r.autopilot.name}</b>
        {#if r.autopilot.phase !== 'facing'}
          <span class="muted">· {formatDistanceShort(r.autopilot.distance)} · {Math.max(1, Math.round(r.autopilot.eta))} s</span>
        {/if}
      </div>
    {:else if r.holding}
      <div class="status hold" transition:fade={{ duration: 150 }}>Holding with <b>{r.holding}</b></div>
    {/if}
  {/if}

  {#if keysOpen}
    <div class="keys" transition:fade={{ duration: 200 }}>
      {#each keys as [k, v] (k)}
        <span class="key"><b>{k}</b> {v}</span>
      {/each}
      {#if !touch}<span class="key muted"><b>?</b> keys</span>{/if}
    </div>
  {/if}
</div>

<style>
  /* `#ui > *` takes pointer events; the cockpit is only to look through. */
  :global(#ui) > .cockpit {
    pointer-events: none;
  }
  .cockpit {
    position: fixed;
    inset: 0;
    /* The helmet's edge: a faint darkening toward the corners. */
    background: radial-gradient(ellipse 85% 80% at 50% 45%, transparent 60%, rgb(0 0 0 / 0.32) 100%);
    font-size: 12px;
    color: var(--text);
  }
  .cockpit.hidden {
    display: none;
  }
  .overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .frame {
    fill: none;
    stroke: rgb(16 20 30 / 0.95);
    stroke-width: 9;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .rim {
    fill: none;
    stroke: rgb(150 170 210 / 0.3);
    stroke-width: 11.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .roof {
    fill: rgb(10 13 20 / 0.62);
  }
  .sides {
    fill: rgb(40 60 100 / 0.12);
  }
  .mark path,
  .mark circle {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .mark .fill {
    fill: var(--accent);
    stroke: none;
  }
  .drift path,
  .drift circle {
    stroke: rgb(143 255 200 / 0.85);
  }
  .target path {
    stroke: #ffc46b;
  }
  .target .fill {
    fill: #ffc46b;
    stroke: rgb(0 0 0 / 0.5);
    stroke-width: 1;
  }
  .target-text {
    fill: #ffc46b;
    font: 600 11px var(--mono);
    paint-order: stroke;
    stroke: rgb(0 0 0 / 0.7);
    stroke-width: 3px;
  }

  .panel {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    min-width: 150px;
    padding: 10px 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    backdrop-filter: blur(10px);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .left {
    left: 20px;
  }
  .right {
    right: 20px;
    text-align: right;
  }
  .cap {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin-top: 6px;
  }
  .panel > .cap:first-child {
    margin-top: 0;
  }
  .more {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sys {
    text-transform: none;
    letter-spacing: 0;
  }
  .big {
    font: 600 17px var(--mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .val {
    font-size: 13px;
    font-weight: 600;
  }
  .mono {
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
  }
  .sub {
    color: var(--muted);
    font-family: var(--mono);
    font-size: 11px;
    min-height: 1em;
  }
  .throttle {
    position: relative;
    height: 60px;
    width: 6px;
    margin: 8px 0 4px;
    border-radius: 3px;
    background: rgb(255 255 255 / 0.08);
  }
  .throttle::after {
    content: '';
    position: absolute;
    left: -3px;
    right: -3px;
    top: 50%;
    height: 1px;
    background: rgb(255 255 255 / 0.3);
  }
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    border-radius: 3px;
    background: var(--accent);
  }
  .flags {
    display: flex;
    gap: 6px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgb(255 255 255 / 0.25);
  }
  .flags .on {
    color: #ffc46b;
  }
  .status {
    position: absolute;
    left: 50%;
    top: 76px;
    transform: translateX(-50%);
    padding: 6px 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 999px;
    backdrop-filter: blur(10px);
    white-space: nowrap;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .status .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #ffc46b;
    box-shadow: 0 0 8px #ffc46b;
  }
  .status.hold {
    color: var(--muted);
  }
  .status b {
    color: var(--text);
  }
  .muted {
    color: var(--muted);
  }
  .keys {
    position: absolute;
    left: 50%;
    bottom: 150px;
    transform: translateX(-50%);
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 14px;
    width: max-content;
    max-width: min(760px, calc(100vw - 32px));
    padding: 8px 14px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    backdrop-filter: blur(12px);
    color: var(--muted);
  }
  .key b {
    color: var(--text);
    font-weight: 600;
  }
  @media (max-width: 760px) {
    .panel {
      top: auto;
      bottom: 150px;
      transform: none;
      min-width: 0;
      padding: 7px 9px;
    }
    .left {
      left: 16px;
    }
    .right {
      right: 16px;
    }
    .throttle,
    .flags,
    .more {
      display: none;
    }
    .big {
      font-size: 14px;
    }
    .status {
      top: auto;
      bottom: 250px;
    }
    .keys {
      bottom: 250px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .status,
    .keys {
      transition: none;
    }
  }
</style>

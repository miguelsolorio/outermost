<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cockpit, pilot, ui, type ShipGauges } from './state.svelte.ts';
  import { formatDistanceShort } from '../engine/format.ts';
  import { SILL, type CockpitFrame } from '../engine/cockpit.ts';
  import { emitFrame, onFrame } from './cockpit/frame.ts';
  import { reducedMotion } from './cockpit/physical.ts';
  import { Streaks } from './cockpit/streaks.ts';
  import Console from './cockpit/Console.svelte';

  // The view from the ship: the canopy frame, the markers on the glass and the
  // console below move with the view every frame (written straight to the DOM
  // by the engine's frame loop); the readouts update about ten times a second.

  let root: HTMLDivElement;
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
  let tape: SVGGElement;
  let tapeTicks: SVGPathElement;
  let tapeLabels = $state<SVGTextElement[]>([]);
  let streakCanvas: HTMLCanvasElement;
  let streaks: Streaks | null = null;

  const KEY = 'ship-hints-seen-v1';
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  let keysOpen = $state(false);

  /** Heading tape: degrees each side of the middle, and px per degree. */
  const TAPE_SPAN = 25;
  const TAPE_PX = 6;
  const TAPE_LABELS = 6;

  const show = (el: Element, on: boolean) => el.setAttribute('visibility', on ? 'visible' : 'hidden');
  const at = (el: Element, x: number, y: number, rot = 0) => el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})${rot ? ` rotate(${rot.toFixed(1)})` : ''}`);

  let last: CockpitFrame | null = null;
  let lastHeading = NaN;

  function drawTape(heading: number) {
    if (Math.abs(heading - lastHeading) < 0.05) return;
    lastHeading = heading;
    let d = '';
    const first = Math.ceil(heading - TAPE_SPAN);
    for (let deg = first; deg <= heading + TAPE_SPAN; deg++) {
      const x = (deg - heading) * TAPE_PX;
      if (deg % 5) continue;
      d += `M${x.toFixed(1)} 0v${deg % 10 ? 4 : 7}`;
    }
    tapeTicks.setAttribute('d', d);
    const base = Math.ceil((heading - TAPE_SPAN) / 10) * 10;
    for (let i = 0; i < TAPE_LABELS; i++) {
      const deg = base + i * 10;
      const t = tapeLabels[i];
      if (!t) continue;
      const x = (deg - heading) * TAPE_PX;
      const on = Math.abs(deg - heading) <= TAPE_SPAN - 2;
      show(t, on);
      if (!on) continue;
      t.setAttribute('x', x.toFixed(1));
      t.textContent = String(((deg % 360) + 360) % 360).padStart(3, '0');
      // Fade toward the ends of the tape.
      t.setAttribute('opacity', (1 - Math.abs(deg - heading) / TAPE_SPAN).toFixed(2));
    }
  }

  function draw(f: CockpitFrame, g: ShipGauges) {
    if (!last || last.w !== f.w || last.h !== f.h) {
      svg.setAttribute('viewBox', `0 0 ${f.w} ${f.h}`);
      // The console fills the view below the sill (at least enough for its controls).
      const h = Math.max(176, Math.round(f.h / 2 + f.focal * Math.tan((SILL * Math.PI) / 180)));
      root.style.setProperty('--console-h', `${h}px`);
      root.style.setProperty('--focal', `${f.focal.toFixed(1)}px`);
    }
    // The canopy only changes when you look around or resize.
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
    show(tape, !!f.tape);
    if (f.tape) {
      at(tape, f.tape.x, f.tape.y);
      drawTape(g.heading);
    }
    emitFrame(f, g);
  }

  onMount(() => {
    // Streaks are motion for its own sake: none when motion is reduced.
    if (!reducedMotion()) streaks = new Streaks(streakCanvas);
    pilot.kick = () => streaks?.kick();
    const off = onFrame((f, g, dt) => streaks?.draw(f, g, dt));
    cockpit.sink = draw;
    let seen = false;
    try {
      seen = !!localStorage.getItem(KEY);
      localStorage.setItem(KEY, '1');
    } catch {
      // storage unavailable
    }
    keysOpen = !seen;
    const timer = setTimeout(() => (keysOpen = false), 12_000);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (e.key === '?') keysOpen = !keysOpen;
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cockpit.sink = null;
      pilot.kick = () => {};
      off();
      clearTimeout(timer);
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
        ['T', 'timeline'],
        ['H', 'hide cockpit'],
        ['V', 'leave'],
      ];
</script>

<div class="cockpit" class:hidden={ui.hudHidden} aria-hidden={ui.hudHidden} bind:this={root}>
  <canvas bind:this={streakCanvas} class="streaks" aria-hidden="true"></canvas>
  <svg bind:this={svg} class="overlay" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <!-- The dash below the sill is the ship's body: solid, shading darker toward the floor. -->
      <linearGradient id="dash-fill" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="1200">
        <stop offset="0.4" stop-color="rgb(14 18 28)" />
        <stop offset="0.8" stop-color="rgb(6 8 13)" />
      </linearGradient>
    </defs>
    <path bind:this={roof} class="roof" />
    <path bind:this={sides} class="sides" />
    <path bind:this={dash} class="dash" fill="url(#dash-fill)" />
    <!-- Struts: a light edge under a dark core, so they read against black space and bright planets alike;
         a thin line of the accent along them, like the glass's edge catching light. -->
    <path bind:this={rim} class="rim" />
    <path bind:this={frame} class="frame" />
    <!-- The heading tape, on the glass just under the top of the windshield. -->
    <g bind:this={tape} class="tape" visibility="hidden">
      <path bind:this={tapeTicks} class="ticks" />
      {#each Array.from({ length: TAPE_LABELS }) as _, i (i)}
        <text bind:this={tapeLabels[i]} class="tl" y="19" text-anchor="middle"></text>
      {/each}
      <path class="caret" d="M0 -3l-5 -7h10z" />
    </g>
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

  <Console />

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
  /* `#ui > *` takes pointer events; the cockpit is to look through, except its console. */
  :global(#ui) > .cockpit {
    pointer-events: none;
  }
  .cockpit {
    /* Hardware and instruments, not text: dragging a control never selects anything. */
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    /* Console materials, in the site's palette. */
    --edge: #2c3850;
    --screen: #060a14;
    --screen-edge: #1f2a3f;
    --engrave: #75819a;
    --warn: #ffc46b;
    --go: #8fffc8;
    --alert: #ff6b6b;
    position: fixed;
    inset: 0;
    /* The helmet's edge: a faint darkening toward the corners. */
    background: radial-gradient(ellipse 85% 80% at 50% 40%, transparent 60%, rgb(0 0 0 / 0.32) 100%);
    font-size: 12px;
    color: var(--text);
  }
  .cockpit.hidden {
    display: none;
  }
  .streaks,
  .overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .overlay {
    overflow: visible;
  }
  .frame {
    fill: none;
    stroke: rgb(16 20 30 / 0.96);
    stroke-width: 9;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .rim {
    fill: none;
    stroke: rgb(143 184 255 / 0.34);
    stroke-width: 11.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .roof {
    fill: rgb(10 13 20 / 0.66);
  }
  .sides {
    fill: rgb(40 60 100 / 0.12);
  }
  .tape .ticks {
    fill: none;
    stroke: rgb(143 184 255 / 0.7);
    stroke-width: 1.2;
  }
  .tape .tl {
    fill: rgb(143 184 255 / 0.85);
    font: 500 10.5px var(--mono);
  }
  .tape .caret {
    fill: var(--warn);
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
    stroke: var(--warn);
  }
  .target .fill {
    fill: var(--warn);
    stroke: rgb(0 0 0 / 0.5);
    stroke-width: 1;
  }
  .target-text {
    fill: var(--warn);
    font: 600 11px var(--mono);
    paint-order: stroke;
    stroke: rgb(0 0 0 / 0.7);
    stroke-width: 3px;
  }
  .keys {
    position: absolute;
    left: 50%;
    bottom: calc(var(--console-h, 28.7vh) + 64px);
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
  @media (max-width: 640px) {
    .tape {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .keys {
      transition: none;
    }
  }
</style>

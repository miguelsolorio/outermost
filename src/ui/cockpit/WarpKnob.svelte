<script lang="ts">
  import { actions, sfx, ui } from '../state.svelte.ts';
  import { formatRate } from '../../engine/format.ts';
  import { LADDER, ladderIndex } from '../timeRates.ts';
  import { hardware } from './physical.ts';

  // The time-warp knob: detented through the clock's speeds, backward on the
  // left, forward on the right, real time at the top. Turn it by dragging
  // (either way), the wheel or the arrow keys.

  const N = LADDER.length;
  const SWEEP = 270;
  const angle = (i: number) => -SWEEP / 2 + (i * SWEEP) / (N - 1);
  const index = $derived(ladderIndex(ui.rate));
  const text = $derived(formatRate(LADDER[index]));
  const at = (deg: number, r: number) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];
  /** Engraved stops: a day a second either way inside the scale, a year a second under its ends. */
  const scale = [
    { i: 0, t: '−1y', p: [-33, 43] },
    { i: 3, t: '−1d', p: at(angle(3), 29.5) },
    { i: 10, t: '+1d', p: at(angle(10), 29.5) },
    { i: 13, t: '+1y', p: [33, 43] },
  ];

  let drag: { x: number; y: number; i: number } | null = null;

  function to(i: number) {
    const j = Math.max(0, Math.min(N - 1, i));
    if (j === index) return;
    sfx.play('tick');
    actions.setSpeed(LADDER[j]);
  }

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, i: index };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    // Right or up turns it clockwise, a detent every 24 px (as the timeline's speed drag).
    to(drag.i + Math.trunc((e.clientX - drag.x - (e.clientY - drag.y)) / 24));
  }

  function key(e: KeyboardEvent) {
    const step: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 3, PageDown: -3 };
    let i: number;
    if (e.key in step) i = index + step[e.key];
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = N - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    to(i);
  }
</script>

<!-- The whole dial turns the knob, not just its cap. -->
<div
  class="dial"
  use:hardware
  role="slider"
  tabindex="0"
  aria-label="Time warp"
  aria-valuemin={0}
  aria-valuemax={N - 1}
  aria-valuenow={index}
  aria-valuetext={text}
  title="Time warp: drag, scroll or use the arrow keys"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={() => (drag = null)}
  onpointercancel={() => (drag = null)}
  onwheel={(e) => {
    e.preventDefault();
    to(index + (e.deltaY < 0 || e.deltaX > 0 ? 1 : -1));
  }}
  onkeydown={key}
>
  <svg viewBox="-50 -50 100 100" overflow="visible" aria-hidden="true">
    <g fill="none" stroke="#8fb8ff">
      <circle r="40.5" stroke-opacity=".28" stroke-width=".7" pathLength="360" stroke-dasharray="270 90" transform="rotate(135)" />
      <!-- Real time: the arc between its two detents. -->
      <path d="M-7.3-39.8A40.5 40.5 0 0 1 7.3-39.8" stroke-opacity=".6" stroke-width="1.6" />
      {#each LADDER as r, i (i)}
        <path d="M0-42V{Math.abs(r) === 1 || i === 0 || i === N - 1 ? -48.5 : -46.5}" stroke-width={i === index ? 1.8 : 1} stroke-opacity={i === index ? 1 : 0.5} class:on={i === index} class:back={r < 0} transform="rotate({angle(i).toFixed(2)})" />
      {/each}
    </g>
    <g class="scale">
      {#each scale as l (l.i)}
        <text x={l.p[0].toFixed(1)} y={l.p[1].toFixed(1)} class:on={l.i === index}>{l.t}</text>
      {/each}
      <text x="0" y="-30" class="rt" class:on={Math.abs(LADDER[index]) === 1}>RT</text>
    </g>
  </svg>
  <div class="knob" style:--a="{angle(index)}deg"><i></i></div>
</div>

<style>
  /* A detented scale round a knurled knob with a lit pointer. */
  .dial {
    position: relative;
    flex: none;
    cursor: grab;
    outline: none;
    width: var(--dial, 100px);
    height: var(--dial, 100px);
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  path.on {
    stroke: var(--go);
    filter: drop-shadow(0 0 2px var(--go));
  }
  path.on.back {
    stroke: var(--warn);
    filter: drop-shadow(0 0 2px var(--warn));
  }
  /* 12 units: 9.6px on the smallest dial. */
  .scale text {
    fill: var(--engrave);
    font: 500 12px var(--mono);
    text-anchor: middle;
    dominant-baseline: central;
  }
  .scale .rt {
    fill: var(--muted);
  }
  .scale text.on {
    fill: var(--accent);
  }
  .knob {
    position: absolute;
    left: 33%;
    top: 33%;
    width: 34%;
    height: 34%;
    border-radius: 50%;
    background:
      radial-gradient(circle at 40% 28%, rgb(255 255 255 / 0.16), transparent 62%),
      repeating-conic-gradient(#434a55 0 3deg, #111418 3deg 6deg);
    box-shadow:
      0 0 0 1px #020305,
      0 5px 7px rgb(0 0 0 / 0.7),
      0 1px 0 1px rgb(255 255 255 / 0.05);
  }
  .dial:focus-visible .knob {
    box-shadow:
      0 0 0 1px #020305,
      0 0 0 3px var(--accent-dim);
  }
  .knob::before {
    content: '';
    position: absolute;
    inset: 15%;
    border-radius: 50%;
    background: radial-gradient(circle at 38% 30%, #636b77 0, #2d323a 48%, #181b21 100%);
    box-shadow:
      0 0 0 1px #07080b,
      inset 0 1px 0 rgb(255 255 255 / 0.2),
      0 1px 3px rgb(0 0 0 / 0.8);
  }
  .knob i {
    position: absolute;
    inset: 0;
    transform: rotate(var(--a));
    transition: transform 0.12s cubic-bezier(0.3, 0.7, 0.4, 1.2);
  }
  .knob i::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 8%;
    width: 2px;
    height: 32%;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--accent);
    box-shadow: var(--glow-a);
  }
  @media (prefers-reduced-motion: reduce) {
    .knob i {
      transition: none;
    }
  }
</style>

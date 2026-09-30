<script lang="ts">
  import { actions, ui } from '../state.svelte.ts';
  import { formatDistanceShort } from '../../engine/format.ts';
  import { RADAR_FAR, RADAR_NEAR } from '../../engine/instruments.ts';

  // The radar scope, seen from above the ship with the nose up: nearby
  // bodies by bearing, and by distance on a log scale in units of the
  // distance to the nearest surface (so it reads the same skimming a moon or
  // crossing between stars). Carets mark contacts above or below the wings.
  // Click a contact to select it.

  const R = 90;
  const r = $derived(ui.ship);
  /** Rings at 1, 10, 100 and 1000 × the distance to the nearest surface. */
  const rings = [1, 10, 100, 1000].map((d) => (R * Math.log(d / RADAR_NEAR)) / Math.log(RADAR_FAR / RADAR_NEAR));
  const TILT = 10 * (Math.PI / 180);
  const short = (s: string) => (s.length > 11 ? `${s.slice(0, 10)}…` : s).toUpperCase();
</script>

<div class="radar" role="group" aria-label="Radar">
  <span class="mic tl">Log</span>
  <span class="mic tr">Range<span class="rv">{r ? formatDistanceShort(RADAR_FAR * r.pace) : ''}</span></span>
  <svg viewBox="-100 -100 200 200">
    <circle r="97" fill="#05070b" />
    <g class="sweep" aria-hidden="true">
      <path d="M0 0-32.15-88.33A94 94 0 0 0-92.57-16.32Z" fill="url(#ck-sweep)" />
      <path d="M0 0-32.15-88.33" fill="none" stroke="#8fb8ff" stroke-opacity=".6" stroke-width=".9" />
    </g>
    <g fill="none" stroke="#8fb8ff" aria-hidden="true">
      <circle r="94" stroke-opacity=".5" stroke-width=".9" />
      <circle r="94" stroke-opacity=".45" stroke-width="5" pathLength="360" stroke-dasharray=".3 9.7" transform="rotate(-90.15)" />
      <circle r="93" stroke-opacity=".8" stroke-width="7" pathLength="360" stroke-dasharray=".5 89.5" transform="rotate(-90.25)" />
      {#each rings as rr (rr)}
        <circle r={rr} stroke-opacity=".22" stroke-width=".7" />
      {/each}
      <path d="M0-90V90M-90 0H90" stroke-opacity=".12" stroke-width=".6" />
      <path d="M-64-64 64 64M64-64-64 64" stroke-opacity=".1" stroke-width=".6" stroke-dasharray="1 3" />
    </g>
    {#each r?.radar ?? [] as c (c.id)}
      {@const x = c.x * R}
      {@const y = c.y * R}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <g class="blip {c.role}" class:clipped={c.clipped} role="button" tabindex="-1" aria-label="Select {c.name}" onclick={() => actions.select(c.id)}>
        <title>{c.name}</title>
        {#if c.role === 'target'}
          <path d="M0 0L{x.toFixed(1)} {y.toFixed(1)}" class="line" />
        {/if}
        <g transform="translate({x.toFixed(1)} {y.toFixed(1)})">
          <circle class="hit" r="14" />
          {#if c.clipped}
            <path class="pin" d="M0-5 4 2.5h-8z" transform="rotate({((Math.atan2(c.x, -c.y) * 180) / Math.PI).toFixed(0)})" />
          {:else if c.role === 'target'}
            <circle class="dot" r="2.8" />
            <path class="hi" d="M-7-4v-3h3M4-7h3v3M7 4v3h-3M-4 7h-3v-3" />
          {:else if c.role === 'frame'}
            <rect class="hi" x="-2.8" y="-2.8" width="5.6" height="5.6" />
          {:else}
            <circle class="dot" r="1.8" />
          {/if}
          {#if c.el > TILT}<path class="el" d="M-2.5-8l2.5-3 2.5 3" />{:else if c.el < -TILT}<path class="el" d="M-2.5 8l2.5 3 2.5-3" />{/if}
        </g>
        {#if c.role !== 'other'}
          <!-- Names read inward from the rim, so they stay on the glass. -->
          {@const k = c.clipped ? 0.8 : 1}
          <text x={(x * k).toFixed(1)} y={(y * k + (y * k < -60 ? 22 : -13)).toFixed(1)}>{short(c.name)}</text>
        {/if}
      </g>
    {/each}
    <path d="M0-5.5 4 4.5 0 2.2-4 4.5z" fill="#e8ecf4" aria-hidden="true" />
  </svg>
</div>

<style>
  .radar {
    position: absolute;
    inset: 0;
  }
  svg {
    position: absolute;
    inset: 3px;
    width: calc(100% - 6px);
    height: calc(100% - 6px);
  }
  .tl,
  .tr {
    position: absolute;
    z-index: 1;
    top: 7px;
  }
  .tl {
    left: 7px;
  }
  .tr {
    right: 7px;
    text-align: right;
  }
  .rv {
    display: block;
    margin-top: 3px;
    font: 500 10px/1 var(--mono);
    letter-spacing: 0;
    color: var(--text);
    text-transform: none;
  }
  .sweep {
    transform-origin: 0 0;
    animation: sweep 4s linear infinite;
  }
  @keyframes sweep {
    to {
      transform: rotate(360deg);
    }
  }
  .blip {
    cursor: pointer;
    outline: none;
  }
  .hit {
    fill: transparent;
  }
  .dot {
    fill: #8fb8ff;
    fill-opacity: 0.5;
  }
  .hi {
    fill: none;
    stroke: #e8ecf4;
    stroke-opacity: 0.85;
    stroke-width: 1.1;
  }
  .pin {
    fill: #e8ecf4;
    fill-opacity: 0.85;
  }
  .el {
    fill: none;
    stroke: #8fb8ff;
    stroke-opacity: 0.7;
    stroke-width: 1.1;
  }
  text {
    fill: #e8ecf4;
    fill-opacity: 0.85;
    font: 500 12.5px var(--mono);
    text-anchor: middle;
  }
  .target .dot {
    fill: var(--warn);
    fill-opacity: 1;
  }
  .target .hi,
  .target .el {
    stroke: var(--warn);
  }
  .target .pin {
    fill: var(--warn);
  }
  .target text {
    fill: var(--warn);
    fill-opacity: 1;
    font-weight: 600;
  }
  .line {
    fill: none;
    stroke: var(--warn);
    stroke-opacity: 0.4;
    stroke-width: 0.8;
    stroke-dasharray: 2 2;
  }
  .blip:hover .dot,
  .blip:hover .pin {
    fill-opacity: 1;
  }
  .blip:hover .hi {
    stroke-opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .sweep {
      animation: none;
      opacity: 0;
    }
  }
</style>

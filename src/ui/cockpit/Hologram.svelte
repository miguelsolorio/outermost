<script lang="ts">
  import { ui } from '../state.svelte.ts';
  import { formatDistanceShort } from '../../engine/format.ts';
  import { reducedMotion } from './physical.ts';

  // A wireframe hologram of the nearest body over its projector, seen a
  // little from above with its pole up and its day side (toward the Sun) on
  // the right. The point under the ship is marked, with a line up to the
  // ship: bright on the near side, hollow round the back.

  const R = 32;
  /** How far above the equator we see it from. */
  const TILT = 12 * (Math.PI / 180);
  const r = $derived(ui.ship);
  const n = $derived(r?.nearest ?? null);
  const spin = !reducedMotion();
  const DEG = Math.PI / 180;

  /** The mark: x toward the Sun, y down; near is the morning side facing us. */
  const mark = $derived.by(() => {
    if (!n || n.lat === null || n.lon === null) return null;
    const lat = n.lat * DEG;
    const lon = n.lon * DEG;
    const z = -R * Math.cos(lat) * Math.sin(lon);
    const x = R * Math.cos(lat) * Math.cos(lon);
    const y = -R * Math.sin(lat) * Math.cos(TILT) + z * Math.sin(TILT);
    const k = 1.45 / Math.max(Math.hypot(x, y), 1e-6);
    return { x, y, near: z >= 0, sx: x * k * R, sy: y * k * R };
  });
  const parallels = [-60, -30, 0, 30, 60].map((lat) => ({
    cy: -R * Math.sin(lat * DEG) * Math.cos(TILT),
    rx: R * Math.cos(lat * DEG),
    ry: R * Math.cos(lat * DEG) * Math.sin(TILT),
  }));
  const meridians = [0, 1, 2];
</script>

<div class="holo">
  <svg viewBox="-50 -50 100 106" aria-hidden="true">
    <g fill="none" stroke="#8fb8ff">
      <path d="M-23 46-33 6M23 46l10-40" stroke-opacity=".14" stroke-width=".6" />
      <ellipse cy="46" rx="23" ry="4.2" stroke-opacity=".55" stroke-width=".8" />
      <ellipse cy="46" rx="13" ry="2.3" stroke-opacity=".3" stroke-width=".6" />
      <circle r={R} fill={n?.lat !== null && n?.lat !== undefined ? 'url(#ck-day)' : 'rgb(143 184 255 / 0.05)'} stroke-opacity=".85" stroke-width=".9" />
      <g stroke-opacity=".32" stroke-width=".6">
        {#each parallels as p (p.cy)}
          <ellipse cy={p.cy.toFixed(2)} rx={p.rx.toFixed(2)} ry={p.ry.toFixed(2)} />
        {/each}
        {#each meridians as m (m)}
          <ellipse rx={(R * Math.abs(Math.sin((m * 60 + 15) * DEG))).toFixed(2)} ry={R}>
            {#if spin}
              <animate
                attributeName="rx"
                dur="12s"
                begin="{-m * 4}s"
                repeatCount="indefinite"
                values="0;{R};0"
                keyTimes="0;0.5;1"
                calcMode="spline"
                keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
              />
            {/if}
          </ellipse>
        {/each}
        <path d="M0 {-R}v{2 * R}" />
      </g>
      <!-- The Sun's side. -->
      <circle cx="44" cy="-40" r="3" stroke-opacity=".7" stroke-width=".7" />
    </g>
    <circle cx="44" cy="-40" r=".9" fill="#8fb8ff" />
    {#if mark}
      <g class:far={!mark.near}>
        <path d="M{mark.x.toFixed(1)} {mark.y.toFixed(1)}L{mark.sx.toFixed(1)} {mark.sy.toFixed(1)}" class="tether" />
        <circle cx={mark.x.toFixed(1)} cy={mark.y.toFixed(1)} r="4.5" class="ring" />
        <circle cx={mark.x.toFixed(1)} cy={mark.y.toFixed(1)} r="1.8" class="pt" />
        <path d="M0-4.5 3.5 4 0 2 -3.5 4z" class="ship" transform="translate({mark.sx.toFixed(1)} {mark.sy.toFixed(1)}) rotate({((Math.atan2(mark.sx, -mark.sy) * 180) / Math.PI).toFixed(0)})" />
      </g>
    {/if}
  </svg>
  {#if n}
    <div class="nb">{n.name}</div>
    <div class="na">{formatDistanceShort(Math.max(n.altitude, 0))} up</div>
  {:else if r}
    <div class="nb">{r.frame}</div>
  {/if}
</div>

<style>
  .holo {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px 6px 10px;
    filter: drop-shadow(0 0 1.6px rgb(143 184 255 / 0.55));
  }
  svg {
    display: block;
    flex: 1;
    min-height: 0;
    width: 100%;
    margin: auto 0;
  }
  .tether {
    fill: none;
    stroke: #e8ecf4;
    stroke-opacity: 0.7;
    stroke-width: 0.7;
    stroke-dasharray: 1.5 1.5;
  }
  .ring {
    fill: none;
    stroke: #e8ecf4;
    stroke-opacity: 0.8;
    stroke-width: 0.7;
  }
  .pt,
  .ship {
    fill: #e8ecf4;
  }
  .far {
    opacity: 0.45;
  }
  .far .pt {
    fill: none;
    stroke: #e8ecf4;
    stroke-width: 0.7;
  }
  .nb {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 600 13px/1.1 Inter, system-ui, sans-serif;
    color: var(--text);
  }
  .na {
    margin-top: 5px;
    font: 500 10px/1 var(--mono);
    color: var(--muted);
    white-space: nowrap;
  }
</style>

<script lang="ts">
  import { ui } from '../state.svelte.ts';

  // The annunciator strip, master-caution style: backlit lamps that light up
  // with what the ship is doing.

  const r = $derived(ui.ship);
  const lights = $derived([
    { label: 'Auto', on: !!r?.servo || !!r?.autopilot, tone: 'warn', title: 'Autopilot flying' },
    { label: 'Hold', on: !!r?.holding && !r?.autopilot, tone: 'go', title: 'Holding station' },
    { label: 'Prox', on: !!r?.prox, tone: 'alert', title: 'Close to a surface' },
    { label: 'Warp', on: !ui.paused && Math.abs(ui.rate) > 1, tone: 'go', title: 'Time warp' },
    { label: 'Boost', on: !!r?.boost, tone: 'warn', title: 'Boost held (Shift)' },
    { label: 'Fine', on: !!r?.fine, tone: 'glow', title: 'Fine control held (Alt)' },
    { label: 'Frame', on: !!r?.rebasing, tone: 'glow', title: 'Changing frames' },
  ]);
</script>

<div class="ann" role="status" aria-label="Status lights">
  {#each lights as l (l.label)}
    <span class="lamp {l.tone}" class:on={l.on} title={l.title} aria-hidden={!l.on}>{l.label}</span>
  {/each}
</div>

<style>
  .ann {
    display: flex;
    gap: 4px;
    height: 100%;
  }
  .lamp {
    flex: 1;
  }
  .lamp.warn {
    --c: 255 196 107;
  }
  .lamp.go {
    --c: 143 255 200;
  }
  .lamp.alert {
    --c: 255 107 107;
  }
  .lamp.alert.on {
    animation: blink 0.9s steps(2, jump-none) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.45;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .lamp.alert.on {
      animation: none;
    }
  }
</style>

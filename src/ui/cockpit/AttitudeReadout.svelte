<script lang="ts">
  import { onMount } from 'svelte';
  import { onFrame } from './frame.ts';

  // Heading, pitch and bank beside the attitude ball, in whole degrees.

  const DEG = 180 / Math.PI;
  let hdg: HTMLElement;
  let pitch: HTMLElement;
  let bank: HTMLElement;
  let last = '';

  const signed = (d: number) => `${d < 0 ? '−' : '+'}${String(Math.abs(d)).padStart(2, '0')}°`;

  onMount(() =>
    onFrame((_f, g) => {
      const h = Math.round(g.heading) % 360;
      const p = Math.round(g.pitch * DEG);
      const b = Math.round(g.bank * DEG);
      const key = `${h},${p},${b}`;
      if (key === last) return;
      last = key;
      hdg.textContent = `${String(h).padStart(3, '0')}°`;
      pitch.textContent = signed(p);
      bank.textContent = signed(b);
    }),
  );
</script>

<div class="well glass nd">
  <div><span class="mic">Hdg</span><b bind:this={hdg}>000°</b></div>
  <div><span class="mic">Pitch</span><b bind:this={pitch}>+00°</b></div>
  <div><span class="mic">Bank</span><b bind:this={bank}>+00°</b></div>
</div>

<style>
  .nd {
    flex: 1;
    align-self: stretch;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 4px 10px;
  }
  .nd > div {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    border-bottom: 1px solid rgb(143 184 255 / 0.09);
  }
  .nd > div:last-child {
    border: 0;
  }
  b {
    font: 500 16px/1 var(--mono);
    color: var(--text);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  @media (max-width: 1179px) {
    .nd {
      padding: 2px 7px;
    }
    b {
      font-size: 12.5px;
    }
  }
</style>

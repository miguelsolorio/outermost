<script lang="ts">
  import { ui } from '../state.svelte.ts';
  import { formatDistanceShort } from '../../engine/format.ts';
  import { C } from '../../astro/units.ts';

  // Speed over the frame the ship moves with, with a trace of the last few
  // seconds on a log scale (speeds here span thirty orders of magnitude).

  const r = $derived(ui.ship);
  /** About ten seconds of readings (they come ten times a second). */
  const N = 100;
  const trace: number[] = [];
  let line = $state('');

  $effect(() => {
    const v = r?.speed;
    if (v === undefined) return;
    trace.push(Math.log10(Math.max(v, 1e-3)));
    if (trace.length > N) trace.shift();
    if (trace.length < 2) return;
    let lo = Math.min(...trace);
    let hi = Math.max(...trace);
    if (hi - lo < 1) {
      const m = (hi + lo) / 2;
      lo = m - 0.5;
      hi = m + 0.5;
    }
    const x0 = N - trace.length;
    line = trace.map((v, i) => `${(((x0 + i) / (N - 1)) * 100).toFixed(1)} ${(40 - ((v - lo) / (hi - lo)) * 32).toFixed(1)}`).join(' ');
  });
  const area = $derived(line ? `M${line.split(' ').slice(0, 2).join(' ')}L${line}V44H${line.split(' ')[0]}Z` : '');

  function light(v: number): string {
    const c = v / C;
    if (c < 0.001) return '';
    if (c < 1) return `${c.toFixed(c < 0.01 ? 4 : 3)} c`;
    return `${new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 }).format(c)}× c`;
  }
</script>

{#if r}
  <!-- The number big, its unit under it: "7,526" over "km/s". -->
  {@const text = formatDistanceShort(r.speed)}
  {@const cut = text.indexOf(' ')}
  {@const num = cut > 0 ? text.slice(0, cut) : text}
  <div class="speed">
    <span class="mic">Speed</span>
    <b class="big" class:long={num.length > 5} class:longer={num.length > 6}>{num}</b>
    <div class="units"><span>{cut > 0 ? text.slice(cut + 1) : ''}/s</span><span>{light(r.speed)}</span></div>
    <svg viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
      <path class="grid" d="M0 11h100M0 22h100M0 33h100M25 0v44M50 0v44M75 0v44" />
      {#if line}
        <path class="area" d={area} />
        <path class="line" d="M{line}" />
      {/if}
    </svg>
    <div class="axis"><span class="mic">−10 s</span><span class="mic">Now</span></div>
  </div>
{/if}

<style>
  .speed {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 9px 9px 8px;
  }
  .big {
    margin-top: 10px;
    font: 500 28px/1 var(--mono);
    letter-spacing: -0.03em;
    color: var(--text);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    text-shadow: 0 0 10px rgb(232 236 244 / 0.18);
  }
  .big.long {
    font-size: 23px;
    margin-top: 12px;
    margin-bottom: 3px;
  }
  .big.longer {
    font-size: 19px;
    margin-top: 14px;
    margin-bottom: 4px;
  }
  .units {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    margin-top: 6px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgb(143 184 255 / 0.1);
    font: 500 10px/1 var(--mono);
    color: var(--muted);
    white-space: nowrap;
  }
  svg {
    display: block;
    width: 100%;
    flex: 1;
    min-height: 0;
    margin-top: 10px;
  }
  path {
    vector-effect: non-scaling-stroke;
  }
  .grid {
    stroke: #8fb8ff;
    stroke-opacity: 0.09;
    stroke-width: 0.6;
  }
  .area {
    fill: url(#ck-trace);
  }
  .line {
    fill: none;
    stroke: #8fb8ff;
    stroke-width: 1.2;
    stroke-linejoin: round;
  }
  .axis {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
  }
</style>

<script lang="ts">
  import { nav, ui } from '../state.svelte.ts';
  import { formatRate } from '../../engine/format.ts';
  import { RATES } from '../timeRates.ts';
  import KeyCap from './KeyCap.svelte';
  import ToggleSwitch from './ToggleSwitch.svelte';
  import WarpKnob from './WarpKnob.svelte';

  // The ship's clock: the date and time, the warp knob, a switch to run or
  // hold the clock, the rate it's running at, and a key that raises the full
  // timeline over the console.

  const date = $derived(new Date(ui.timeMs).toISOString().slice(0, 10));
  // Seconds are a blur at an hour a second, and the time of day at a month a second, as on the timeline.
  const time = $derived.by(() => {
    const a = Math.abs(ui.rate);
    const t = new Date(ui.timeMs).toISOString().slice(11, 19);
    return a >= RATES[5] ? '--:--' : a >= RATES[2] ? t.slice(0, 5) : t;
  });
  const rate = $derived(ui.paused ? 'Held' : Math.abs(ui.rate) === 1 ? `${ui.rate < 0 ? '−' : ''}Real time` : `${ui.rate > 1 ? '+' : ''}${formatRate(ui.rate)}`);
</script>

<div class="well glass clk">
  <span class="d">{date}</span>
  <span class="t">{time}<small>UTC</small></span>
</div>
<div class="trow">
  <WarpKnob />
  <div class="tcol">
    <ToggleSwitch label="Clock" onText="Run" offText="Hold" on={!ui.paused} onchange={() => nav.togglePlay()} ariaLabel="Clock running" />
  </div>
</div>
<div class="brow">
  <span class="rate" class:held={ui.paused} class:back={ui.rate < 0}><b>{ui.paused ? '❚❚' : ui.rate < 0 ? '◂' : '▸'}</b>{rate}</span>
  <KeyCap label="Time" lit={ui.timeOpen} title="The full timeline (T)" ariaLabel="Timeline" onpress={() => (ui.timeOpen = !ui.timeOpen)} />
</div>

<style>
  .clk {
    flex: none;
    height: 42px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
    padding: 0 9px;
    white-space: nowrap;
  }
  .d {
    font: 500 10px/1 var(--mono);
    color: var(--muted);
    letter-spacing: 0.04em;
  }
  .t {
    font: 500 15px/1 var(--mono);
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  small {
    margin-left: 5px;
    font-size: 9.5px;
    color: var(--muted);
    letter-spacing: 0.08em;
  }
  .trow {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tcol {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .brow {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    height: 24px;
  }
  .brow :global(.key) {
    flex: none;
    width: 52px;
    height: 100%;
    padding: 0;
  }
  .rate {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font: 500 10px/1 var(--mono);
    color: var(--text);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .rate b {
    margin-right: 5px;
    color: var(--go);
    text-shadow: 0 0 5px rgb(143 255 200 / 0.6);
  }
  .rate.back b {
    color: var(--warn);
    text-shadow: 0 0 5px rgb(255 196 107 / 0.6);
  }
  .rate.held {
    color: var(--muted);
  }
  .rate.held b {
    color: var(--muted);
    text-shadow: none;
    font-size: 8px;
    vertical-align: 1px;
  }
  @media (max-width: 1179px) {
    .clk {
      height: 36px;
    }
    .t {
      font-size: 13px;
    }
    .brow :global(.key) {
      width: 46px;
      letter-spacing: 0.1em;
    }
  }
</style>

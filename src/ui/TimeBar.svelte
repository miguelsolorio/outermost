<script lang="ts">
  import { actions, ui } from './state.svelte.ts';
  import { formatRate } from '../engine/format.ts';
  import DatePicker from './DatePicker.svelte';

  // Rate ladder in simulated seconds per real second.
  const RATES = [1, 60, 3600, 86_400, 7 * 86_400, 30.4375 * 86_400, 365.25 * 86_400];
  // Stepping walks one ladder from fastest backward to fastest forward, skipping zero.
  const LADDER = [...RATES.map((r) => -r).reverse(), ...RATES];

  let speedOpen = $state(false);
  let dateOpen = $state(false);
  let speedMenu: HTMLElement;
  let dateMenu: HTMLElement;

  const date = $derived(new Date(ui.timeMs));
  const dateText = $derived(
    date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }),
  );
  const timeText = $derived(date.toISOString().slice(11, 19) + ' UTC');
  const isLive = $derived(!ui.paused && ui.rate === 1 && Math.abs(ui.timeMs - Date.now()) < 5000);
  const slower = $derived(LADDER.findLast((r) => r < ui.rate - 1e-9));
  const faster = $derived(LADDER.find((r) => r > ui.rate + 1e-9));
  const backward = $derived(ui.rate < 0);

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const rateLabel = (r: number) => capitalize(formatRate(Math.abs(r)));

  function stepTitle(next: number | undefined): string {
    if (next === undefined) return 'Already at the fastest speed';
    if (Math.sign(next) !== Math.sign(ui.rate)) return `Run ${next < 0 ? 'backward' : 'forward'} in real time`;
    return `${Math.abs(next) > Math.abs(ui.rate) ? 'Faster' : 'Slower'}: ${formatRate(next)}`;
  }

  function setSpeed(mag: number) {
    actions.setRate((backward ? -1 : 1) * mag);
    speedOpen = false;
  }

  function setDirection(dir: 1 | -1) {
    actions.setRate(dir * Math.abs(ui.rate));
  }

</script>

<svelte:window
  onpointerdown={(e) => {
    if (speedOpen && !speedMenu?.contains(e.target as Node)) speedOpen = false;
    if (dateOpen && !dateMenu?.contains(e.target as Node)) dateOpen = false;
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') speedOpen = dateOpen = false;
  }}
/>

<div class="timebar" role="group" aria-label="Time controls">
  <div class="clock" bind:this={dateMenu}>
    <button
      class="date-btn"
      class:open={dateOpen}
      onclick={() => (dateOpen = !dateOpen)}
      aria-haspopup="dialog"
      aria-expanded={dateOpen}
      title="Pick a date and time (UTC)"
      aria-label="Simulation time {dateText} {timeText}. Change date and time"
    >
      <svg class="cal" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3" />
        <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      </svg>
      <span class="readout">
        <span class="d">{dateText}</span>
        <span class="t">{timeText}</span>
      </span>
    </button>
    {#if dateOpen}
      <DatePicker
        ms={ui.timeMs}
        onpick={(ms) => actions.setTime(ms)}
        onnow={() => ((dateOpen = false), actions.now())}
        onclose={() => (dateOpen = false)}
      />
    {/if}
  </div>

  <div class="transport">
    <button class="ctl" onclick={() => slower !== undefined && actions.setRate(slower)} disabled={slower === undefined} title={stepTitle(slower)} aria-label={stepTitle(slower)}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M7.5 3.5v9L1.5 8zM14.5 3.5v9L8.5 8z" fill="currentColor" />
      </svg>
    </button>
    <button class="ctl play" onclick={() => actions.setPaused(!ui.paused)} title={ui.paused ? 'Play (Space)' : 'Pause (Space)'} aria-label={ui.paused ? 'Play' : 'Pause'}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        {#if ui.paused}
          <path d="M4.5 2.5v11l9-5.5z" fill="currentColor" />
        {:else}
          <rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
          <rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
        {/if}
      </svg>
    </button>
    <button class="ctl" onclick={() => faster !== undefined && actions.setRate(faster)} disabled={faster === undefined} title={stepTitle(faster)} aria-label={stepTitle(faster)}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M1.5 3.5v9l6-4.5zM8.5 3.5v9l6-4.5z" fill="currentColor" />
      </svg>
    </button>
  </div>

  <div class="speed" bind:this={speedMenu}>
    <button
      class="ctl speed-btn"
      class:paused={ui.paused}
      onclick={() => (speedOpen = !speedOpen)}
      aria-haspopup="true"
      aria-expanded={speedOpen}
      title="Choose how fast time runs"
    >
      {#if backward}
        <svg class="dir" viewBox="0 0 16 16" width="12" height="12" aria-label="Backward">
          <path d="M7.5 3.5v9L1.5 8zM14.5 3.5v9L8.5 8z" fill="currentColor" />
        </svg>
      {/if}
      <span class="rate">{rateLabel(ui.rate)}</span>
      <svg class="chev" class:up={speedOpen} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    {#if speedOpen}
      <div class="menu" role="menu" aria-label="Time speed">
        <div class="segmented" role="group" aria-label="Direction">
          <button role="menuitemradio" aria-checked={backward} class:on={backward} onclick={() => setDirection(-1)}>
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M7.5 3.5v9L1.5 8zM14.5 3.5v9L8.5 8z" fill="currentColor" /></svg>
            Backward
          </button>
          <button role="menuitemradio" aria-checked={!backward} class:on={!backward} onclick={() => setDirection(1)}>
            Forward
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M1.5 3.5v9l6-4.5zM8.5 3.5v9l6-4.5z" fill="currentColor" /></svg>
          </button>
        </div>
        <div class="heading">Speed</div>
        {#each RATES as r (r)}
          {@const current = Math.abs(Math.abs(ui.rate) - r) < 1e-9}
          <button class="option" role="menuitemradio" aria-checked={current} class:on={current} onclick={() => setSpeed(r)}>
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

  <button class="ctl live" class:on={isLive} onclick={() => actions.now()} disabled={isLive} title={isLive ? 'Showing the current time' : 'Jump to now, in real time'} aria-label={isLive ? 'Live' : 'Jump to now'}>
    <span class="dot" aria-hidden="true"></span>
    Live
  </button>
</div>

<style>
  .timebar {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    backdrop-filter: blur(12px);
    font-variant-numeric: tabular-nums;
    /* The speed menu opens over the search list on short screens. */
    z-index: 3;
  }

  button {
    font: inherit;
    color: var(--text);
    cursor: pointer;
  }
  button:focus-visible {
    outline: 2px solid var(--accent-dim);
    outline-offset: 1px;
  }

  /* Shared control style: matches the search field and top-right buttons. */
  .ctl {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 34px;
    min-width: 34px;
    padding: 0 8px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--panel);
    font-size: 12.5px;
    transition:
      background 0.12s,
      border-color 0.12s,
      color 0.12s;
  }
  .ctl:hover:not(:disabled) {
    background: var(--hover);
    border-color: rgb(255 255 255 / 0.18);
  }
  .ctl:active:not(:disabled) {
    background: rgb(255 255 255 / 0.12);
  }
  .ctl:disabled {
    cursor: default;
  }

  .clock {
    position: relative;
  }
  .date-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 10px 0 8px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    text-align: left;
    transition:
      background 0.12s,
      border-color 0.12s;
  }
  .date-btn:hover,
  .date-btn.open {
    background: var(--hover);
    border-color: var(--border);
  }
  .cal {
    color: var(--muted);
    flex-shrink: 0;
  }
  .readout {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }
  .d {
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }
  .t {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
  }

  .transport {
    display: flex;
    gap: 6px;
  }
  .transport .ctl {
    padding: 0;
    width: 34px;
  }
  .transport .ctl:disabled {
    color: var(--muted);
    opacity: 0.45;
  }
  .play {
    background: rgb(255 255 255 / 0.1);
    border-color: rgb(255 255 255 / 0.16);
  }

  .speed {
    position: relative;
  }
  .speed-btn {
    min-width: 104px;
    justify-content: space-between;
    padding: 0 8px 0 10px;
  }
  .speed-btn .rate {
    font-family: var(--mono);
    font-size: 12px;
    white-space: nowrap;
  }
  .speed-btn.paused .rate {
    color: var(--muted);
  }
  .dir,
  .chev {
    color: var(--muted);
    flex-shrink: 0;
  }
  .chev {
    transform: rotate(180deg);
    transition: transform 0.15s;
  }
  .chev.up {
    transform: none;
  }

  .menu {
    position: absolute;
    bottom: calc(100% + 12px);
    left: 50%;
    transform: translateX(-50%);
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
    border: 1px solid var(--border);
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
    height: 30px;
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

  .live {
    padding: 0 12px 0 10px;
  }
  .live .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--muted);
    opacity: 0.6;
  }
  .live.on {
    color: var(--accent);
    border-color: var(--accent-dim);
    background: rgb(143 184 255 / 0.1);
  }
  .live.on .dot {
    background: var(--accent);
    opacity: 1;
    box-shadow: 0 0 0 3px rgb(143 184 255 / 0.2);
  }

  @media (max-width: 640px) {
    .timebar {
      bottom: 28px;
      gap: 6px;
      padding: 6px;
      width: max-content;
      max-width: calc(100vw - 16px);
    }
    .cal,
    .chev {
      display: none;
    }
    .date-btn {
      padding: 0 4px;
    }
    .d {
      font-size: 12px;
    }
    .t {
      font-size: 10px;
      white-space: nowrap;
    }
    .transport {
      gap: 4px;
      flex-shrink: 0;
    }
    .transport .ctl {
      width: 32px;
      min-width: 32px;
    }
    .speed {
      min-width: 0;
    }
    .speed-btn {
      min-width: 0;
      max-width: 100%;
      padding: 0 8px;
    }
    .speed-btn .rate {
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .live {
      flex-shrink: 0;
      gap: 5px;
      padding: 0 8px;
      font-size: 12px;
    }
  }
</style>

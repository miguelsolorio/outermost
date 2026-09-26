<script lang="ts">
  import { untrack } from 'svelte';
  import { MAX_MS, MIN_MS } from '../astro/time.ts';

  let { ms, onpick, onnow, onclose }: { ms: number; onpick: (ms: number) => void; onnow: () => void; onclose: () => void } = $props();

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const MIN_YEAR = new Date(MIN_MS).getUTCFullYear();
  const MAX_YEAR = new Date(MAX_MS).getUTCFullYear() - 1;
  const pad = (n: number) => String(n).padStart(2, '0');

  // A draft of the chosen moment, taken when the picker opens; the clock keeps running underneath.
  const start = new Date(untrack(() => ms));
  let year = $state(start.getUTCFullYear());
  let month = $state(start.getUTCMonth());
  let day = $state(start.getUTCDate());
  let hour = $state(start.getUTCHours());
  let minute = $state(start.getUTCMinutes());
  // The month on screen, which can differ from the chosen day's.
  let viewYear = $state(start.getUTCFullYear());
  let viewMonth = $state(start.getUTCMonth());
  let view = $state<'days' | 'months'>('days');

  const today = new Date();
  const cells = $derived.by(() => {
    const lead = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(Date.UTC(viewYear, viewMonth, 1 - lead + i));
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth();
      const n = d.getUTCDate();
      return {
        y,
        m,
        n,
        outside: m !== viewMonth,
        selected: y === year && m === month && n === day,
        today: y === today.getUTCFullYear() && m === today.getUTCMonth() && n === today.getUTCDate(),
        inRange: y >= MIN_YEAR && y <= MAX_YEAR,
      };
    });
  });
  const atStart = $derived(viewYear <= MIN_YEAR && (view === 'months' || viewMonth === 0));
  const atEnd = $derived(viewYear >= MAX_YEAR && (view === 'months' || viewMonth === 11));

  function apply() {
    onpick(Date.UTC(year, month, day, hour, minute));
  }

  function step(dir: 1 | -1) {
    if (view === 'months') {
      viewYear = Math.min(MAX_YEAR, Math.max(MIN_YEAR, viewYear + dir));
      return;
    }
    const d = new Date(Date.UTC(viewYear, viewMonth + dir, 1));
    viewYear = d.getUTCFullYear();
    viewMonth = d.getUTCMonth();
  }

  function pickDay(c: { y: number; m: number; n: number }) {
    year = c.y;
    month = c.m;
    day = c.n;
    viewYear = c.y;
    viewMonth = c.m;
    apply();
  }

  function pickMonth(m: number) {
    viewMonth = m;
    view = 'days';
  }

  function onYear(e: Event) {
    const el = e.target as HTMLInputElement;
    const y = parseInt(el.value, 10);
    if (Number.isFinite(y)) viewYear = Math.min(MAX_YEAR, Math.max(MIN_YEAR, y));
    el.value = String(viewYear);
  }

  /** Commit an hour or minute field, wrapping arrow-key steps and clamping typed values. */
  function setField(which: 'hour' | 'minute', el: HTMLInputElement, delta = 0) {
    const max = which === 'hour' ? 23 : 59;
    const typed = parseInt(el.value, 10);
    let v = (Number.isFinite(typed) ? typed : which === 'hour' ? hour : minute) + delta;
    v = delta ? (v + max + 1) % (max + 1) : Math.min(max, Math.max(0, v));
    if (which === 'hour') hour = v;
    else minute = v;
    el.value = pad(v);
    apply();
  }

  function onFieldKey(which: 'hour' | 'minute', e: KeyboardEvent) {
    const el = e.target as HTMLInputElement;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      setField(which, el, e.key === 'ArrowUp' ? 1 : -1);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      setField(which, el);
      el.select();
    }
  }
</script>

<div class="picker" role="dialog" aria-label="Choose a date and time (UTC)">
  <div class="head">
    <button class="period" onclick={() => (view = view === 'days' ? 'months' : 'days')} aria-expanded={view === 'months'}>
      {view === 'days' ? `${MONTHS[viewMonth]} ${viewYear}` : 'Pick a month'}
      <svg class="chev" class:up={view === 'months'} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <div class="nav">
      <button class="icon" onclick={() => step(-1)} disabled={atStart} aria-label={view === 'days' ? 'Previous month' : 'Previous year'}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <button class="icon" onclick={() => step(1)} disabled={atEnd} aria-label={view === 'days' ? 'Next month' : 'Next year'}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
    </div>
  </div>

  {#if view === 'days'}
    <div class="grid" role="group" aria-label="{MONTHS[viewMonth]} {viewYear}">
      {#each WEEKDAYS as w (w)}
        <div class="wd" aria-hidden="true">{w}</div>
      {/each}
      {#each cells as c (`${c.y}-${c.m}-${c.n}`)}
        <button
          class="day"
          class:outside={c.outside}
          class:selected={c.selected}
          class:today={c.today}
          disabled={!c.inRange}
          onclick={() => pickDay(c)}
          aria-pressed={c.selected}
          aria-label="{MONTHS[c.m]} {c.n}, {c.y}{c.today ? ' (today)' : ''}"
        >
          {c.n}
        </button>
      {/each}
    </div>
  {:else}
    <div class="year-row">
      <label for="picker-year">Year</label>
      <input id="picker-year" class="field year" inputmode="numeric" maxlength="4" value={viewYear} onchange={onYear} onkeydown={(e) => e.key === 'Enter' && onYear(e)} />
      <span class="range">{MIN_YEAR}–{MAX_YEAR}</span>
    </div>
    <div class="months">
      {#each MONTHS as name, i (name)}
        <button class="month" class:selected={viewYear === year && i === month} onclick={() => pickMonth(i)}>{name.slice(0, 3)}</button>
      {/each}
    </div>
  {/if}

  <div class="time">
    <span class="time-label">Time <span class="utc">UTC</span></span>
    <div class="hm">
      <input class="field" inputmode="numeric" maxlength="2" value={pad(hour)} aria-label="Hour (UTC)" onchange={(e) => setField('hour', e.currentTarget)} onkeydown={(e) => onFieldKey('hour', e)} onfocus={(e) => e.currentTarget.select()} />
      <span class="colon">:</span>
      <input class="field" inputmode="numeric" maxlength="2" value={pad(minute)} aria-label="Minute (UTC)" onchange={(e) => setField('minute', e.currentTarget)} onkeydown={(e) => onFieldKey('minute', e)} onfocus={(e) => e.currentTarget.select()} />
    </div>
  </div>

  <div class="foot">
    <button class="btn" onclick={onnow}>
      <span class="dot" aria-hidden="true"></span>
      Now
    </button>
    <button class="btn primary" onclick={onclose}>Done</button>
  </div>
</div>

<style>
  .picker {
    position: absolute;
    bottom: calc(100% + 12px);
    left: 0;
    width: 272px;
    padding: 10px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.45);
    font-variant-numeric: tabular-nums;
  }

  button {
    font: inherit;
    color: var(--text);
    cursor: pointer;
    border: 0;
    background: transparent;
  }
  button:focus-visible,
  .field:focus-visible {
    outline: 2px solid var(--accent-dim);
    outline-offset: 1px;
  }
  button:disabled {
    cursor: default;
    opacity: 0.3;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .period {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
  }
  .period:hover,
  .icon:hover:not(:disabled) {
    background: var(--hover);
  }
  .chev {
    color: var(--muted);
    transition: transform 0.15s;
  }
  .chev.up {
    transform: rotate(180deg);
  }
  .nav {
    display: flex;
    gap: 2px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    color: var(--muted);
  }
  .icon:hover:not(:disabled) {
    color: var(--text);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .wd {
    height: 24px;
    display: grid;
    place-items: center;
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .day {
    position: relative;
    height: 32px;
    border-radius: 8px;
    font-size: 12.5px;
  }
  .day:hover:not(:disabled) {
    background: var(--hover);
  }
  .day.outside {
    color: var(--muted);
    opacity: 0.45;
  }
  .day.today::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 4px;
    width: 4px;
    height: 4px;
    margin-left: -2px;
    border-radius: 50%;
    background: var(--accent);
  }
  .day.selected,
  .month.selected {
    background: rgb(143 184 255 / 0.18);
    box-shadow: inset 0 0 0 1px var(--accent-dim);
    color: var(--accent);
    font-weight: 600;
    opacity: 1;
  }

  .year-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px 10px;
    font-size: 12px;
    color: var(--muted);
  }
  .range {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 11px;
  }
  .months {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }
  .month {
    /* Year row + 4 rows of months matches the day grid's height, so the header doesn't jump. */
    height: 43px;
    border-radius: 8px;
    font-size: 13px;
  }
  .month:hover {
    background: var(--hover);
  }

  .field {
    width: 40px;
    height: 30px;
    padding: 0;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: rgb(255 255 255 / 0.05);
    color: var(--text);
    font-family: var(--mono);
    font-size: 13px;
    text-align: center;
    outline: none;
  }
  .field:hover {
    border-color: rgb(255 255 255 / 0.18);
  }
  .field:focus {
    border-color: var(--accent-dim);
    background: rgb(143 184 255 / 0.08);
  }
  .field.year {
    width: 64px;
  }

  .time {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    padding: 10px 4px 0;
    border-top: 1px solid var(--border);
  }
  .time-label {
    font-size: 12.5px;
  }
  .utc {
    margin-left: 4px;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgb(255 255 255 / 0.07);
    color: var(--muted);
    font-family: var(--mono);
    font-size: 10px;
  }
  .hm {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .colon {
    color: var(--muted);
    font-family: var(--mono);
  }

  .foot {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 10px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel);
    font-size: 12.5px;
    transition:
      background 0.12s,
      border-color 0.12s;
  }
  .btn:hover {
    background: var(--hover);
    border-color: rgb(255 255 255 / 0.18);
  }
  .btn .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  .btn.primary {
    border-color: var(--accent-dim);
    background: rgb(143 184 255 / 0.12);
    color: var(--accent);
  }
  .btn.primary:hover {
    background: rgb(143 184 255 / 0.2);
  }
</style>

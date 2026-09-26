<script lang="ts">
  import { actions, ui, type SearchEntry } from './state.svelte.ts';
  import { findMatches } from './searchMatch.ts';
  import { formatDistanceShort } from '../engine/format.ts';

  const LIMIT = 8;

  let query = $state('');
  let active = $state(0);
  // The nearest list is ordered once when it opens, so rows stay put while you click through them.
  let nearest = $state.raw<SearchEntry[]>([]);
  // Bumped every second while open so distances follow the camera and the clock.
  let tick = $state(0);
  let input: HTMLInputElement;
  let sceneDown: { x: number; y: number } | null = null;

  const open = $derived(ui.openMenu === 'search');
  const searching = $derived(query.trim() !== '');
  const matches = $derived(searching ? findMatches(ui.searchIndex, query.trim(), LIMIT) : []);
  const rows = $derived.by(() => {
    void tick;
    return (searching ? matches : nearest).map((entry) => ({
      entry,
      dist: entry.diffuse ? null : actions.distanceTo(entry.id),
    }));
  });

  $effect(() => {
    if (!open) return;
    const t = setInterval(() => {
      if (!nearest.length) nearest = actions.nearby(LIMIT);
      tick++;
    }, 1000);
    return () => clearInterval(t);
  });

  function show() {
    if (open) return;
    ui.openMenu = 'search';
    active = 0;
    nearest = actions.nearby(LIMIT);
  }

  function close() {
    if (open) ui.openMenu = null;
    query = '';
  }

  function onInput() {
    ui.openMenu = 'search';
    active = 0;
    if (!searching) nearest = actions.nearby(LIMIT);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      if (!open) show();
      else active = Math.min(rows.length - 1, active + 1);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      active = Math.max(0, active - 1);
      e.preventDefault();
    } else if (e.key === 'Enter' && open && rows[active]) {
      actions.flyTo(rows[active].entry.id);
    }
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === '/' && !(e.target as HTMLElement)?.closest('input')) {
      input.focus();
      e.preventDefault();
    } else if (e.key === 'Escape' && open) {
      close();
      input.blur();
    }
  }}
  onpointerdown={(e) => {
    sceneDown = (e.target as HTMLElement).id === 'scene' ? { x: e.clientX, y: e.clientY } : null;
  }}
  onpointerup={(e) => {
    // A plain click on empty space closes the list; dragging to look around keeps it open.
    if (sceneDown && Math.hypot(e.clientX - sceneDown.x, e.clientY - sceneDown.y) < 5) close();
    sceneDown = null;
  }}
/>

<div class="search">
  <input
    bind:this={input}
    id="search"
    type="search"
    placeholder="Search  /"
    autocomplete="off"
    spellcheck="false"
    bind:value={query}
    onfocus={show}
    onclick={show}
    oninput={onInput}
    onkeydown={onKey}
    role="combobox"
    aria-expanded={open && rows.length > 0}
    aria-controls="search-list"
    aria-activedescendant={open && rows[active] ? `search-opt-${active}` : undefined}
    aria-label="Search the universe"
  />
  {#if open && (rows.length || searching)}
    <div class="list">
      {#if !searching}
        <div class="heading">Nearest to you</div>
      {/if}
      {#if rows.length}
        <ul id="search-list" role="listbox" aria-label={searching ? 'Search results' : 'Nearest objects'}>
          {#each rows as r, i (r.entry.id)}
            <li id="search-opt-{i}" role="option" aria-selected={i === active}>
              <button
                tabindex="-1"
                class:active={i === active}
                class:current={r.entry.id === ui.selectedId}
                onclick={() => ((active = i), actions.flyTo(r.entry.id))}
                onmouseenter={() => (active = i)}
              >
                <span class="text">
                  <span class="name">{r.entry.name}</span>
                  <span class="kind">{r.entry.detail ?? r.entry.kind}</span>
                </span>
                {#if r.dist !== null}
                  <span class="dist">{formatDistanceShort(r.dist)}</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="empty">No matches for “{query.trim()}”</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .search {
    position: relative;
    width: 240px;
  }
  input {
    width: 100%;
    height: 34px;
    padding: 0 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    backdrop-filter: blur(12px);
    outline: none;
  }
  input:focus {
    border-color: var(--accent-dim);
  }
  .list {
    position: absolute;
    top: 40px;
    left: 0;
    width: max(100%, 300px);
    max-width: calc(100vw - 32px);
    padding: 4px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.45);
  }
  .heading {
    padding: 6px 8px 4px;
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 8px;
    border: 0;
    background: transparent;
    color: var(--text);
    border-radius: 6px;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }
  li button.active {
    background: var(--hover);
  }
  li button.current .name {
    color: var(--accent);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.3;
  }
  .name,
  .kind {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    font-size: 13px;
  }
  .kind {
    color: var(--muted);
    font-size: 11px;
  }
  .dist {
    flex-shrink: 0;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  li button.active .dist {
    color: var(--text);
  }
  .empty {
    padding: 8px;
    font-size: 12px;
    color: var(--muted);
  }
</style>

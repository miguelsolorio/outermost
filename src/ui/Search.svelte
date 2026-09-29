<script lang="ts">
  import { actions, ui } from './state.svelte.ts';
  import { findMatches, findNearest, go, PAGE, type Match } from './searchMatch.ts';
  import ResultRow from './ResultRow.svelte';

  let query = $state('');
  let active = $state(0);
  // How many results to show; "Show more" adds another page.
  let shown = $state(PAGE);
  // The nearest list is ordered once when it opens, so rows stay put while you click through them.
  let nearest = $state.raw<{ matches: Match[]; more: boolean }>({ matches: [], more: false });
  // Bumped every second while open so distances follow the camera and the clock.
  let tick = $state(0);
  let input: HTMLInputElement;
  let sceneDown: { x: number; y: number } | null = null;

  const open = $derived(ui.openMenu === 'search');
  const searching = $derived(query.trim() !== '');
  const result = $derived(searching ? findMatches(ui.searchIndex, query.trim(), shown) : null);
  const list = $derived(result ?? nearest);
  const rows = $derived.by(() => {
    void tick;
    return list.matches.map((entry: Match) => ({
      entry,
      dist: entry.diffuse || entry.event ? null : actions.distanceTo(entry.id),
    }));
  });

  $effect(() => {
    if (!open) return;
    const t = setInterval(() => {
      if (!nearest.matches.length) nearest = findNearest([], shown);
      tick++;
    }, 1000);
    return () => clearInterval(t);
  });

  function show() {
    if (open) return;
    ui.openMenu = 'search';
    active = 0;
    shown = PAGE;
    nearest = findNearest([], PAGE);
  }

  function close() {
    if (open) ui.openMenu = null;
    query = '';
  }

  // Picking a result flies there, then clears the search and gets out of the way.
  function pick(entry: Match) {
    go(entry);
    close();
    input.blur();
  }

  function onInput() {
    ui.openMenu = 'search';
    active = 0;
    shown = PAGE;
    if (!searching) nearest = findNearest([], PAGE);
  }

  function showMore() {
    active = shown;
    if (!searching) nearest = findNearest(nearest.matches, shown + PAGE);
    shown += PAGE;
    input.focus();
  }

  function move(to: number) {
    active = Math.max(0, Math.min(rows.length - (list.more ? 0 : 1), to));
    document.getElementById(`search-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      if (!open) show();
      else move(active + 1);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      move(active - 1);
      e.preventDefault();
    } else if (e.key === 'Enter' && open && rows[active]) {
      pick(rows[active].entry);
    } else if (e.key === 'Enter' && open && list.more && active === rows.length) {
      showMore();
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
    placeholder="Search / or ⌘+K"
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
    aria-activedescendant={open && (rows[active] || (list.more && active === rows.length)) ? `search-opt-${active}` : undefined}
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
                onclick={() => pick(r.entry)}
                onmouseenter={() => (active = i)}
              >
                <ResultRow match={r.entry} dist={r.dist} />
              </button>
            </li>
          {/each}
          {#if list.more}
            <li id="search-opt-{rows.length}" role="option" aria-selected={active === rows.length}>
              <button
                tabindex="-1"
                class="more"
                class:active={active === rows.length}
                onmousedown={(e) => e.preventDefault()}
                onclick={showMore}
                onmouseenter={() => (active = rows.length)}
              >
                Show more
              </button>
            </li>
          {/if}
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
    /* Gives way to the toolbar buttons on a narrow phone. */
    min-width: 0;
    flex-shrink: 1;
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
    max-height: min(420px, 60vh);
    overflow-y: auto;
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
  li button.more {
    justify-content: center;
    font-size: 12px;
    color: var(--muted);
  }
  li button.more.active {
    color: var(--text);
  }
  .empty {
    padding: 8px;
    font-size: 12px;
    color: var(--muted);
  }
</style>

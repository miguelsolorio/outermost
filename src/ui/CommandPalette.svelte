<script lang="ts">
  import { actions, ui, type SearchEntry } from './state.svelte.ts';
  import { findMatches, go as goTo, PAGE, type Match } from './searchMatch.ts';
  import ResultRow from './ResultRow.svelte';

  // A centered "go to" palette on ⌘K or ⌘⇧P (Ctrl on other platforms), a second way into the same search.
  const LIMIT = 10;
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  let query = $state('');
  let active = $state(0);
  // How many search results to show; "Show more" adds another page.
  let shown = $state(PAGE);
  // Ordered once when it opens, like the search box, so rows stay put while you pick one.
  let nearest = $state.raw<SearchEntry[]>([]);
  // Bumped every second while open so distances follow the camera and the clock.
  let tick = $state(0);
  let input = $state<HTMLInputElement>();

  const open = $derived(ui.paletteOpen);
  const searching = $derived(query.trim() !== '');
  const result = $derived(searching ? findMatches(ui.searchIndex, query.trim(), shown) : null);
  const rows = $derived.by(() => {
    void tick;
    const entries = result ? result.matches : nearest;
    return entries.map((entry: Match) => ({ entry, dist: entry.diffuse || entry.event ? null : actions.distanceTo(entry.id) }));
  });

  $effect(() => {
    if (!open) return;
    input?.focus();
    const t = setInterval(() => {
      if (!nearest.length) nearest = actions.nearby(LIMIT);
      tick++;
    }, 1000);
    return () => clearInterval(t);
  });

  function show() {
    (document.activeElement as HTMLElement | null)?.blur();
    ui.openMenu = null;
    query = '';
    active = 0;
    shown = PAGE;
    nearest = actions.nearby(LIMIT);
    ui.paletteOpen = true;
  }

  function close() {
    ui.paletteOpen = false;
  }

  function go(m: Match) {
    close();
    goTo(m);
  }

  function showMore() {
    active = shown;
    shown += PAGE;
    input?.focus();
  }

  function move(to: number) {
    active = Math.max(0, Math.min(rows.length - (result?.more ? 0 : 1), to));
    document.getElementById(`palette-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') move(active + 1);
    else if (e.key === 'ArrowUp') move(active - 1);
    else if (e.key === 'Enter' && !e.isComposing && rows[active]) go(rows[active].entry);
    else if (e.key === 'Enter' && !e.isComposing && result?.more && active === rows.length) showMore();
    else if (e.key === 'Escape') close();
    else return;
    e.preventDefault();
  }
</script>

<svelte:window
  onkeydown={(e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if ((key === 'k' && !e.shiftKey) || (key === 'p' && e.shiftKey)) {
      e.preventDefault();
      if (open) close();
      else show();
    }
  }}
/>

{#if open}
  <div class="backdrop" role="presentation" onclick={close}></div>
  <div class="palette" role="dialog" aria-modal="true" aria-label="Go to">
    <input
      bind:this={input}
      type="text"
      placeholder="Where to?"
      autocomplete="off"
      spellcheck="false"
      bind:value={query}
      oninput={() => ((active = 0), (shown = PAGE))}
      onkeydown={onKey}
      role="combobox"
      aria-expanded={rows.length > 0}
      aria-controls="palette-list"
      aria-activedescendant={rows[active] || (result?.more && active === rows.length) ? `palette-opt-${active}` : undefined}
      aria-label="Search the universe"
    />
    {#if rows.length || searching}
      <div class="list">
        {#if !searching}
          <div class="heading">Nearest to you</div>
        {/if}
        {#if rows.length}
          <ul id="palette-list" role="listbox" aria-label={searching ? 'Search results' : 'Nearest objects'}>
            {#each rows as r, i (r.entry.id)}
              <li id="palette-opt-{i}" role="option" aria-selected={i === active}>
                <button
                  tabindex="-1"
                  class:active={i === active}
                  class:current={r.entry.id === ui.selectedId}
                  onclick={() => go(r.entry)}
                  onmouseenter={() => (active = i)}
                >
                  <ResultRow match={r.entry} dist={r.dist} />
                </button>
              </li>
            {/each}
            {#if result?.more}
              <li id="palette-opt-{rows.length}" role="option" aria-selected={active === rows.length}>
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
    <footer aria-hidden="true">
      <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
      <span><kbd>↵</kbd> fly there</span>
      <span><kbd>esc</kbd> close</span>
    </footer>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    background: rgb(0 0 0 / 0.35);
    backdrop-filter: blur(2px);
  }
  .palette {
    position: fixed;
    z-index: 11;
    top: 18vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(560px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 24px 64px rgb(0 0 0 / 0.6);
    overflow: hidden;
  }
  input {
    width: 100%;
    height: 50px;
    padding: 0 16px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 15px;
    outline: none;
  }
  input::placeholder {
    color: var(--muted);
  }
  .list {
    max-height: min(420px, 50vh);
    overflow-y: auto;
    padding: 4px;
  }
  .heading {
    padding: 6px 10px 4px;
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
    padding: 8px 10px;
    border: 0;
    background: transparent;
    color: var(--text);
    border-radius: 7px;
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
    padding: 10px;
    font-size: 12px;
    color: var(--muted);
  }
  footer {
    display: flex;
    gap: 16px;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--muted);
  }
  kbd {
    display: inline-block;
    min-width: 18px;
    margin-right: 3px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: inherit;
    font-size: 10.5px;
    line-height: 16px;
    text-align: center;
  }
  @media (pointer: coarse) {
    footer {
      display: none;
    }
  }
</style>

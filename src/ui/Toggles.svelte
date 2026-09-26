<script lang="ts">
  import { actions, ui } from './state.svelte.ts';

  const open = $derived(ui.openMenu === 'view');
  const items = [
    { key: 'labels', label: 'Labels', hint: 'Names of planets, moons and stars' },
    { key: 'orbits', label: 'Orbits', hint: 'Current orbital paths' },
    { key: 'constellations', label: 'Constellations', hint: 'IAU constellation figures, names and boundaries' },
    { key: 'smallBodies', label: 'Asteroids & Kuiper belt', hint: '~200,000 real asteroids and trans-Neptunian objects (JPL)' },
    { key: 'boost', label: 'Boost sizes', hint: 'Enlarge tiny bodies so they stay visible (not to scale)' },
  ] as const;
</script>

<div class="toggles">
  <div class="buttons">
    <button
      class="menu sound"
      class:off={!ui.soundOn}
      onclick={() => actions.setSound(!ui.soundOn)}
      aria-pressed={ui.soundOn}
      aria-label={ui.soundOn ? 'Mute ambient sound' : 'Play ambient sound'}
      title={ui.soundOn ? 'Ambient sound on (starts after your first click)' : 'Ambient sound off'}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
        {#if ui.soundOn}
          <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" />
        {:else}
          <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        {/if}
      </svg>
    </button>
    <button class="menu" onclick={() => (ui.openMenu = open ? null : 'view')} aria-expanded={open} aria-label="View options">☰</button>
  </div>
  {#if open}
    <div class="panel">
      {#each items as it (it.key)}
        <label title={it.hint}>
          <input type="checkbox" checked={ui.settings[it.key]} onchange={() => actions.toggle(it.key)} />
          <span>{it.label}</span>
        </label>
      {/each}
      <button class="link" onclick={() => ((ui.creditsOpen = true), (ui.openMenu = null))}>About &amp; credits</button>
      <div class="meta">Depth: {ui.depthMode} · {ui.fps} fps</div>
    </div>
  {/if}
  {#if ui.settings.boost}
    <div class="badge" title="Planet and moon sizes are enlarged for visibility">Sizes exaggerated</div>
  {/if}
</div>

<style>
  .toggles {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  .buttons {
    display: flex;
    gap: 8px;
  }
  .sound {
    display: grid;
    place-items: center;
  }
  .sound.off {
    color: var(--muted);
  }
  .menu {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
    cursor: pointer;
    backdrop-filter: blur(12px);
  }
  .panel {
    position: absolute;
    top: 40px;
    right: 0;
    width: 200px;
    padding: 8px;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
  }
  label:hover {
    background: var(--hover);
  }
  input {
    accent-color: var(--accent);
  }
  .link {
    text-align: left;
    border: none;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 13px;
    padding: 6px;
    border-radius: 6px;
    cursor: pointer;
    border-top: 1px solid var(--border);
    margin-top: 4px;
  }
  .link:hover {
    background: var(--hover);
  }
  .meta {
    font-size: 11px;
    color: var(--muted);
    padding: 6px;
    border-top: 1px solid var(--border);
    margin-top: 4px;
  }
  .badge {
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 999px;
    background: rgb(255 180 60 / 0.15);
    color: #ffc46b;
    border: 1px solid rgb(255 180 60 / 0.3);
    white-space: nowrap;
  }
</style>

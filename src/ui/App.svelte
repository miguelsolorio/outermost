<script lang="ts">
  import { ui } from './state.svelte.ts';
  import Timeline from './Timeline.svelte';
  import Search from './Search.svelte';
  import Toggles from './Toggles.svelte';
  import InfoCard from './InfoCard.svelte';
  import Credits from './Credits.svelte';
  import Hints from './Hints.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import Cockpit from './Cockpit.svelte';
</script>

<!-- First, so the top bar and timeline sit over the canopy. -->
{#if ui.shipMode}
  <Cockpit />
{/if}

<header class="topbar">
  <InfoCard />
  <div class="right">
    <Search />
    <Toggles />
  </div>
</header>

<Timeline />
<Hints />
<CommandPalette />

<!-- In the cockpit the console fills the bottom of the view; the credits are still in the ☰ menu. -->
{#if !ui.shipMode}
  <button class="credit-link" onclick={() => (ui.creditsOpen = true)}><span class="long">Data &amp; imagery: NASA, ESA, JPL, USGS, ESO, NOIRLab, IAU · </span>Credits</button>
{/if}

{#if ui.shipMode && ui.hudHidden}
  <button class="hud-chip" onclick={() => (ui.hudHidden = false)}>Show cockpit <kbd>H</kbd></button>
{/if}

{#if ui.creditsOpen}
  <Credits />
{/if}

{#if ui.assetsMissing}
  <div class="notice">Imagery not built yet: planets show flat colors. Run <code>npm run pipeline</code>.</div>
{/if}

<style>
  .topbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 16px 20px;
    pointer-events: none;
    gap: 16px;
    /* Dropdowns open over the info card. */
    z-index: 2;
  }
  .right {
    display: flex;
    gap: 8px;
    pointer-events: auto;
    align-items: flex-start;
  }
  .credit-link {
    position: fixed;
    right: 12px;
    bottom: 10px;
    border: none;
    background: none;
    color: rgb(255 255 255 / 0.38);
    font: inherit;
    font-size: 10.5px;
    cursor: pointer;
    pointer-events: auto;
    text-shadow: 0 1px 6px rgb(0 0 0 / 0.9);
  }
  @media (max-width: 640px) {
    .credit-link {
      bottom: 6px;
      right: 50%;
      transform: translateX(50%);
    }
    .credit-link .long {
      display: none;
    }
  }
  .credit-link:hover {
    color: rgb(255 255 255 / 0.75);
  }
  .hud-chip {
    position: fixed;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--panel);
    backdrop-filter: blur(10px);
    color: var(--muted);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    pointer-events: auto;
  }
  .hud-chip:hover {
    color: var(--text);
  }
  .hud-chip kbd {
    font: 600 10.5px var(--mono);
    color: var(--text);
  }
  .notice {
    position: fixed;
    left: 50%;
    top: 16px;
    transform: translateX(-50%);
    background: var(--panel);
    border: 1px solid var(--border);
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    color: var(--muted);
  }
  @media (max-width: 640px) {
    .topbar {
      flex-direction: column;
      padding: 12px 16px;
    }
    /* Full width, so the search box gives way to the buttons. */
    .right {
      align-self: stretch;
    }
  }
</style>

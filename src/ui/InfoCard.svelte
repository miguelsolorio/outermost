<script lang="ts">
  import { slide } from 'svelte/transition';
  import { actions, ui } from './state.svelte.ts';

  // The title doubles as the card's header: hover to peek at the facts, click to keep them open.
  let pinned = $state(false);
  let hovering = $state(false);

  const card = $derived(ui.card);
  const open = $derived(!!card && (pinned || hovering));
  const KIND_LABEL = { measured: 'Measured', derived: 'Derived', model: 'Model', artistic: 'Artistic' } as const;
  const KIND_HINT = {
    measured: 'Directly measured and published by the cited source',
    derived: 'Calculated from measured values',
    model: 'From a physical model or approximation',
    artistic: "An artist's rendering: not directly observed",
  } as const;
  const sources = $derived(card ? [...new Map(card.facts.map((f) => [f.source.url, f.source])).values()] : []);

  function toggle() {
    pinned = !pinned;
    if (!pinned) hovering = false;
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') pinned = hovering = false;
  }}
/>

<div class="where" class:open class:pinned role="group" onmouseenter={() => (hovering = true)} onmouseleave={() => (hovering = false)}>
  <button class="title" onclick={toggle} disabled={!card} aria-expanded={open} aria-controls="facts" title={pinned ? 'Hide facts' : 'Show facts'}>
    <span class="name" aria-live="polite">
      <span class="focus">{ui.focusName}</span>
      <svg class="chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
    <span class="distance">{ui.distanceText}</span>
  </button>
  {#if open && card}
    <aside id="facts" class="card" transition:slide={{ duration: 180 }} aria-label={`${card.name} facts`}>
      <div class="sub">{card.subtitle}</div>
      {#if ui.canFlyTo}
        <button class="go" onclick={() => actions.flyTo(card.id)}>Fly to {card.name}</button>
      {/if}
      {#if card.facts.length}
        <dl>
          {#each card.facts as f (f.label)}
            <div class="row">
              <dt>
                {f.label}
                <span class="dot {f.kind}" title={`${KIND_LABEL[f.kind]}: ${KIND_HINT[f.kind]}. Source: ${f.source.name}`}></span>
              </dt>
              <dd>{f.value}</dd>
            </div>
          {/each}
        </dl>
      {/if}
      {#each card.notes as n (n.text)}
        <p class="note"><span class="badge {n.kind}">{KIND_LABEL[n.kind]}</span> {n.text}</p>
      {/each}
      {#if sources.length}
        <footer>
          Sources:
          {#each sources as s, i (s.url)}
            <a href={s.url} target="_blank" rel="noopener">{s.name}</a>{i < sources.length - 1 ? ' · ' : ''}
          {/each}
        </footer>
      {/if}
    </aside>
  {/if}
</div>

<style>
  .where {
    position: relative;
    /* Padding sits outside the text so the title doesn't move when the panel appears. */
    margin: -10px -12px;
    padding: 10px 12px;
    border: 1px solid transparent;
    border-radius: 14px;
    pointer-events: auto;
    transition:
      background 0.18s,
      border-color 0.18s,
      border-radius 0.18s;
  }
  .where.open {
    width: min(320px, calc(100vw - 16px));
    background: var(--panel);
    border-color: var(--border);
    border-radius: 14px 14px 0 0;
  }
  /* Blur on a layer of its own: a backdrop-filter on .where would stop the facts below from blurring the scene. */
  .where.open::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    backdrop-filter: blur(14px);
  }
  .title {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    text-shadow: 0 1px 8px rgb(0 0 0 / 0.8);
  }
  .title:disabled {
    cursor: default;
  }
  .title:focus-visible {
    outline: 2px solid var(--accent-dim);
    outline-offset: 4px;
    border-radius: 6px;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .focus {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .chev {
    color: var(--muted);
    opacity: 0;
    transition:
      opacity 0.15s,
      transform 0.18s;
  }
  .title:not(:disabled):hover .chev,
  .open .chev {
    opacity: 1;
  }
  .open .chev {
    transform: rotate(180deg);
  }
  /* Touch screens can't hover, so hint that the title opens. */
  @media (hover: none) {
    .title:not(:disabled) .chev {
      opacity: 0.6;
    }
  }
  .distance {
    font-size: 13px;
    color: var(--muted);
    margin-top: 2px;
    font-variant-numeric: tabular-nums;
  }
  .open .title {
    text-shadow: none;
  }
  @media (max-width: 640px) {
    /* Stacked above the search row here, so the open card covers it. */
    .where.open {
      z-index: 1;
    }
  }

  /* The facts hang off the title, as one panel with it. */
  .card {
    position: absolute;
    top: 100%;
    left: -1px;
    right: -1px;
    max-height: calc(100vh - 190px);
    overflow: auto;
    padding: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-top: 0;
    border-radius: 0 0 14px 14px;
    backdrop-filter: blur(14px);
  }
  .sub {
    color: var(--muted);
    font-size: 12px;
  }
  .go {
    margin-top: 12px;
    width: 100%;
    height: 32px;
    border-radius: 8px;
    border: 1px solid var(--accent-dim);
    background: rgb(120 170 255 / 0.1);
    color: var(--text);
    cursor: pointer;
    font: inherit;
    font-size: 13px;
  }
  dl {
    margin: 14px 0 0;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    font-size: 12.5px;
  }
  dt {
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex: none;
  }
  .note {
    margin: 12px 0 0;
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--muted);
  }
  footer {
    margin-top: 12px;
    font-size: 11px;
    color: var(--muted);
    line-height: 1.6;
  }
  a {
    color: var(--accent);
  }
  .badge {
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-right: 4px;
  }
  .measured {
    background: rgb(90 200 140 / 0.18);
    color: #7fe0a8;
  }
  .derived {
    background: rgb(120 170 255 / 0.18);
    color: #9cc0ff;
  }
  .model {
    background: rgb(200 170 255 / 0.18);
    color: #cdb4ff;
  }
  .artistic {
    background: rgb(255 170 90 / 0.18);
    color: #ffc07a;
  }
  .dot.measured {
    background: #7fe0a8;
  }
  .dot.derived {
    background: #9cc0ff;
  }
  .dot.model {
    background: #cdb4ff;
  }
  .dot.artistic {
    background: #ffc07a;
  }
</style>

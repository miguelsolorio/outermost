<script lang="ts">
  // One search result: a place with its distance, or a timeline landmark with its date,
  // marked in the same color the timeline uses for its kind. Places with a
  // category color (stellar vs supermassive black holes) get a dot too.
  import { KIND_COLOR } from '../data/landmarks.ts';
  import { formatDistanceShort } from '../engine/format.ts';
  import { ui } from './state.svelte.ts';
  import type { Match } from './searchMatch.ts';

  let { match, dist }: { match: Match; dist: number | null } = $props();

  const fmtDate = (t: number) => new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

  const event = $derived(match.event);
  const predicted = $derived(!!event && event.ms > Date.now());
  const target = $derived(event ? (ui.searchIndex.find((e) => e.id === event.target)?.name ?? event.target) : '');
</script>

<span class="text">
  <span class="name">{match.name}</span>
  {#if event}
    <span class="kind event" style:--c={KIND_COLOR[event.kind]}>
      <span class="dot" class:predicted aria-hidden="true"></span>
      <span class="tag">{predicted ? 'Predicted' : match.kind}</span> · {target}
    </span>
  {:else if match.color}
    <span class="kind" style:--c={match.color}>
      <span class="dot" aria-hidden="true"></span>{match.detail ?? match.kind}
    </span>
  {:else}
    <span class="kind">{match.detail ?? match.kind}</span>
  {/if}
</span>
{#if event}
  <span class="meta">{fmtDate(event.ms)}</span>
{:else if dist !== null}
  <span class="meta">{formatDistanceShort(dist)}</span>
{/if}

<style>
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
  :global(.current) > .text .name {
    color: var(--accent);
  }
  .kind {
    color: var(--muted);
    font-size: 11px;
  }
  .tag {
    color: var(--c);
  }
  /* Past landmarks are filled and predicted ones are rings, as on the timeline. */
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 3px;
    border-radius: 50%;
    background: var(--c);
    vertical-align: 0;
  }
  .dot.predicted {
    background: none;
    box-shadow: inset 0 0 0 1.5px var(--c);
  }
  .meta {
    flex-shrink: 0;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  :global(.active) > .meta {
    color: var(--text);
  }
</style>

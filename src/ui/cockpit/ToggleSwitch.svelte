<script lang="ts">
  import { sfx } from '../state.svelte.ts';
  import { hardware } from './physical.ts';

  // A bat toggle switch (up is on) on a hex nut. With `guard`, two steel
  // rails stand either side of it, as round the switches that matter in a
  // spacecraft, and a lamp under it shows the state. With `onText` and
  // `offText`, those are engraved above and below it instead of the label.

  let {
    label,
    on,
    onchange,
    guard = false,
    ariaLabel,
    onText,
    offText,
  }: {
    label: string;
    on: boolean;
    onchange: (on: boolean) => void;
    guard?: boolean;
    ariaLabel?: string;
    onText?: string;
    offText?: string;
  } = $props();
</script>

<button
  class="sw"
  class:on
  class:guard
  class:marked={!!onText}
  use:hardware
  role="switch"
  aria-checked={on}
  aria-label={ariaLabel ?? label}
  onclick={() => {
    sfx.play('clack');
    onchange(!on);
  }}
>
  {#if onText}
    <span class="mic pos run" aria-hidden="true">{onText}</span>
  {:else}
    <span class="eg">{label}</span>
  {/if}
  <svg viewBox="0 0 36 60" aria-hidden="true">
    {#if guard}<use href="#ck-guard" width="36" height="60" />{/if}
    <use href="#ck-nutplate" width="36" height="60" />
    <g class="bat"><use href="#ck-bat" width="36" height="60" /></g>
  </svg>
  {#if offText}
    <span class="mic pos hold" aria-hidden="true">{offText}</span>
  {:else}
    <i class="tb" aria-hidden="true"></i>
  {/if}
</button>

<style>
  .sw {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .sw:focus-visible {
    outline: 2px solid var(--accent-dim);
    outline-offset: 3px;
    border-radius: 4px;
  }
  .guard .eg {
    letter-spacing: 0.06em;
  }
  svg {
    display: block;
    width: 36px;
    height: 60px;
    border-radius: 3px;
    background: linear-gradient(180deg, #0a0d12, #07090c);
  }
  .marked svg {
    width: 28px;
    height: 46px;
    background: none;
  }
  /* The bat pivots at the nut, thrown up (on) or down. */
  .bat {
    transform-origin: 18px 32px;
    transform: scaleY(-1);
    transition: transform 0.09s cubic-bezier(0.5, 0, 0.3, 1.4);
  }
  .on .bat {
    transform: none;
  }
  .sw:hover .bat {
    filter: brightness(1.15);
  }
  .tb {
    width: 16px;
    height: 3px;
    border-radius: 1px;
    background: #1b1f27;
    box-shadow: inset 0 1px 1px #000;
  }
  .on .tb {
    background: var(--accent);
    box-shadow: var(--glow-a);
  }
  .sw .pos {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--engrave);
  }
  .on .run {
    color: var(--go);
  }
  .run::before {
    content: '';
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #1b1f27;
  }
  .on .run::before {
    background: var(--go);
    box-shadow: 0 0 5px var(--go);
  }
  .sw:not(.on) .hold {
    color: var(--muted);
  }
  @media (max-width: 1179px) {
    .marked svg {
      width: 22px;
      height: 36px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bat {
      transition: none;
    }
  }
</style>

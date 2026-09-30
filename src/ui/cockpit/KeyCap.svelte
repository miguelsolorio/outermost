<script lang="ts">
  import { sfx } from '../state.svelte.ts';
  import { hardware } from './physical.ts';

  // A flat key with a backlit legend: it sinks when pressed and glows brighter
  // while its function is on.

  let {
    label,
    onpress,
    tone = 'plain',
    lit = false,
    title,
    ariaLabel,
  }: {
    label: string;
    onpress: () => void;
    tone?: 'plain' | 'stop' | 'warn';
    lit?: boolean;
    title?: string;
    ariaLabel?: string;
  } = $props();
</script>

<button
  class="key {tone}"
  class:lit
  use:hardware
  {title}
  aria-label={ariaLabel}
  aria-pressed={tone === 'plain' && lit ? true : undefined}
  onclick={() => {
    sfx.play('key');
    onpress();
  }}
>
  {label}
</button>

<style>
  .key {
    --c: 143 184 255;
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: 24px;
    padding: 0 10px;
    border: 0;
    border-radius: 3px;
    font: 600 10px/1 Inter, system-ui, sans-serif;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgb(var(--c));
    text-shadow:
      0 0 5px rgb(var(--c) / 0.6),
      0 0 1px rgb(var(--c) / 0.9);
    background:
      radial-gradient(70% 80% at 50% 50%, rgb(var(--c) / 0.07), transparent 70%),
      linear-gradient(180deg, #1e232c, #161a21);
    box-shadow:
      0 0 0 1px #020305,
      inset 0 1px 0 rgb(255 255 255 / 0.1),
      inset 0 0 0 1px rgb(255 255 255 / 0.025),
      0 2px 0 #020305,
      0 3px 5px rgb(0 0 0 / 0.55);
    cursor: pointer;
    transition:
      transform 0.06s,
      box-shadow 0.06s;
  }
  .key:hover {
    background:
      radial-gradient(70% 80% at 50% 50%, rgb(var(--c) / 0.13), transparent 70%),
      linear-gradient(180deg, #20252e, #181c23);
  }
  .key:active {
    transform: translateY(1px);
    box-shadow:
      0 0 0 1px #020305,
      inset 0 1px 0 rgb(255 255 255 / 0.06),
      0 1px 0 #020305;
  }
  .key:focus-visible {
    outline: 2px solid var(--accent-dim);
    outline-offset: 2px;
  }
  .lit {
    background:
      radial-gradient(80% 90% at 50% 50%, rgb(var(--c) / 0.22), rgb(var(--c) / 0.06)),
      linear-gradient(180deg, #1e232c, #161a21);
    box-shadow:
      0 0 0 1px #020305,
      inset 0 0 0 1px rgb(var(--c) / 0.45),
      0 2px 0 #020305,
      0 0 10px rgb(var(--c) / 0.2);
  }
  .stop {
    --c: 255 107 107;
    box-shadow:
      0 0 0 1px #020305,
      inset 0 0 0 1px rgb(255 107 107 / 0.32),
      inset 0 1px 0 rgb(255 255 255 / 0.1),
      0 2px 0 #020305,
      0 3px 5px rgb(0 0 0 / 0.55);
  }
  .warn {
    --c: 255 196 107;
  }
</style>

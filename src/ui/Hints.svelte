<script lang="ts">
  import { onMount } from 'svelte';

  // First-visit navigation hints; they fade once the controls have been tried.
  const KEY = 'hints-seen-v1';
  let show = $state(false);
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

  const items = touch
    ? [
        ['Pinch', 'zoom from Earth to the edge of the universe'],
        ['Drag', 'orbit'],
        ['Double-tap', 'fly to anything'],
      ]
    : [
        ['Scroll', 'zoom from Earth to the edge of the universe · hold Space to fly through'],
        ['Drag', 'orbit · Shift-drag to tilt · Space-drag to pan'],
        ['Double-click', `fly to anything · ${mod} to search`],
      ];

  function dismiss() {
    show = false;
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // storage unavailable
    }
  }

  onMount(() => {
    try {
      if (localStorage.getItem(KEY)) return;
    } catch {
      // storage unavailable: show anyway
    }
    show = true;
    let n = 0;
    const onUse = () => {
      if (++n >= 6) dismiss();
    };
    window.addEventListener('wheel', onUse, { passive: true });
    window.addEventListener('pointerdown', onUse);
    const t = setTimeout(dismiss, 15_000);
    return () => {
      clearTimeout(t);
      window.removeEventListener('wheel', onUse);
      window.removeEventListener('pointerdown', onUse);
    };
  });
</script>

{#if show}
  <div class="hints" role="note">
    {#each items as [k, v] (k)}
      <div class="hint"><span class="k">{k}</span><span class="v">{v}</span></div>
    {/each}
    <button class="x" onclick={dismiss} aria-label="Dismiss hints">×</button>
  </div>
{/if}

<style>
  .hints {
    position: fixed;
    left: 50%;
    /* Clear of the timeline and the landmark name above its date. */
    bottom: 150px;
    transform: translateX(-50%);
    display: flex;
    gap: 18px;
    align-items: center;
    padding: 8px 12px 8px 16px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    backdrop-filter: blur(12px);
    font-size: 12px;
    pointer-events: auto;
    animation: in 0.8s ease-out both;
    white-space: nowrap;
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
  }
  .hint {
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .k {
    font-weight: 600;
  }
  .v {
    color: var(--muted);
  }
  .x {
    border: none;
    background: none;
    color: var(--muted);
    font-size: 16px;
    cursor: pointer;
    padding: 0 2px;
  }
  @media (max-width: 760px) {
    .hints {
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      bottom: 150px;
      white-space: normal;
      width: max-content;
      max-width: calc(100vw - 32px);
    }
    .x {
      position: absolute;
      top: 6px;
      right: 8px;
    }
  }
</style>

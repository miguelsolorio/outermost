<script lang="ts">
  import { pilot, sfx } from '../state.svelte.ts';
  import { hardware } from './physical.ts';

  // The striped eject handle: leave the cockpit for the orbit view. A pointer
  // has to hold it for half a second or pull it down, so a stray click
  // doesn't; Enter or Space fires it at once.

  let held = $state(false);
  let y0 = 0;
  let timer = 0;

  function fire() {
    if (!held) return;
    held = false;
    clearTimeout(timer);
    sfx.play('eject');
    pilot.eject();
  }

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    held = true;
    y0 = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    sfx.play('cover');
    timer = window.setTimeout(fire, 550);
  }

  function move(e: PointerEvent) {
    if (held && e.clientY - y0 > 36) fire();
  }

  function up() {
    held = false;
    clearTimeout(timer);
  }
</script>

<button
  class="eject"
  class:held
  use:hardware
  title="Eject: back to the orbit view (V). Hold or pull."
  aria-label="Eject: leave the cockpit"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onclick={(e) => {
    // Keyboard presses fire at once; a pointer has to hold or pull.
    if (e.detail === 0) {
      held = true;
      fire();
    }
  }}
>
  <span class="frame" aria-hidden="true">
    <span class="pit">
      <!-- A D-ring on two steel legs that run up out of a mounting block. -->
      <svg class="ring" viewBox="0 -300 44 364" preserveAspectRatio="xMidYMax slice">
        <path d="M11-300V51a6 6 0 0 0 6 6h10a6 6 0 0 0 6-6V-300" transform="translate(1.5 3)" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="7" />
        <path d="M11-300V51a6 6 0 0 0 6 6h10a6 6 0 0 0 6-6V-300" fill="none" stroke="url(#ck-steel)" stroke-width="5" />
        <rect x="6" y="50.5" width="32" height="13" rx="6.5" fill="url(#ck-red)" />
        <path d="M10 57h24" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="13" stroke-dasharray=".9 1.7" />
        <path d="M11 51.5h22" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1" stroke-linecap="round" />
      </svg>
      <span class="mount"></span>
      <span class="fill"></span>
    </span>
  </span>
  <span class="eg"><span class="hold">Hold or{' '}</span>pull</span>
</button>

<style>
  .eject {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    cursor: grab;
  }
  .eject.held {
    cursor: grabbing;
  }
  .eject:focus-visible {
    outline: 2px solid var(--accent-dim);
    outline-offset: 2px;
    border-radius: 4px;
  }
  /* Thin hazard striping round a recessed well. */
  .frame {
    flex: 1;
    min-height: 0;
    display: flex;
    padding: 3px;
    border-radius: 4px;
    background: repeating-linear-gradient(-45deg, rgb(255 107 107 / 0.78) 0 1.5px, #14171d 1.5px 5px);
    box-shadow:
      0 0 0 1px #020305,
      0 1px 0 1px rgb(255 255 255 / 0.05);
  }
  .pit {
    position: relative;
    overflow: hidden;
    flex: 1;
    border-radius: 2px;
    background: radial-gradient(130% 60% at 50% 0, #11151d, #05070a);
    box-shadow:
      inset 0 2px 5px #000,
      inset 0 0 0 1px #000;
  }
  .ring {
    position: absolute;
    left: 2px;
    right: 2px;
    bottom: 5px;
    width: calc(100% - 4px);
    height: calc(100% - 5px);
    transition: transform 0.12s;
  }
  .held .ring {
    transform: translateY(7px);
  }
  .mount {
    position: absolute;
    left: 4px;
    right: 4px;
    top: 6px;
    height: 10px;
    border-radius: 2px;
    background:
      radial-gradient(circle at 5px 50%, #07090c 0 1.3px, transparent 1.6px),
      radial-gradient(circle at calc(100% - 5px) 50%, #07090c 0 1.3px, transparent 1.6px),
      var(--metal);
    box-shadow: var(--metal-sh);
  }
  /* How long the hold has left. */
  .fill {
    position: absolute;
    left: 4px;
    right: 4px;
    bottom: 3px;
    height: 2px;
    border-radius: 1px;
    background: var(--alert);
    box-shadow: 0 0 6px rgb(255 107 107 / 0.7);
    transform: scaleX(0);
    transform-origin: 0 50%;
  }
  .held .fill {
    transform: scaleX(1);
    transition: transform 0.55s linear;
  }
  .eject .eg {
    white-space: normal;
    text-wrap: balance;
  }
  /* Narrow, just the verb. */
  @media (max-width: 1179px) {
    .hold {
      display: none;
    }
  }
</style>

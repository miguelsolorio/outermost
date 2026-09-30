<script lang="ts">
  import { pilot, sfx, ui } from '../state.svelte.ts';
  import { hardware } from './physical.ts';

  // The engage lever: a steel T-handle you pull down to send the autopilot
  // to what's selected (and push back up to let it go). Its ARMED lamp and
  // the destination light up once there's somewhere to go.

  const r = $derived(ui.ship);
  const engaged = $derived(!!r?.servo);
  const dest = $derived(r?.selected ?? null);
  const armed = $derived(!!dest && !engaged);

  function throw_() {
    if (engaged) {
      sfx.play('clunk');
      pilot.disengage();
      return;
    }
    if (!armed) {
      sfx.play('tick');
      return;
    }
    sfx.play('engage');
    pilot.kick();
    pilot.engage();
  }
</script>

<button
  class="engage"
  class:armed
  class:engaged
  use:hardware
  aria-pressed={engaged}
  aria-disabled={!armed && !engaged}
  aria-label={engaged ? 'Disengage the autopilot' : dest ? `Engage the autopilot to ${dest}` : 'Engage the autopilot (select a destination first)'}
  title={engaged ? 'Disengage the autopilot' : dest ? `Engage: fly to ${dest}` : 'Engage: select a destination first'}
  onclick={throw_}
>
  <span class="lamp" class:on={armed || engaged} aria-hidden="true">Armed</span>
  <span class="well glass dest" aria-hidden="true"><b>{dest ?? '· · ·'}</b></span>
  <span class="track" aria-hidden="true"><i class="slot"></i><i class="th"></i></span>
  <span class="eg" aria-hidden="true">{engaged ? 'Push ▴' : 'Pull ▾'}</span>
</button>

<style>
  /* The whole module face is the control; the T-handle rides down an amber-lit slot. */
  .engage {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    cursor: s-resize;
  }
  .engaged {
    cursor: n-resize;
  }
  .engage[aria-disabled='true'] {
    cursor: default;
  }
  .engage:focus-visible {
    outline: 2px solid var(--accent-dim);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .engage .lamp {
    --c: 255 196 107;
    flex: none;
    height: 18px;
  }
  .armed .lamp {
    animation: armed 1.6s ease-in-out infinite;
  }
  @keyframes armed {
    50% {
      opacity: 0.6;
    }
  }
  .dest {
    flex: none;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
  }
  .dest b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 600 10.5px/1 var(--mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #434c5d;
  }
  .armed .dest b,
  .engaged .dest b {
    color: var(--warn);
    text-shadow: 0 0 6px rgb(255 196 107 / 0.45);
  }
  .track {
    position: relative;
    flex: 1;
    min-height: 48px;
  }
  /* A base line to pull to, and a scale beside the slot. */
  .track::before {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 10px;
    width: 30px;
    height: 1px;
    margin-left: -15px;
    background: var(--engrave);
    box-shadow: 0 1px 0 #000;
  }
  .track::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 26px;
    bottom: 18px;
    width: 1px;
    margin-left: 10px;
    background: repeating-linear-gradient(180deg, rgb(125 135 154 / 0.55) 0 1px, transparent 1px 8px);
  }
  .slot {
    position: absolute;
    left: 50%;
    top: 8px;
    bottom: 4px;
    width: 8px;
    margin-left: -4px;
    border-radius: 4px;
    background: #020305;
    box-shadow:
      inset 0 2px 3px #000,
      inset 0 0 0 1px #000,
      0 1px 0 rgb(255 255 255 / 0.07);
  }
  .armed .slot,
  .engaged .slot {
    background:
      linear-gradient(180deg, rgb(255 196 107 / 0.34), rgb(255 196 107 / 0.1) 45%, rgb(255 196 107 / 0.03) 85%),
      #020305;
  }
  /* The T-handle: a knurled steel bar on a stem, up at rest and pulled down once engaged. */
  .th {
    position: absolute;
    z-index: 1;
    left: 50%;
    top: 0;
    width: 56px;
    max-width: 100%;
    height: 18px;
    border-radius: 9px;
    transform: translateX(-50%);
    background:
      repeating-linear-gradient(90deg, rgb(0 0 0 / 0.32) 0 1px, rgb(255 255 255 / 0.05) 1px 2px, transparent 2px 3px) 50% 50% / 56% 100% no-repeat,
      var(--metal);
    box-shadow: var(--metal-sh);
    transition: top 0.22s cubic-bezier(0.4, 0, 0.2, 1.3);
  }
  .th::after {
    content: '';
    position: absolute;
    z-index: -1;
    left: 50%;
    top: 12px;
    width: 8px;
    height: 12px;
    margin-left: -4px;
    background: linear-gradient(90deg, #16191e, #7a818c 45%, #2a2f37);
    box-shadow: 0 4px 4px rgb(0 0 0 / 0.6);
  }
  .engaged .th {
    top: calc(100% - 30px);
  }
  .engage:not([aria-disabled='true']):hover .th {
    filter: brightness(1.12);
  }
  .engaged .eg,
  .armed .eg {
    color: var(--warn);
  }
  @media (prefers-reduced-motion: reduce) {
    .th {
      transition: none;
    }
    .armed .lamp {
      animation: none;
    }
  }
</style>

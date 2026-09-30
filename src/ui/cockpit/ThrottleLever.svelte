<script lang="ts">
  import { onMount } from 'svelte';
  import { LEVER_DETENTS, leverDetent, leverDrift, leverPos } from '../../engine/instruments.ts';
  import { pilot, sfx, ui } from '../state.svelte.ts';
  import { follow, onFrame } from './frame.ts';
  import { hardware } from './physical.ts';

  // The throttle: a lever that stays where it's set, like cruise control.
  // Its travel has detents at reverse, stop, fine, cruise and boost. While the
  // autopilot flies, a servo drives it to the autopilot's speed, and when the
  // autopilot lets go it slides home to stop. The needle on the scale
  // beside the gate is the ship's actual forward drift, spooling up to the setting.

  let slot: HTMLDivElement;
  let handle: HTMLDivElement;
  let needle: HTMLDivElement;
  let travel = $state(120);
  /** Shown position (0..1), eased toward the lever's. */
  let shown = leverPos(0);
  /** Position while dragged. */
  let held: number | null = null;
  let dragging = false;
  let grab = 0;
  let detent: string | null = 'Stop';
  let wasServo = false;

  const r = $derived(ui.ship);
  const lit = $derived.by(() => {
    if (!r) return null;
    const d = leverDetent(leverPos(r.servo ? r.drive : r.lever));
    return d && Math.abs(d.drift - (r.servo ? r.drive : r.lever)) < 1e-6 + 0.02 * Math.abs(d.drift) ? d.name : null;
  });
  const valueText = $derived.by(() => {
    if (!r) return '';
    if (r.servo) return `Autopilot, ${r.drive.toFixed(1)} × cruise`;
    const d = LEVER_DETENTS.find((x) => Math.abs(x.drift - r.lever) < 1e-9);
    if (d) return d.name === 'Rev' ? 'Reverse' : d.name;
    return `${r.lever.toFixed(2)} × cruise`;
  });

  const y = (p: number) => (1 - p) * travel;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));

  function posAt(clientY: number): number {
    const b = slot.getBoundingClientRect();
    return 1 - (clientY - b.top) / Math.max(b.height, 1);
  }

  /** Move the lever to `p`, dropping into a detent near one. */
  function set(p: number) {
    const d = leverDetent(clamp(p));
    const at = d ? d.pos : clamp(p);
    held = at;
    const name = d?.name ?? null;
    if (name && name !== detent) sfx.play(name === 'Stop' || name === 'Boost' ? 'thunk' : 'tick');
    detent = name;
    pilot.setLever(leverDrift(at));
  }

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    const p = leverPos(pilot.takeLever());
    const at = posAt(e.clientY);
    // Taking the handle keeps it under the pointer; a press on the slot moves it there.
    grab = handle.contains(e.target as Node) ? p - at : 0;
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    sfx.play('clunk');
    set(at + grab);
  }

  function move(e: PointerEvent) {
    if (dragging) set(posAt(e.clientY) + grab);
  }

  function up() {
    dragging = false;
    held = null;
  }

  function key(e: KeyboardEvent) {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) return;
    const stops = LEVER_DETENTS.map((d) => d.pos as number);
    let p: number;
    // The live lever (the readout lags); taking it from the autopilot keeps its speed.
    const cur = leverPos(pilot.takeLever());
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        p = cur + 0.05;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        p = cur - 0.05;
        break;
      case 'PageUp':
        p = stops.find((x) => x > cur + 1e-6) ?? 1;
        break;
      case 'PageDown':
        p = [...stops].reverse().find((x) => x < cur - 1e-6) ?? 0;
        break;
      case 'Home':
        p = 0;
        break;
      case 'End':
        p = 1;
        break;
      default:
        return;
    }
    // Arrows here move the lever, not the ship.
    e.preventDefault();
    e.stopPropagation();
    set(p);
    held = null;
  }

  onMount(() =>
    onFrame((_f, g, dt) => {
      const drive = Math.max(-1, Math.min(4, g.drive));
      const target = held ?? leverPos(g.servo ? drive : g.lever);
      if (wasServo && !g.servo && Math.abs(target - shown) > 0.05) sfx.play('servo');
      wasServo = g.servo;
      shown = held !== null ? target : follow(shown, target, dt, g.servo ? 0.2 : 0.07);
      if (held === null) detent = leverDetent(target)?.name ?? null;
      handle.style.transform = `translateY(${y(shown).toFixed(1)}px)`;
      needle.style.transform = `translateY(${y(leverPos(drive)).toFixed(1)}px)`;
    }),
  );
</script>

<div
  class="throttle"
  class:servo={r?.servo}
  use:hardware
  role="slider"
  tabindex="0"
  aria-label="Throttle"
  aria-orientation="vertical"
  aria-valuemin={-1}
  aria-valuemax={4}
  aria-valuenow={r ? +(r.servo ? r.drive : r.lever).toFixed(2) : 0}
  aria-valuetext={valueText}
  title="Throttle: holds its speed. W/S add to it, X stops."
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onkeydown={key}
>
  <div class="track" bind:this={slot} bind:clientHeight={travel}>
    <i class="gate" aria-hidden="true"></i>
    <i class="slot" aria-hidden="true"></i>
    {#each LEVER_DETENTS as d (d.name)}
      <span class="dl" class:on={lit === d.name} style:top="{y(d.pos)}px" aria-hidden="true">{d.name}</span>
    {/each}
    <i class="rail" aria-hidden="true"></i>
    <div class="needle" bind:this={needle} title="Actual speed"></div>
    <div class="grip" bind:this={handle}></div>
  </div>
</div>

<style>
  /* A machined lever in a gated track: detents engraved on the left, the
     ship's actual drift on a scale to the right. */
  .throttle {
    position: relative;
    flex: none;
    width: 96px;
    height: 100%;
    padding: 8px 0;
    cursor: ns-resize;
    outline: none;
  }
  .throttle:focus-visible .gate {
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.09),
      0 0 0 1px #030406,
      0 0 0 3px var(--accent-dim);
  }
  .track {
    position: relative;
    height: 100%;
  }
  .gate {
    position: absolute;
    left: 52px;
    width: 20px;
    top: -6px;
    bottom: -6px;
    border-radius: 5px;
    background: linear-gradient(90deg, #171b22, #262b34 50%, #171b22);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.09),
      inset 0 -1px 0 rgb(0 0 0 / 0.5),
      0 0 0 1px #030406,
      0 2px 4px rgb(0 0 0 / 0.5);
  }
  .slot {
    position: absolute;
    left: 58px;
    width: 8px;
    top: 0;
    bottom: 0;
    border-radius: 4px;
    background: #020305;
    box-shadow:
      inset 0 2px 3px #000,
      inset 0 0 0 1px #000,
      0 1px 0 rgb(255 255 255 / 0.07);
  }
  /* Detent legends, each with a tick and a notch cut in the gate. */
  .dl {
    position: absolute;
    right: calc(100% - 42px);
    transform: translateY(-50%);
    font: 600 9.5px/1 Inter, system-ui, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--engrave);
    text-shadow: 0 1px 0 #000;
    transition: color 0.15s;
  }
  .dl::after {
    content: '';
    position: absolute;
    left: calc(100% + 2px);
    top: 50%;
    width: 5px;
    height: 1px;
    background: currentColor;
    opacity: 0.7;
  }
  .dl::before {
    content: '';
    position: absolute;
    left: calc(100% + 11px);
    top: 50%;
    width: 5px;
    height: 6px;
    margin-top: -3px;
    background: #020305;
    box-shadow:
      inset 0 1px 1px #000,
      0 1px 0 rgb(255 255 255 / 0.07);
  }
  .dl.on {
    color: var(--accent);
    text-shadow: var(--glow-a);
  }
  .servo .dl.on {
    color: var(--warn);
    text-shadow: 0 0 6px rgb(255 196 107 / 0.6);
  }
  .rail {
    position: absolute;
    left: 89px;
    width: 5px;
    top: 0;
    bottom: 0;
    background:
      linear-gradient(90deg, rgb(143 184 255 / 0.35) 0 1px, transparent 1px),
      repeating-linear-gradient(0deg, rgb(143 184 255 / 0.28) 0 1px, transparent 1px 10%);
  }
  /* The ship's actual forward drift. */
  .needle {
    position: absolute;
    left: 81px;
    top: -4px;
    width: 0;
    height: 0;
    border: 4px solid transparent;
    border-left: 0;
    border-right: 7px solid var(--text);
    filter: drop-shadow(0 0 3px rgb(232 236 244 / 0.45));
  }
  /* The grip: ribbed machined steel across the gate, with a lit index line. */
  .grip {
    position: absolute;
    left: 46px;
    top: -13px;
    width: 32px;
    height: 26px;
    border-radius: 4px;
    background:
      repeating-linear-gradient(180deg, rgb(0 0 0 / 0.3) 0 1px, rgb(255 255 255 / 0.04) 1px 2px, transparent 2px 3px) 50% 50% / 70% 56% no-repeat,
      var(--metal);
    box-shadow: var(--metal-sh);
    cursor: grab;
  }
  .grip::after {
    content: '';
    position: absolute;
    left: -4px;
    right: -4px;
    top: 50%;
    height: 1px;
    margin-top: -0.5px;
    background: var(--accent);
    box-shadow: var(--glow-a);
  }
  .servo .grip::after {
    background: var(--warn);
    box-shadow: 0 0 6px rgb(255 196 107 / 0.6);
  }
</style>

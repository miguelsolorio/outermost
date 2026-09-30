<script lang="ts">
  import { onMount } from 'svelte';
  import { panelTransform } from '../../engine/cockpit.ts';
  import { formatDistanceShort } from '../../engine/format.ts';
  import { smoothstep, type Vec3 } from '../../astro/vec.ts';
  import { actions, pilot, ui } from '../state.svelte.ts';
  import { onFrame } from './frame.ts';
  import { hardware } from './physical.ts';
  import Annunciators from './Annunciators.svelte';
  import Attitude from './Attitude.svelte';
  import AttitudeReadout from './AttitudeReadout.svelte';
  import EjectHandle from './EjectHandle.svelte';
  import EngageLever from './EngageLever.svelte';
  import Hologram from './Hologram.svelte';
  import KeyCap from './KeyCap.svelte';
  import Radar from './Radar.svelte';
  import SpeedScreen from './SpeedScreen.svelte';
  import ThrottleLever from './ThrottleLever.svelte';
  import TimeBlock from './TimeBlock.svelte';
  import ToggleSwitch from './ToggleSwitch.svelte';

  // The flight console below the windshield: machined modules on a grid, the
  // navigation module raised in the middle. At rest it's laid out flat on
  // the screen; look around and its three panels turn with the canopy as a
  // surface in the ship (a CSS 3D transform per panel, matched to the
  // camera), and it comes a little closer as you look down. On small screens
  // it's a compact console pinned to the screen.

  const DEG = Math.PI / 180;
  /** How far the console runs on below the bottom of the screen, in view heights: seen when you look down. */
  const FLOOR = 0.6;
  let deck = $state<HTMLDivElement>();
  let left = $state<HTMLDivElement>();
  let center = $state<HTMLDivElement>();
  let right = $state<HTMLDivElement>();
  let compact = $state(false);
  let lastKey = '';
  let moved = false;

  const r = $derived(ui.ship);
  const target = $derived(r?.radar.find((c) => c.role === 'target') ?? null);
  const PHASE = { turning: 'Turning toward', cruising: 'Autopilot to', arriving: 'Arriving at', facing: 'Turning to face' } as const;

  function still() {
    for (const el of [left, center, right]) {
      if (!el) continue;
      el.style.transform = '';
      el.style.opacity = '';
      el.style.visibility = '';
    }
  }

  onMount(() => {
    const mq = matchMedia('(max-width: 900px)');
    const sync = () => {
      compact = mq.matches;
      still();
      lastKey = '';
    };
    sync();
    mq.addEventListener('change', sync);
    const off = onFrame((f) => {
      if (compact || f.rest || !deck) {
        if (moved) still();
        moved = false;
        lastKey = '';
        return;
      }
      // Looking down, lean in: the console comes a little closer.
      const down = -Math.asin(Math.max(-1, Math.min(1, f.head[7])));
      const k = smoothstep(0, 1, down / (60 * DEG));
      const eye: Vec3 = [0, -0.05 * f.focal * k, 0.1 * f.focal * k];
      const key = `${f.head.map((v) => v.toFixed(5)).join()},${f.w},${f.h}`;
      if (key === lastKey) return;
      lastKey = key;
      moved = true;
      for (const el of [left, center, right]) {
        if (!el) continue;
        // The panel runs on below the screen's edge (its ::after), to the cabin floor.
        const rect = { x: deck.offsetLeft + el.offsetLeft, y: deck.offsetTop + el.offsetTop, w: el.offsetWidth, h: el.offsetHeight + FLOOR * f.h };
        const t = panelTransform(rect, f.head, eye, f.w, f.h, f.focal);
        // Fade a panel out before any corner nears the eye's plane.
        const a = smoothstep(0.2, 0.35, t.depth);
        el.style.transform = t.matrix;
        el.style.opacity = a < 1 ? a.toFixed(3) : '';
        el.style.visibility = a <= 0.001 ? 'hidden' : '';
      }
    });
    return () => {
      off();
      mq.removeEventListener('change', sync);
    };
  });
</script>

{#snippet status()}
  <span class="st">
    <i class="dot" class:auto={!!r?.autopilot}></i>
    {#if r?.autopilot}
      {PHASE[r.autopilot.phase]} <b>{r.autopilot.name}</b>
    {:else if r?.holding}
      Holding with <b>{r.holding}</b>
    {:else if r}
      Moving with <b>{r.frame}</b>
    {/if}
  </span>
{/snippet}

{#snippet message()}
  <div class="well msg" aria-live="polite">
    {@render status()}
    {#if r?.autopilot && r.autopilot.phase !== 'facing'}
      <span class="tgt"><span class="mic">Dist</span><span class="n">{formatDistanceShort(r.autopilot.distance)}</span><span class="mic">ETA</span><span class="n">{Math.max(1, Math.round(r.autopilot.eta))} s</span></span>
    {:else if target}
      <span class="tgt"><span class="mic">Target</span><b class="amb">{target.name}</b><span class="n">{formatDistanceShort(target.distance)}</span></span>
    {/if}
  </div>
{/snippet}

<div class="cabin" aria-label="Flight console" role="group">
  <!-- The console's materials: steel, the attitude ball's sky and ground, the hologram's day side. -->
  <svg class="defs" width="0" height="0" aria-hidden="true">
    <defs>
      <linearGradient id="ck-steel" x1="0" x2="1"><stop offset="0" stop-color="#23272e" /><stop offset=".42" stop-color="#9097a2" /><stop offset=".58" stop-color="#5a616c" /><stop offset="1" stop-color="#1b1e24" /></linearGradient>
      <linearGradient id="ck-lever" x1="0" x2="1"><stop offset="0" stop-color="#454b55" /><stop offset=".38" stop-color="#e4e8ee" /><stop offset=".62" stop-color="#8c939e" /><stop offset="1" stop-color="#353a42" /></linearGradient>
      <radialGradient id="ck-tip" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#f6f8fa" /><stop offset=".55" stop-color="#9aa1ac" /><stop offset="1" stop-color="#3e434c" /></radialGradient>
      <radialGradient id="ck-nut" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#737a86" /><stop offset="1" stop-color="#171a20" /></radialGradient>
      <linearGradient id="ck-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f08080" /><stop offset=".45" stop-color="#b8444a" /><stop offset="1" stop-color="#3a1214" /></linearGradient>
      <linearGradient id="ck-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a2842" /><stop offset="1" stop-color="#22334f" /></linearGradient>
      <linearGradient id="ck-gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1017" /><stop offset="1" stop-color="#050609" /></linearGradient>
      <radialGradient id="ck-shade" r=".5"><stop offset=".5" stop-color="#000" stop-opacity="0" /><stop offset="1" stop-color="#000" stop-opacity=".72" /></radialGradient>
      <radialGradient id="ck-day" cx=".85" cy=".45" r=".85"><stop offset="0" stop-color="#8fb8ff" stop-opacity=".5" /><stop offset=".5" stop-color="#8fb8ff" stop-opacity=".12" /><stop offset=".64" stop-color="#8fb8ff" stop-opacity="0" /></radialGradient>
      <linearGradient id="ck-sweep" x1=".85" y1="0" x2="0" y2=".85"><stop offset="0" stop-color="#8fb8ff" stop-opacity=".22" /><stop offset="1" stop-color="#8fb8ff" stop-opacity="0" /></linearGradient>
      <linearGradient id="ck-trace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fb8ff" stop-opacity=".3" /><stop offset="1" stop-color="#8fb8ff" stop-opacity="0" /></linearGradient>
      <!-- A guard: two machined rails either side of a switch. -->
      <symbol id="ck-guard" viewBox="0 0 36 60">
        <rect x="2.5" y="6" width="4.5" height="50" rx="2.2" fill="#000" opacity=".5" />
        <rect x="30.5" y="6" width="4.5" height="50" rx="2.2" fill="#000" opacity=".5" />
        <rect x="1.5" y="4" width="4.5" height="50" rx="2.2" fill="url(#ck-steel)" stroke="#030406" stroke-width=".5" />
        <rect x="30" y="4" width="4.5" height="50" rx="2.2" fill="url(#ck-steel)" stroke="#030406" stroke-width=".5" />
        <g fill="#07090c"><circle cx="3.75" cy="7.5" r=".9" /><circle cx="3.75" cy="50.5" r=".9" /><circle cx="32.25" cy="7.5" r=".9" /><circle cx="32.25" cy="50.5" r=".9" /></g>
      </symbol>
      <!-- A bat-handle toggle, thrown up; flipped for down. -->
      <symbol id="ck-bat" viewBox="0 0 36 60">
        <path d="M16.1 32 14.5 10.5h7L19.9 32Z" fill="url(#ck-lever)" />
        <ellipse cx="18" cy="10.5" rx="4.3" ry="2.7" fill="url(#ck-tip)" />
      </symbol>
      <symbol id="ck-nutplate" viewBox="0 0 36 60">
        <ellipse cx="19.5" cy="35" rx="6.5" ry="3" fill="#000" opacity=".55" />
        <polygon points="18,24 24.9,28 24.9,36 18,40 11.1,36 11.1,28" fill="url(#ck-nut)" stroke="#020305" stroke-width=".6" />
        <circle cx="18" cy="32" r="4.4" fill="#14171c" stroke="#5f6672" stroke-width=".6" />
      </symbol>
    </defs>
  </svg>

  {#if compact}
    <div class="deck compact" bind:this={deck}>
      <div class="panel shell solo" use:hardware>
        <div class="mod bay"><ThrottleLever /></div>
        <div class="mid">
          <div class="well glass adi-mini"><Attitude mini /></div>
          {@render message()}
          <div class="row">
            <KeyCap label="Stop" tone="stop" title="All stop (X)" onpress={() => pilot.stop()} />
            <KeyCap label="Time" lit={ui.timeOpen} ariaLabel="Timeline" onpress={() => (ui.timeOpen = !ui.timeOpen)} />
            <div class="ej-mini"><EjectHandle /></div>
          </div>
        </div>
        <div class="mod bay"><EngageLever /></div>
      </div>
    </div>
  {:else}
    <div class="deck" bind:this={deck}>
      <div class="panel shell wing left" bind:this={left} use:hardware>
        <section class="mod ej" aria-label="Eject">
          <h3 class="red">Eject</h3>
          <EjectHandle />
        </section>
        <section class="mod near" aria-label="Nearest body">
          <h3>Nearest</h3>
          <div class="well holo"><Hologram /></div>
        </section>
        <section class="mod fl" aria-label="Flight">
          <h3>Flight</h3>
          <div class="fl-row">
            <div class="well glass spd"><SpeedScreen /></div>
            <ThrottleLever />
          </div>
        </section>
      </div>
      <div class="panel center" bind:this={center} use:hardware>
        <div class="bezel">
          <section class="mod nav" aria-label="Navigation">
            <div class="well anns"><Annunciators /></div>
            <div class="inst">
              <div class="well glass ball"><span class="mic tl">Att</span><Attitude /></div>
              <AttitudeReadout />
              <div class="well glass rad"><Radar /></div>
            </div>
            {@render message()}
          </section>
        </div>
      </div>
      <div class="panel shell wing right" bind:this={right} use:hardware>
        <section class="mod eng" aria-label="Engage">
          <h3>Engage</h3>
          <EngageLever />
        </section>
        <section class="mod time" aria-label="Time">
          <h3>Time</h3>
          <TimeBlock />
        </section>
        <section class="mod sys" aria-label="Systems">
          <h3>Systems</h3>
          <div class="tgs">
            <ToggleSwitch label="Labels" guard on={ui.settings.labels} onchange={() => actions.toggle('labels')} />
            <ToggleSwitch label="Orbits" guard on={ui.settings.orbits} onchange={() => actions.toggle('orbits')} />
            <ToggleSwitch label="Stars" ariaLabel="Constellations" guard on={ui.settings.constellations} onchange={() => actions.toggle('constellations')} />
            <ToggleSwitch label="Sound" guard on={ui.soundOn} onchange={(on) => actions.setSound(on)} />
          </div>
          <div class="keys">
            <KeyCap label="Stop" tone="stop" title="All stop (X)" onpress={() => pilot.stop()} />
            <KeyCap label="Level" title="Level the wings (L)" onpress={() => pilot.level()} />
            <KeyCap label="Face" title="Face the selection (C)" onpress={() => pilot.face()} />
            <KeyCap label="HUD" title="Hide the cockpit (H)" onpress={() => (ui.hudHidden = true)} />
          </div>
        </section>
      </div>
    </div>
  {/if}
</div>

<style>
  /* The perspective the panels are seen through when you look around: the camera's own. */
  .cabin {
    /* Materials. */
    --engrave: #7d879a;
    --glow-a: 0 0 6px rgb(143 184 255 / 0.55);
    --metal: linear-gradient(180deg, #6f7682 0%, #40464f 34%, #262a32 66%, #171a20 100%);
    --metal-sh: inset 0 1px 0 rgb(255 255 255 / 0.4), inset 0 -1px 0 rgb(0 0 0 / 0.6), 0 0 0 1px #020305, 0 7px 9px rgb(0 0 0 / 0.6), 0 1px 2px rgb(0 0 0 / 0.8);
    --screw: #6a7280 0 0.8px, #262b33 1.3px 1.8px, #030407 2.2px 2.7px, transparent 3.1px;
    /* The grid: outer margin, gutter, module padding, the deck's top and bottom, and how far the center rises. */
    --m: 16px;
    --g: 8px;
    --pad: 12px;
    --dt: 14px;
    --db: 10px;
    --rise: 43px;
    --gn: 8px;
    --anns: 24px;
    --msg: 26px;
    /* Module widths, the same in total either side so the navigation module sits on the center line; it
       sizes to what's left and to the console's height, and the left wing's modules take up any slack. */
    --w-ej: 76px;
    --w-near: 112px;
    --w-fl: 250px;
    --w-eng: 80px;
    --w-time: 172px;
    --w-sys: 186px;
    --nd: 92px;
    --ball-h: calc(var(--console-h, 259px) - var(--dt) - var(--db) + var(--rise) - 2 * var(--pad) - var(--anns) - var(--msg) - 2 * var(--gn));
    --ball-w: calc((100vw - 2 * var(--m) - 2 * (var(--w-eng) + var(--w-time) + var(--w-sys)) - 6 * var(--g) - var(--nd) - 2 * var(--gn) - 2 * var(--pad)) / 2);
    --ball: max(88px, min(var(--ball-h), var(--ball-w)));
    --w-nav: calc(2 * var(--ball) + var(--nd) + 2 * var(--gn) + 2 * var(--pad));

    position: absolute;
    inset: 0;
    perspective: var(--focal, 1000px);
    perspective-origin: 50% 50%;
    overflow: hidden;
    pointer-events: none;
    font-family: Inter, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .defs {
    position: absolute;
  }
  .deck {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: var(--console-h, 28.7vh);
    display: flex;
    transform-style: preserve-3d;
  }
  .panel {
    position: relative;
    height: 100%;
    transform-origin: 0 0;
    pointer-events: auto;
  }
  /* The console's body: dark metal under a machined top lip. */
  .shell {
    background: linear-gradient(180deg, #11151d 0, #0a0d13 26%, #07090d 100%);
  }
  .shell::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 7px;
    background: linear-gradient(180deg, #2e343f, #1a1e26 45%, #0c0f14);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.16),
      0 1px 0 #020305,
      0 3px 7px rgb(0 0 0 / 0.6);
  }
  /* It runs on below the screen to the floor, out of sight until you look down. */
  .panel::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    height: 60vh;
    background: linear-gradient(#07090d, #040508);
    pointer-events: none;
  }
  .wing {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    gap: var(--g);
  }
  .left {
    justify-content: flex-end;
    padding: var(--dt) calc(var(--g) - 4px) var(--db) var(--m);
  }
  .right {
    padding: var(--dt) var(--m) var(--db) calc(var(--g) - 4px);
  }
  /* The navigation module stands proud of the deck on a raised bezel. */
  .center {
    flex: none;
    margin-top: calc(-1 * var(--rise));
    height: calc(100% + var(--rise));
    padding: calc(var(--dt) - 4px) 0 calc(var(--db) - 4px);
    background: linear-gradient(180deg, #0a0d13, #07090d) 0 100% / 100% calc(100% - var(--rise)) no-repeat;
  }
  .bezel {
    height: 100%;
    padding: 4px;
    border-radius: 9px;
    background: linear-gradient(180deg, #3b424d, #1b1f27 22%, #0f1217);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.18),
      0 0 0 1px #020305,
      0 -4px 14px rgb(0 0 0 / 0.55);
  }

  /* A machined graphite module, screwed down at its corners. */
  .mod {
    position: relative;
    flex: none;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: var(--pad);
    border-radius: 6px;
    background:
      radial-gradient(circle at 6px 6px, var(--screw)),
      radial-gradient(circle at calc(100% - 6px) 6px, var(--screw)),
      radial-gradient(circle at 6px calc(100% - 6px), var(--screw)),
      radial-gradient(circle at calc(100% - 6px) calc(100% - 6px), var(--screw)),
      repeating-linear-gradient(90deg, rgb(255 255 255 / 0.013) 0 1px, transparent 1px 3px),
      linear-gradient(180deg, #1c212a, #161a21 50%, #11141a);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.09),
      inset 1px 0 0 rgb(255 255 255 / 0.03),
      inset -1px 0 0 rgb(0 0 0 / 0.4),
      inset 0 -1px 0 rgb(0 0 0 / 0.6),
      0 0 0 1px #030407,
      0 4px 8px rgb(0 0 0 / 0.5);
  }
  /* Engraved module headers, ruled off to the edge. */
  h3 {
    flex: none;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 10px;
    font: 600 9.5px/1 Inter, system-ui, sans-serif;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--engrave);
    text-shadow: 0 1px 0 #000;
    white-space: nowrap;
  }
  h3::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #06080b;
    box-shadow: 0 1px 0 rgb(255 255 255 / 0.05);
  }
  h3.red {
    color: #c86060;
  }
  .ej {
    width: var(--w-ej);
  }
  .near {
    flex: 1 0 var(--w-near);
    max-width: calc(var(--w-near) + 40px);
  }
  .fl {
    flex: 1 0 var(--w-fl);
    max-width: calc(var(--w-fl) + 72px);
  }
  .eng {
    width: var(--w-eng);
  }
  .time {
    --dial: min(100px, calc(var(--console-h, 259px) - 148px));
    flex: 1 0 var(--w-time);
    max-width: calc(var(--w-time) + 40px);
  }
  .sys {
    flex: 1 0 var(--w-sys);
    max-width: calc(var(--w-sys) + 56px);
  }
  .nav {
    width: var(--w-nav);
    height: 100%;
    gap: var(--gn);
  }

  /* Shared materials for the instruments, kept at the lowest specificity so each component's own rules
     win. A recessed well, and dark glass over it. */
  :global(:where(.cabin) .well) {
    position: relative;
    border-radius: 4px;
    overflow: hidden;
    background: radial-gradient(130% 90% at 50% 0, #0c111b 0, #05070b 70%);
    box-shadow:
      inset 0 2px 4px rgb(0 0 0 / 0.95),
      inset 0 0 0 1px #000,
      inset 0 0 0 2px rgb(143 184 255 / 0.03),
      0 1px 0 rgb(255 255 255 / 0.07);
  }
  :global(:where(.cabin) .glass::after) {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    background:
      linear-gradient(162deg, rgb(255 255 255 / 0.075) 0, rgb(255 255 255 / 0.018) 36%, transparent 36.4%),
      linear-gradient(0deg, rgb(143 184 255 / 0.035), transparent 35%);
  }
  /* Micro-legends on glass, and legends engraved in metal. */
  :global(:where(.cabin) .mic) {
    font: 500 9.5px/1 var(--mono);
    letter-spacing: 0.1em;
    color: rgb(143 184 255 / 0.62);
    text-transform: uppercase;
    white-space: nowrap;
  }
  :global(:where(.cabin) .eg) {
    font: 600 9.5px/1.2 Inter, system-ui, sans-serif;
    letter-spacing: 0.12em;
    color: var(--engrave);
    text-transform: uppercase;
    text-shadow: 0 1px 0 #000;
    text-align: center;
    white-space: nowrap;
  }
  /* A lamp: dark until lit in its color (--c, as r g b). */
  :global(:where(.cabin) .lamp) {
    --c: 143 184 255;
    display: grid;
    place-items: center;
    min-width: 0;
    border-radius: 2px;
    font: 600 9.5px/1 Inter, system-ui, sans-serif;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #434c5d;
    background: linear-gradient(180deg, #0f131a, #090b10);
    box-shadow:
      inset 0 0 0 1px rgb(0 0 0 / 0.9),
      inset 0 1px 0 rgb(255 255 255 / 0.06);
    transition:
      color 0.12s,
      background 0.12s,
      box-shadow 0.12s;
  }
  :global(:where(.cabin) .lamp.on) {
    color: rgb(var(--c));
    text-shadow: 0 0 5px rgb(var(--c) / 0.85);
    background: radial-gradient(90% 150% at 50% 50%, rgb(var(--c) / 0.24), rgb(var(--c) / 0.07));
    box-shadow:
      inset 0 0 0 1px rgb(var(--c) / 0.5),
      inset 0 1px 0 rgb(255 255 255 / 0.08),
      0 0 9px rgb(var(--c) / 0.2);
  }
  :global(:where(.cabin) .amb) {
    color: var(--warn);
    text-shadow: 0 0 6px rgb(255 196 107 / 0.45);
  }

  /* NAV: the lamps, the ball, its readouts and the radar, and the status line. */
  .anns {
    flex: none;
    height: var(--anns);
    padding: 3px;
  }
  .inst {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    gap: var(--gn);
  }
  .ball,
  .rad {
    flex: none;
    width: var(--ball);
    height: var(--ball);
  }
  .tl {
    position: absolute;
    z-index: 1;
    left: 7px;
    top: 7px;
  }
  .msg {
    flex: none;
    height: var(--msg);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 12px;
    font: 500 11.5px/1 Inter, system-ui, sans-serif;
    color: var(--muted);
    white-space: nowrap;
  }
  .msg b {
    color: var(--text);
    font-weight: 600;
  }
  .msg b.amb {
    color: var(--warn);
  }
  .st {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot {
    display: inline-block;
    width: 5px;
    height: 5px;
    margin-right: 8px;
    vertical-align: 1px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: var(--glow-a);
  }
  .dot.auto {
    background: var(--warn);
    box-shadow: 0 0 6px rgb(255 196 107 / 0.6);
  }
  .tgt {
    flex: none;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .n {
    font: 500 11px/1 var(--mono);
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }

  /* NEAREST, FLIGHT */
  .holo {
    flex: 1;
    min-height: 0;
    background:
      repeating-linear-gradient(0deg, rgb(143 184 255 / 0.028) 0 1px, transparent 1px 3px),
      radial-gradient(70% 55% at 50% 42%, rgb(143 184 255 / 0.07), transparent 70%),
      radial-gradient(130% 90% at 50% 0, #0c111b 0, #05070b 70%);
  }
  .fl-row {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 8px;
  }
  .spd {
    flex: 1;
    min-width: 0;
  }

  /* SYSTEMS */
  .tgs {
    flex: none;
    display: flex;
    justify-content: space-between;
    margin-top: 2px;
  }
  .keys {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-auto-rows: minmax(24px, 34px);
    gap: 8px;
    align-content: end;
    padding-top: 12px;
    border-top: 1px solid #06080b;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.04);
  }
  .keys :global(.key) {
    height: 100%;
  }

  /* Compact: one pinned panel with the essentials. */
  .solo {
    flex: 1;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 10px 10px;
  }
  .bay {
    --pad: 8px;
    flex: none;
  }
  .mid {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .adi-mini {
    width: 84px;
    height: 84px;
    flex: none;
  }
  .mid .msg {
    align-self: stretch;
    justify-content: center;
    padding: 0 8px;
  }
  .mid .msg .tgt {
    display: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row :global(.key) {
    height: 34px;
  }
  .ej-mini {
    width: 46px;
    height: 72px;
    display: flex;
    flex-direction: column;
  }

  /* Narrower, the console drops what's also elsewhere: the hologram (the title names the body) and the
     switches (they're in the ☰ menu too). */
  @media (max-width: 1399px) {
    .cabin {
      --w-sys: 96px;
    }
    .near {
      display: none;
    }
    .keys {
      grid-template-columns: 1fr;
      padding-top: 0;
      border: 0;
      box-shadow: none;
    }
  }
  /* Then a tighter grid. */
  @media (max-width: 1179px) {
    .cabin {
      --m: 12px;
      --g: 6px;
      --pad: 10px;
      --dt: 12px;
      --db: 8px;
      --rise: 34px;
      --gn: 6px;
      --anns: 22px;
      --msg: 24px;
      --w-ej: 60px;
      --w-fl: 220px;
      --w-eng: 64px;
      --w-time: 150px;
      --w-sys: 82px;
      --nd: 56px;
    }
    .mod {
      gap: 6px;
    }
    .time {
      --dial: min(80px, calc(var(--console-h, 220px) - 128px));
    }
    h3 {
      letter-spacing: 0.14em;
    }
    .msg {
      font-size: 10.5px;
      padding: 0 10px;
    }
    .n {
      font-size: 10px;
    }
    .keys {
      grid-template-columns: 1fr;
      grid-auto-rows: minmax(24px, 1fr);
      gap: 6px;
      align-content: stretch;
      padding-top: 0;
      border: 0;
      box-shadow: none;
    }
  }
  @media (max-width: 1399px), (max-height: 779px) {
    .tgs {
      display: none;
    }
  }
</style>

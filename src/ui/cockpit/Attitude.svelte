<script lang="ts">
  import { onMount } from 'svelte';
  import { ui } from '../state.svelte.ts';
  import { onFrame } from './frame.ts';

  // The attitude ball (an Apollo-style FDAI): the horizon of the local level
  // (a body's pole up close, ecliptic or galactic north farther out) rolls
  // and slides behind a fixed ship symbol. The heading card turns under the
  // lubber line on the bezel, and an amber bug marks the target's bearing.
  // `mini` drops the numerals for a small ball.

  let { mini = false }: { mini?: boolean } = $props();

  const DEG = 180 / Math.PI;
  /** Ball units per degree of pitch. */
  const K = 3.2;
  let ball: SVGGElement;
  let roll: SVGGElement;
  let card: SVGGElement;
  let last = '';

  const rungs = Array.from({ length: 36 }, (_, i) => (i < 18 ? -90 + i * 5 : 5 + (i - 18) * 5));
  const card12 = ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'];
  const bank = [10, 20, 30, 45, 60];

  /** The target's bearing off the nose (degrees, clockwise), from the radar. */
  const bug = $derived.by(() => {
    const t = ui.ship?.radar.find((c) => c.role === 'target');
    return t && (t.x || t.y) ? Math.atan2(t.x, -t.y) * DEG : null;
  });

  onMount(() =>
    onFrame((_f, g) => {
      const key = `${g.pitch.toFixed(4)},${g.bank.toFixed(4)},${g.heading.toFixed(1)}`;
      if (key === last) return;
      last = key;
      const b = (-g.bank * DEG).toFixed(2);
      ball.setAttribute('transform', `rotate(${b}) translate(0 ${(g.pitch * DEG * K).toFixed(2)})`);
      roll.setAttribute('transform', `rotate(${b})`);
      card.setAttribute('transform', `rotate(${(-g.heading).toFixed(2)})`);
    }),
  );
</script>

<div class="adi" role="img" aria-label="Attitude and heading">
  <svg viewBox="-100 -100 200 200" aria-hidden="true">
    <defs>
      <clipPath id="ck-ball"><circle r="72" /></clipPath>
    </defs>
    <circle r="98" fill="#06080d" />
    <g fill="none" stroke="#8fb8ff">
      <circle r="97.5" stroke-opacity=".2" stroke-width=".8" />
      <circle r="75" stroke-opacity=".28" stroke-width=".8" />
      <g bind:this={card}>
        <circle r="92.5" stroke-opacity=".5" stroke-width="4" pathLength="360" stroke-dasharray=".3 4.7" transform="rotate(-90.15)" />
        <circle r="91.5" stroke-opacity=".95" stroke-width="7" pathLength="360" stroke-dasharray=".55 29.45" transform="rotate(-90.28)" />
        {#if !mini}
          <g class="card" stroke="none">
            {#each card12 as t, i (i)}
              <text y="-78.5" transform="rotate({i * 30})" class:cardinal={i % 3 === 0}>{t}</text>
            {/each}
          </g>
        {/if}
      </g>
    </g>
    {#if bug !== null}
      <path d="M-4.5-98h9v3.5l-4.5 4-4.5-4z" fill="#ffc46b" transform="rotate({bug.toFixed(1)})" />
    {/if}
    <path d="M0-85.5-4.5-97h9z" fill="#e8ecf4" />
    <g clip-path="url(#ck-ball)">
      <g bind:this={ball}>
        <rect x="-150" y="-450" width="300" height="450" fill="url(#ck-sky)" />
        <rect x="-150" y="0" width="300" height="450" fill="url(#ck-gnd)" />
        <path d="M-150 0h300" stroke="#8fb8ff" stroke-width="1.3" />
        <g stroke="#e8ecf4" stroke-opacity=".72" stroke-width=".9">
          {#each rungs as p (p)}
            {@const w = p % 10 ? 8 : 20}
            <path d="M{-w} {-p * K}h{2 * w}" stroke-dasharray={p < 0 ? '3 2' : undefined} />
          {/each}
        </g>
        {#if !mini}
          <g class="ladder">
            {#each rungs.filter((p) => p % 10 === 0) as p (p)}
              <text x="-33" y={-p * K + 4.2}>{Math.abs(p)}</text>
              <text x="33" y={-p * K + 4.2}>{Math.abs(p)}</text>
            {/each}
          </g>
        {/if}
      </g>
      <g bind:this={roll}><path d="M0-63.5l-3.6 6.5h7.2z" fill="#e8ecf4" /></g>
      <circle r="72" fill="url(#ck-shade)" />
      <g stroke="#e8ecf4" stroke-opacity=".6" stroke-width=".9">
        {#each bank as a (a)}
          <path d="M0 {a % 30 ? -66 : -62}V-72" transform="rotate({a})" />
          <path d="M0 {a % 30 ? -66 : -62}V-72" transform="rotate({-a})" />
        {/each}
      </g>
      <path d="M0-65.5l-3.6-6.5h7.2z" fill="none" stroke="#e8ecf4" stroke-width=".9" />
    </g>
    <circle r="72" fill="none" stroke="#000" stroke-width="1.5" />
    <g fill="none" stroke-linejoin="round" stroke-linecap="square">
      <path d="M-48 0h26l7 8M48 0H22l-7 8" stroke="#000" stroke-opacity=".7" stroke-width="4.5" />
      <path d="M-48 0h26l7 8M48 0H22l-7 8" stroke="#e8ecf4" stroke-width="2" />
    </g>
    <rect x="-2.2" y="-2.2" width="4.4" height="4.4" fill="#e8ecf4" stroke="#000" stroke-width="1" />
  </svg>
</div>

<style>
  .adi {
    position: absolute;
    inset: 3px;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  /* Numerals sized to read at 9.5px or more on the smallest ball. */
  .card text {
    fill: #8fb8ff;
    fill-opacity: 0.8;
    font: 500 12.5px var(--mono);
    text-anchor: middle;
  }
  .card text.cardinal {
    fill: #e8ecf4;
    fill-opacity: 1;
  }
  .ladder text {
    fill: #e8ecf4;
    fill-opacity: 0.65;
    font: 500 12px var(--mono);
    text-anchor: middle;
  }
</style>

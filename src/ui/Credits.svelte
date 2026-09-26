<script lang="ts">
  import registry from '../../data/sources.json';
  import { ui } from './state.svelte.ts';

  interface Source {
    id: string;
    kind: string;
    title: string;
    publisher?: string;
    url: string;
    license: string;
    credit?: string;
  }

  const sources = (registry as unknown as { sources: Source[] }).sources;
  const groups: Array<{ kind: string; title: string; items: Source[] }> = [
    { kind: 'data', title: 'Data and catalogs', items: sources.filter((s) => s.kind === 'data') },
    { kind: 'imagery', title: 'Imagery', items: sources.filter((s) => s.kind === 'imagery') },
  ];

  // Libraries and fonts shipped to the browser.
  const software = [
    { name: 'three.js', url: 'https://threejs.org/', license: 'MIT' },
    { name: 'Svelte', url: 'https://svelte.dev/', license: 'MIT' },
    { name: 'Astronomy Engine (Don Cross)', url: 'https://github.com/cosinekitty/astronomy', license: 'MIT' },
    { name: 'satellite.js (SGP4)', url: 'https://github.com/shashwatak/satellite-js', license: 'MIT' },
    { name: 'Basis Universal transcoder (Binomial)', url: 'https://github.com/BinomialLLC/basis_universal', license: 'Apache-2.0' },
    { name: 'Fuse.js', url: 'https://www.fusejs.io/', license: 'Apache-2.0' },
    { name: 'Zod', url: 'https://zod.dev/', license: 'MIT' },
    { name: 'Inter and JetBrains Mono typefaces', url: 'https://fonts.google.com/', license: 'OFL-1.1' },
  ];

  const LICENSE_NAMES: Record<string, string> = {
    PD: 'Public domain',
    CC0: 'CC0',
    'CC-BY-4.0': 'CC BY 4.0',
    'CC-BY-SA-4.0': 'CC BY-SA 4.0',
    MIT: 'MIT',
    'custom-attribution': 'Free with acknowledgment',
  };
  const licenseName = (l: string) => LICENSE_NAMES[l] ?? l;

  function close() {
    ui.creditsOpen = false;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" role="presentation" onclick={close}></div>
<div class="credits" role="dialog" aria-modal="true" aria-label="About and credits">
  <header>
    <h2>About &amp; credits</h2>
    <button class="close" onclick={close} aria-label="Close">×</button>
  </header>
  <div class="body">
    <section>
      <p>
        An exploration of the observable universe at true scale, from a regional view of Earth to the cosmic microwave background.
        Positions are real and computed for the date shown. Every fact on an info card names its source and carries a badge:
      </p>
      <ul class="kinds">
        <li><span class="k measured">measured</span> observed values, such as a mission's imagery or a catalog distance</li>
        <li><span class="k derived">derived</span> computed from measured values, like the current distance or an orbital period</li>
        <li><span class="k model">model</span> a physical or statistical model, such as the Milky Way's structure or a star's radius from its temperature</li>
        <li><span class="k artistic">artistic</span> illustrative only, where no measurement exists</li>
      </ul>
      <p class="muted">
        Accuracy is checked by an automated fact-check suite against JPL Horizons, SIMBAD, the IAU, VizieR and published distances.
        Sizes are true unless “Boost sizes” is on. Faint objects are drawn as points or markers that are not to scale.
      </p>
    </section>

    {#each groups as g (g.kind)}
      <section>
        <h3>{g.title}</h3>
        <ul class="sources">
          {#each g.items as s (s.id)}
            <li>
              <div class="line">
                <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
                <span class="lic">{licenseName(s.license)}</span>
              </div>
              {#if s.credit}<div class="credit">{s.credit}</div>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}

    <section>
      <h3>Software</h3>
      <ul class="sources">
        {#each software as s (s.name)}
          <li>
            <div class="line">
              <a href={s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>
              <span class="lic">{licenseName(s.license)}</span>
            </div>
          </li>
        {/each}
      </ul>
      <p class="muted">
        Star data (HYG, AT-HYG) and constellation figures (Stellarium) are CC BY-SA 4.0. They are served as separate files alongside
        their license, and any adaptation of them is shared under the same terms.
      </p>
    </section>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.45);
    pointer-events: auto;
  }
  .credits {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(720px, calc(100vw - 32px));
    max-height: min(80vh, 900px);
    display: flex;
    flex-direction: column;
    background: var(--panel-solid);
    border: 1px solid var(--border);
    border-radius: 14px;
    pointer-events: auto;
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.5);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 8px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .close {
    border: none;
    background: none;
    color: var(--muted);
    font-size: 22px;
    cursor: pointer;
    line-height: 1;
  }
  .body {
    overflow-y: auto;
    padding: 0 20px 20px;
    font-size: 13px;
    line-height: 1.5;
  }
  section + section {
    margin-top: 18px;
  }
  h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
    margin: 0 0 8px;
    font-weight: 600;
  }
  p {
    margin: 6px 0;
  }
  .muted {
    color: var(--muted);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .kinds li {
    margin: 4px 0;
  }
  .k {
    display: inline-block;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 1px 6px;
    border-radius: 4px;
    margin-right: 6px;
  }
  .k.measured {
    background: rgb(90 200 140 / 0.18);
    color: #7fe0a8;
  }
  .k.derived {
    background: rgb(120 170 255 / 0.18);
    color: #9cc0ff;
  }
  .k.model {
    background: rgb(200 170 255 / 0.18);
    color: #cdb4ff;
  }
  .k.artistic {
    background: rgb(255 170 90 / 0.18);
    color: #ffc07a;
  }
  .sources li {
    padding: 6px 0;
    border-top: 1px solid var(--border);
  }
  .line {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .line a {
    color: var(--text);
    text-decoration: none;
  }
  .line a:hover {
    text-decoration: underline;
  }
  .lic {
    flex: none;
    font-size: 11px;
    color: var(--muted);
  }
  .credit {
    color: var(--muted);
    font-size: 12px;
  }
</style>

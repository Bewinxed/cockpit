<script lang="ts">
  /** Dev-only gallery for the Outpost component library. Not linked in nav. */
  import {
    Button,
    StatusPill,
    ItemMark,
    NavItem,
    Panel,
    StatCard,
    TextField,
    FilterSelect,
    Pagination,
  } from '$lib/outpost';

  let page = $state(5);
</script>

<div class="stage">
  <header>
    <h1>Component library</h1>
    <p>The Quiet Ledger system as live Svelte components — ported from the verified v5 mock.</p>
  </header>

  <section>
    <h2>Buttons</h2>
    <div class="row">
      <Button variant="primary">New session</Button>
      <Button>Cancel</Button>
      <Button variant="destructive">Delete</Button>
      <Button variant="destructive-solid">Delete session</Button>
      <Button size="icon" aria-label="add">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
      </Button>
      <Button size="icon-sm" aria-label="add">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
      </Button>
      <Button disabled>Disabled</Button>
    </div>
  </section>

  <section>
    <h2>Status pill</h2>
    <div class="row">
      <StatusPill status="live">Working</StatusPill>
      <StatusPill status="attn">Needs you</StatusPill>
      <StatusPill status="done">Done</StatusPill>
      <StatusPill status="fail">Failed</StatusPill>
      <StatusPill status="idle">Idle</StatusPill>
    </div>
  </section>

  <section>
    <h2>Item mark</h2>
    <div class="row">
      {#each [1, 2, 3, 4, 5, 6, 7, 8] as h (h)}
        <ItemMark hue={h as 1}>
          <svg viewBox="0 0 24 24" fill="none"><path d="M8 6l6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </ItemMark>
      {/each}
    </div>
  </section>

  <section>
    <h2>Nav item</h2>
    <div class="rail">
      <NavItem href="#" active count={3}>
        {#snippet icon()}<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.6" /></svg>{/snippet}
        Fleet
      </NavItem>
      <NavItem href="#" count={1} attn>
        {#snippet icon()}<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6" /></svg>{/snippet}
        Sessions
      </NavItem>
      <NavItem href="#">
        {#snippet icon()}<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>{/snippet}
        Rules
      </NavItem>
    </div>
  </section>

  <section>
    <h2>Stat cards</h2>
    <div class="row">
      <StatCard label="Sessions" value="12" unit="live now" onclick={() => {}} />
      <StatCard label="Context used" value="68%" unit="of 200k" />
      <StatCard label="Awaiting approval" value="2" unit="blocked" href="#" />
    </div>
  </section>

  <section>
    <h2>Panel</h2>
    <div class="row">
      <Panel class="demo-panel">
        <strong>Machine · nixbox</strong>
        <span class="muted">3 sessions · connected over tailnet</span>
      </Panel>
    </div>
  </section>

  <section>
    <h2>Input & select</h2>
    <div class="row" style="gap:18px;align-items:flex-end">
      <div style="width:280px">
        <TextField label="Session name" placeholder="e.g. refactor-auth" hint="Shown in the fleet rail." />
      </div>
      <div style="width:280px">
        <TextField label="Path" placeholder="/repos/app" error hint="No such directory." hintKind="err" />
      </div>
      <FilterSelect label="All machines" />
    </div>
  </section>

  <section>
    <h2>Pagination</h2>
    <Pagination bind:page total={20} />
    <p class="muted" style="margin-top:8px">page {page}</p>
  </section>
</div>

<style>
  .stage {
    max-width: 1180px;
    margin: 0 auto;
    padding: 40px 24px 120px;
    background: var(--surface-field);
    min-height: 100dvh;
  }
  header {
    margin: 0 0 34px;
  }
  h1 {
    font-size: var(--text-3xl);
    font-weight: var(--weight-strong);
    line-height: var(--leading-tight);
    letter-spacing: var(--track-display);
    color: var(--ink-strong);
  }
  header p {
    color: var(--ink-muted);
    font-size: var(--text-md);
    margin-top: 6px;
  }
  section {
    margin: 0 0 44px;
  }
  h2 {
    font-size: var(--text-xl);
    font-weight: var(--weight-strong);
    line-height: var(--leading-tight);
    letter-spacing: var(--track-display);
    margin-bottom: 12px;
    color: var(--ink-strong);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .rail {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--surface-sunken);
    border: 1px solid var(--border-hairline);
    border-radius: var(--radius-control);
    padding: 6px;
    width: 220px;
  }
  :global(.demo-panel) {
    width: 320px;
    gap: 4px;
  }
  :global(.demo-panel) strong {
    color: var(--ink-strong);
    font-weight: var(--weight-strong);
    font-size: var(--text-md);
  }
  .muted {
    color: var(--ink-muted);
    font-size: var(--text-sm);
  }
</style>

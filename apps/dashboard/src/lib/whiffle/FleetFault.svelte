<script lang="ts">
  /**
   * One fault, rendered the same way everywhere it appears.
   *
   * The rule this component exists to enforce: a failure is never handed to the
   * reader as the raw string a CLI printed. It is named, attributed to a hub or
   * to a machine, explained in a sentence, given the affordance that resolves
   * it — and only then, behind a disclosure, quoted verbatim. The raw text is
   * evidence, not the message.
   *
   * The one exception is a cause whiffle does not recognise, where the machine's
   * own words ARE the message; that case shows the output open, because hiding
   * an explanation nobody has behind a summary that says nothing is worse.
   */
  import { toast } from "svelte-sonner";
  import { Button } from "$lib/components/ui/button";
  import {
    IconChevronDown,
    IconChevronRight,
    IconRefresh,
    IconWarningTriangle,
  } from "$lib/icons";
  import type { Machine } from "./client.svelte";
  import { refreshPlugin, refreshSkill, syncFleet } from "./fleet";
  import {
    CAUSE,
    type FaultGroup,
    faultLabel,
    readToolchain,
    SCOPE_ANCHOR,
    SCOPE_NOUN,
  } from "./fleet-faults";
  import { machineLabel } from "./machine";
  import OsMark from "./OsMark.svelte";

  let {
    group,
    machines,
    onresolved,
  }: {
    group: FaultGroup;
    machines: Machine[];
    /** Called after a retry or a re-sync lands, so a list can re-read itself. */
    onresolved?: () => void;
  } = $props();

  const copy = $derived(CAUSE[group.cause]);
  const machine = $derived(
    machines.find((one) => one.machineId === group.machineId)
  );
  const online = $derived(machine?.status === "online");
  const toolchain = $derived(readToolchain(machine?.fleet));

  /**
   * How many affected rows are named before the rest become a count. Our
   * choice, because: six monospace ids is about two lines at this panel's
   * width, and past that the list has stopped being something you take in at a
   * glance and become something you scroll.
   */
  const NAMED = 6;
  const shown = $derived(group.faults.slice(0, NAMED));
  const extra = $derived(group.faults.length - shown.length);

  let busy = $state(false);
  let open = $state(false);

  const message = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

  async function resync() {
    if (!group.machineId) {
      return;
    }
    busy = true;
    try {
      await syncFleet(group.machineId);
      toast.success(
        `${machine ? machineLabel(machine.hostname) : "That machine"} is syncing.`
      );
      onresolved?.();
    } catch (error) {
      toast.error(message(error));
    } finally {
      busy = false;
    }
  }

  /**
   * Re-resolve at the hub, for every row in this group. A skill and a plugin
   * have their own verbs and neither is the other's, so the scope picks.
   */
  async function refresh() {
    busy = true;
    try {
      let stillFailing = 0;
      for (const fault of group.faults) {
        if (fault.scope === "skills") {
          if ((await refreshSkill(fault.key)).error) {
            stillFailing += 1;
          }
        } else if (
          fault.scope === "plugins" &&
          (await refreshPlugin(fault.key)).error
        ) {
          stillFailing += 1;
        }
      }
      if (stillFailing > 0) {
        toast.error(
          `${stillFailing} still would not fetch — the row says why.`
        );
      } else {
        toast.success("Fetched. The machines are being sent the files.");
      }
      onresolved?.();
    } catch (error) {
      toast.error(message(error));
    } finally {
      busy = false;
    }
  }

  /** What the button will do, said before it is pressed rather than after. */
  const actionLabel = $derived(
    copy.action === "resync"
      ? "Sync this machine"
      : copy.action === "refresh"
        ? group.faults.length > 1
          ? `Fetch all ${group.faults.length} again`
          : "Fetch again"
        : ""
  );
  const actionHint = $derived(
    copy.action === "resync"
      ? "Applies the fleet’s setup to this machine again and reports what came of it."
      : copy.action === "refresh"
        ? "Downloads the content at the hub, once, then hands the bytes to every machine."
        : ""
  );
</script>

<div class="fault" class:hub={group.origin === 'hub'}>
  <div class="top">
    <IconWarningTriangle
      class="size-4 shrink-0 {group.origin === 'hub' ? 'text-destructive' : 'text-warning'}"
    />
    <span class="title">{copy.title}</span>
    <!-- Where, never left implicit: the whole point of the investigation this
         came out of was that a badge named no machine. -->
    <span class="where">
      {#if group.origin === 'hub'}
        <span class="tag">at the hub</span>
      {:else if machine}
        <span class="tag">
          <OsMark class="size-3.5 shrink-0" os={machine.os} />
          {machineLabel(machine.hostname)}{online ? '' : ' · offline'}
        </span>
      {:else}
        <span class="tag">{group.machineId}</span>
      {/if}
    </span>
  </div>

  <p class="rows">
    <span class="noun"
      >{SCOPE_NOUN[group.scope]}{group.faults.length === 1 ? '' : 's'}:</span
    >
    {#each shown as fault (fault.scope + fault.key)}
      <code>{faultLabel(fault)}</code>
    {/each}
    {#if extra > 0}
      <span class="more">and {extra} more</span>
    {/if}
  </p>

  <p class="why">{copy.why}</p>

  {#if copy.toolchain && toolchain}
    <!-- The attribution that was missing: which binary said it, and whether a
         newer one is sitting on the same machine behind it. -->
    <div class="tool">
      <span class="k">claude on this machine</span>
      {#if toolchain.used}
        <span class="line used">
          <code>{toolchain.used.path}</code>
          <span class="v">{toolchain.used.version ?? 'version unknown'}</span>
          <span class="badge">ran this sync</span>
        </span>
      {/if}
      {#each toolchain.others as other (other.path)}
        <span class="line">
          <code>{other.path}</code>
          <span class="v">{other.version ?? 'version unknown'}</span>
        </span>
      {/each}
      {#if toolchain.shadowed}
        <p class="shadow">
          A newer claude is installed on this machine and is not the one PATH
          resolves first. Until that changes, updating again will not help.
        </p>
      {/if}
    </div>
  {/if}

  {#if group.faults[0]?.detail}
    {#if group.cause === 'unknown'}
      <pre class="said">{group.faults[0].detail}</pre>
    {:else}
      <button
        aria-expanded={open}
        class="disclose"
        onclick={() => (open = !open)}
        type="button"
      >
        {#if open}
          <IconChevronDown class="size-3.5 shrink-0" />
        {:else}
          <IconChevronRight class="size-3.5 shrink-0" />
        {/if}
        What it said
      </button>
      {#if open}
        {#each shown as fault (fault.scope + fault.key)}
          {#if fault.detail}
            <pre
              class="said"
            ><span class="for">{faultLabel(fault)}</span>{fault.detail}</pre>
          {/if}
        {/each}
      {/if}
    {/if}
  {/if}

  <p class="fix">{copy.fix}</p>

  <div class="acts">
    {#if copy.action === 'resync'}
      <Button
        disabled={busy || !online}
        onclick={resync}
        size="xs"
        variant="outline"
      >
        <IconRefresh class="shrink-0" />
        {busy ? 'Syncing…' : actionLabel}
      </Button>
      <span class="hint"
        >{online ? actionHint : 'It syncs on its own the moment it comes back.'}</span
      >
    {:else if copy.action === 'refresh'}
      <Button disabled={busy} onclick={refresh} size="xs" variant="outline">
        <IconRefresh class="shrink-0" />
        {busy ? 'Fetching…' : actionLabel}
      </Button>
      <span class="hint">{actionHint}</span>
    {:else if copy.action === 'settle'}
      <Button href="#{SCOPE_ANCHOR[group.scope]}" size="xs" variant="outline"
        >Compare the two copies</Button
      >
      <span class="hint"
        >Adopt this machine’s copy into the fleet, or overwrite it with the
        fleet’s.</span
      >
    {:else}
      <Button href="#{SCOPE_ANCHOR[group.scope]}" size="xs" variant="outline"
        >Open the panel</Button
      >
    {/if}
  </div>
</div>

<style>
  /* Tinted ink on tinted ground, the pairing every other callout on this page
     uses (`warnAlert` in FleetMcp/FleetSkills/FleetHooks): warning-3 under
     warning-11. Neutral ink on a coloured ground was measurably weaker and off
     the page's own vocabulary. */
  .fault {
    --tone-bg: var(--warning-3);
    --tone-edge: var(--warning-9);
    --tone-ink: var(--warning-11);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border-radius: var(--radius-well);
    border: 1px solid var(--tone-edge);
    background: var(--tone-bg);
    padding: var(--space-3);
    min-width: 0;
  }
  /* A hub fault is not a machine's problem and does not wear a machine's tint:
     nothing downstream of it can be fixed until it is. */
  .fault.hub {
    --tone-bg: var(--error-3);
    --tone-edge: var(--error-9);
    --tone-ink: var(--error-11);
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .title {
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--tone-ink);
  }
  /* The machine sits beside the title, not pushed to the far edge. Measured:
     `margin-left: auto` opened a 717px gap between the two halves of one
     sentence — "what broke" and "where" read as one fact and belong together. */
  .where {
    display: inline-flex;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    border-radius: var(--radius-pill);
    background: var(--surface-raised);
    padding: 1px var(--space-2);
    font-size: var(--text-xs);
    color: var(--ink-muted);
    white-space: nowrap;
  }
  .rows {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-2);
    min-width: 0;
  }
  .noun,
  .more,
  .hint {
    font-size: var(--text-xs);
    color: var(--tone-ink);
    opacity: 0.8;
  }
  code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--tone-ink);
    overflow-wrap: anywhere;
  }
  .why,
  .fix {
    font-size: var(--text-sm);
    color: var(--tone-ink);
    max-width: 68ch;
  }
  .tool {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-radius: var(--radius-well);
    background: var(--surface-field);
    border: 1px solid var(--border-hairline);
    padding: var(--space-2);
  }
  .tool .k {
    font-size: var(--text-xs);
    color: var(--ink-label);
  }
  .tool .line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
  }
  .tool .line.used code {
    font-weight: var(--weight-strong);
  }
  .tool .v {
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--ink-muted);
  }
  .tool .badge {
    border-radius: var(--radius-pill);
    background: var(--surface-raised);
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
    color: var(--ink-muted);
  }
  .shadow {
    font-size: var(--text-xs);
    color: var(--ink-strong);
    padding-top: var(--space-1);
  }
  /* The well and the quoted output sit on --surface-field, a neutral ground, so
     they keep neutral ink rather than inheriting the callout's tone. */
  .tool code,
  .said {
    color: var(--ink-strong);
  }
  /* min-height 24px: measured at 14.6px, below the 24px WCAG 2.5.8 (AA)
     minimum target size. The negative inline margin keeps the label optically
     flush with the text above it while the target itself stays full size. */
  .disclose {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    align-self: flex-start;
    min-height: 24px;
    margin-inline-start: calc(var(--space-2) * -1);
    padding-inline: var(--space-2);
    border-radius: var(--radius-control);
    font-size: var(--text-xs);
    color: var(--ink-muted);
    cursor: pointer;
  }
  .disclose {
    color: var(--tone-ink);
    opacity: 0.8;
  }
  .disclose:hover {
    opacity: 1;
  }
  .said {
    max-height: 10rem;
    overflow: auto;
    border-radius: var(--radius-well);
    background: var(--surface-field);
    border: 1px solid var(--border-hairline);
    padding: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .said .for {
    display: block;
    color: var(--ink-muted);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
</style>

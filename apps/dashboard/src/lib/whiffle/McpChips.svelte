<script lang="ts">
  /**
   * The session's MCP servers as favicon chips: the favicon where a URL names
   * one, the name's first letter where nothing does (stdio) or the image never
   * arrived. Connection trouble is a dot on the chip, not a chip of its own —
   * clicking one opens what went wrong and what the server offers.
   *
   * Eight of those circles is a toolbar of its own, and the header has verbs
   * that matter more than any of them — so past three, at every width, the row
   * folds into a single counted chip that opens the same list, and the servers
   * cost one slot until somebody asks for them.
   */
  import type { McpServerStatus } from "@whiffle/core";
  import { flip } from "svelte/animate";
  import { quintOut } from "svelte/easing";
  import { fly, slide } from "svelte/transition";
  import { toast } from "svelte-sonner";
  import { Button } from "$lib/components/ui/button";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as Popover from "$lib/components/ui/popover";
  import { restartMcpServer, setMcpServerEnabled } from "./client.svelte";
  import McpServerDetail from "./McpServerDetail.svelte";
  import { faviconCandidates, mcpHost } from "./mcp";

  interface Props {
    instanceId: string;
    machineId: string;
    servers: McpServerStatus[];
  }

  let { servers, instanceId, machineId }: Props = $props();

  /** Chips a header can carry before they read as a row of their own. */
  const LOOSE = 3;

  const folded = $derived(servers.length > LOOSE);

  /** How far down a server's candidate list the failures have walked, by name. */
  let attempt = $state<Record<string, number>>({});
  /** The server whose details popover is open; one at a time. */
  let detailsFor = $state<string | null>(null);
  /** The folded chip's list, and the row expanded inside it. */
  let listOpen = $state(false);
  let foldedDetail = $state<string | null>(null);
  /** Servers with a restart or stop in flight, by name. */
  let busy = $state<Record<string, boolean>>({});
  /** Favicons that have painted, for the fade-in. */
  let loaded = $state<Record<string, boolean>>({});

  const DOT: Record<string, string> = {
    connected: "bg-success",
    failed: "bg-destructive",
    "needs-auth": "bg-warning",
    pending: "bg-muted-foreground animate-pulse",
  };

  /** The chip's dot says only what needs acting on; connected is the quiet case. */
  const CHIP_DOT: Record<string, string> = {
    failed: DOT.failed,
    "needs-auth": DOT["needs-auth"],
    pending: DOT.pending,
  };

  const tip = (server: McpServerStatus): string =>
    server.status === "failed" && server.error
      ? `${server.name} · ${server.status} — ${server.error}`
      : `${server.name} · ${server.status}`;

  /** The loudest thing any of them is doing, for the folded chip's one dot. */
  const worst = $derived(
    (["failed", "needs-auth", "pending"] as const).find((status) =>
      servers.some((server) => server.status === status)
    )
  );

  async function run(name: string, action: () => Promise<void>) {
    busy[name] = true;
    try {
      await action();
    } catch (error) {
      console.error(`[whiffle] ${name} did not answer:`, error);
      toast.error(`${name} did not respond`, {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      busy[name] = false;
    }
  }

  const restart = (name: string) =>
    run(name, () => restartMcpServer(instanceId, machineId, name));
  const setEnabled = (name: string, enabled: boolean) =>
    run(name, () => setMcpServerEnabled(instanceId, machineId, name, enabled));
</script>

{#if !folded}
  <span
    aria-label="MCP servers"
    class="hidden shrink-0 items-center gap-1 sm:flex"
  >
    {#each servers as server (server.name)}
      {@const host = mcpHost(server)}
      {@const candidates = host ? faviconCandidates(host) : []}
      {@const step = attempt[server.name] ?? 0}
      <!-- `inline-flex` on the wrapper: an inline span parks the trigger on the
           text baseline and every chip drifts against its neighbours. -->
      <span
        class="inline-flex"
        in:fly={{ y: 4, duration: 200, easing: quintOut }}
        animate:flip={{ duration: 200 }}
      >
        <ContextMenu.Root>
          <ContextMenu.Trigger class="contents">
            <Popover.Root
              onOpenChange={(open) => (detailsFor = open ? server.name : null)}
              open={detailsFor === server.name}
            >
              <!-- The kit's outline button, like every other control in this
                   header: the border and hover are what say "clickable", and the
                   box matches its h-8 neighbours. The favicon inside is 24px. -->
              <Popover.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    aria-label="MCP server {server.name}"
                    class="relative {server.status === 'disabled' ? 'opacity-40' : ''} {busy[
                      server.name
                    ]
                      ? 'animate-pulse'
                      : ''}"
                    size="icon-sm"
                    title={tip(server)}
                    variant="outline"
                  >
                    <!-- The favicon IS the button: it fills the circle edge to
                         edge, cropped round — no inset, no framed-square look. -->
                    {#if step < candidates.length}
                      <img
                        alt={server.name}
                        class="size-full rounded-full object-cover transition-opacity duration-300 {loaded[
                          server.name
                        ]
                          ? 'opacity-100'
                          : 'opacity-0'}"
                        loading="lazy"
                        onerror={() => (attempt[server.name] = step + 1)}
                        onload={() => (loaded[server.name] = true)}
                        src={candidates[step]}
                      >
                    {:else}
                      <span
                        aria-hidden="true"
                        class="flex size-full items-center justify-center rounded-full bg-muted text-xs leading-none
                               font-medium text-muted-foreground uppercase"
                      >
                        {server.name.charAt(0)}
                      </span>
                    {/if}
                    {#if CHIP_DOT[server.status]}
                      <!-- Ringed so it reads over any favicon colour. -->
                      <span
                        class="absolute right-0.5 bottom-0.5 size-2 rounded-full ring-2 ring-background
                               transition-colors duration-300 {CHIP_DOT[server.status]}"
                      ></span>
                    {/if}
                  </Button>
                {/snippet}
              </Popover.Trigger>

              <Popover.Content
                align="end"
                class="w-64 rounded-[var(--radius-panel)] p-3 shadow-lg"
              >
                <McpServerDetail {instanceId} {machineId} {server} />
              </Popover.Content>
            </Popover.Root>
          </ContextMenu.Trigger>

          <ContextMenu.Content>
            <ContextMenu.Item onSelect={() => (detailsFor = server.name)}>
              Status & errors
            </ContextMenu.Item>
            <ContextMenu.Item
              disabled={busy[server.name]}
              onSelect={() => restart(server.name)}
            >
              Restart
            </ContextMenu.Item>
            {#if server.status === 'disabled'}
              <ContextMenu.Item
                disabled={busy[server.name]}
                onSelect={() => setEnabled(server.name, true)}
              >
                Start
              </ContextMenu.Item>
            {:else}
              <ContextMenu.Item
                disabled={busy[server.name]}
                onSelect={() => setEnabled(server.name, false)}
              >
                Stop
              </ContextMenu.Item>
            {/if}
          </ContextMenu.Content>
        </ContextMenu.Root>
      </span>
    {/each}
  </span>
{/if}

<!-- Folded: one chip that counts them and says what they are. Past three that
     is the only form it takes; at or under, it stands in for the chips a phone
     has no room for. -->
<Popover.Root bind:open={listOpen}>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        aria-label="{servers.length} MCP servers"
        class="relative shrink-0 gap-1 text-xs {folded ? '' : 'sm:hidden'}"
        size="sm"
        title={servers.map((server) => tip(server)).join('\n')}
        variant="outline"
      >
        <span class="tabular-nums" data-tabular>{servers.length}</span>
        MCP
        {#if worst}
          <span
            class="absolute top-0.5 right-0.5 size-2 rounded-full ring-2 ring-background {CHIP_DOT[
              worst
            ]}"
          ></span>
        {/if}
      </Button>
    {/snippet}
  </Popover.Trigger>

  <Popover.Content
    align="end"
    class="w-72 rounded-[var(--radius-panel)] p-1.5 shadow-lg"
  >
    <ul class="flex max-h-[60vh] flex-col overflow-y-auto">
      {#each servers as server (server.name)}
        {@const open = foldedDetail === server.name}
        {@const host = mcpHost(server)}
        {@const candidates = host ? faviconCandidates(host) : []}
        {@const step = attempt[server.name] ?? 0}
        <li class="flex flex-col">
          <button
            aria-expanded={open}
            class="flex min-h-9 items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-left transition-colors
                   hover:bg-accent hover:text-accent-foreground"
            onclick={() => (foldedDetail = open ? null : server.name)}
            type="button"
          >
            <!-- Same favicon + ringed status dot as the unfolded chips, at row
                 scale — the fold hid the row, not the identity. -->
            <span class="relative size-5 shrink-0">
              {#if step < candidates.length}
                <img
                  alt=""
                  class="size-full rounded-full object-cover transition-opacity duration-300 {loaded[
                    server.name
                  ]
                    ? 'opacity-100'
                    : 'opacity-0'}"
                  loading="lazy"
                  onerror={() => (attempt[server.name] = step + 1)}
                  onload={() => (loaded[server.name] = true)}
                  src={candidates[step]}
                >
              {:else}
                <span
                  aria-hidden="true"
                  class="flex size-full items-center justify-center rounded-full bg-muted text-micro
                         leading-none font-medium text-muted-foreground uppercase"
                >
                  {server.name.charAt(0)}
                </span>
              {/if}
              {#if CHIP_DOT[server.status]}
                <span
                  class="absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-popover
                         transition-colors duration-300 {CHIP_DOT[server.status]}"
                ></span>
              {/if}
            </span>
            <span class="min-w-0 flex-1 truncate text-sm">{server.name}</span>
            <span class="shrink-0 text-micro text-muted-foreground"
              >{server.status}</span
            >
          </button>
          {#if open}
            <div
              class="px-2 pt-1 pb-2"
              transition:slide={{ duration: 160, easing: quintOut }}
            >
              <McpServerDetail {instanceId} {machineId} {server} />
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </Popover.Content>
</Popover.Root>

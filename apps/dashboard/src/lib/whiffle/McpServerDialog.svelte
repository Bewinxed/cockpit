<script lang="ts">
  import type { FleetMcpConfig, FleetMcpServer } from "@whiffle/core";
  import { Button } from "$lib/components/ui/button";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte component-group convention
  import * as Dialog from "$lib/components/ui/dialog";
  import { Input } from "$lib/components/ui/input";
  // biome-ignore lint/performance/noNamespaceImport: shadcn-svelte component-group convention
  import * as ToggleGroup from "$lib/components/ui/toggle-group";
  import {
    isRemoteMcp,
    mcpNameProblem,
    pairsToRecord,
    recordToPairs,
    saveMcpServer,
    splitArgs,
    suggestMcpName,
  } from "./fleet";
  import KeyValueRows from "./KeyValueRows.svelte";

  let {
    open: dialogOpen = $bindable(false),
    editing = null,
    taken = [],
    onsaved,
  }: {
    open?: boolean;
    editing?: FleetMcpServer | null;
    taken?: string[];
    onsaved: (row: FleetMcpServer) => void;
  } = $props();

  type Mode = "bunx" | "command" | "remote";
  const HOW: Record<Mode, string> = {
    bunx: "Every machine runs the package with bunx. Nothing to install first.",
    command: "Runs a command the machines already have on their PATH.",
    remote: "Calls an endpoint. No process runs on the machines.",
  };

  let mode = $state<Mode>("bunx");
  let name = $state("");
  let pkg = $state("");
  let pkgArgs = $state("");
  let command = $state("");
  let argsLine = $state("");
  let env = $state(recordToPairs(undefined));
  let url = $state("");
  let transport = $state<"http" | "sse">("http");
  let headers = $state(recordToPairs(undefined));
  let busy = $state(false);
  let failed = $state<string | undefined>(undefined);
  let named = $state(false);

  const nameProblem = $derived(mcpNameProblem(name, taken));
  const saveLabel = $derived.by(() => {
    if (busy) {
      return "Saving…";
    }
    return editing ? "Save" : "Add server";
  });
  const filled = $derived.by(() => {
    if (mode === "bunx") {
      return pkg.trim() !== "";
    }
    if (mode === "command") {
      return command.trim() !== "";
    }
    return url.trim() !== "";
  });

  let seeded = $state(false);
  $effect(() => {
    if (!dialogOpen) {
      seeded = false;
      return;
    }
    if (seeded) {
      return;
    }
    seeded = true;
    seed();
  });

  function seed() {
    failed = undefined;
    mode = "bunx";
    name = editing?.name ?? "";
    named = editing !== null;
    pkg = "";
    pkgArgs = "";
    command = "";
    argsLine = "";
    env = recordToPairs(undefined);
    url = "";
    transport = "http";
    headers = recordToPairs(undefined);
    if (!editing) {
      return;
    }
    if (isRemoteMcp(editing.config)) {
      mode = "remote";
      ({ url } = editing.config);
      transport = editing.config.type;
      headers = recordToPairs(editing.config.headers);
    } else {
      mode = "command";
      ({ command } = editing.config);
      argsLine = (editing.config.args ?? []).join(" ");
      env = recordToPairs(editing.config.env);
    }
  }

  function build(): FleetMcpConfig {
    if (mode === "remote") {
      const sent = pairsToRecord(headers);
      return {
        type: transport,
        url: url.trim(),
        ...(Object.keys(sent).length > 0 ? { headers: sent } : {}),
      };
    }
    if (mode === "bunx") {
      return { command: "bunx", args: [pkg.trim(), ...splitArgs(pkgArgs)] };
    }
    const passed = pairsToRecord(env);
    const args = splitArgs(argsLine);
    return {
      command: command.trim(),
      ...(args.length > 0 ? { args } : {}),
      ...(Object.keys(passed).length > 0 ? { env: passed } : {}),
    };
  }

  /** The package field suggests a name until the reader has typed their own. */
  function suggestName(): void {
    if (!named) {
      name = suggestMcpName(pkg);
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (nameProblem || !filled || busy) {
      return;
    }
    busy = true;
    failed = undefined;
    try {
      onsaved(
        await saveMcpServer(name.trim(), build(), editing?.enabled ?? true)
      );
      dialogOpen = false;
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content class="rounded-[var(--radius-shell)] shadow-xl sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title
        >{editing ? `Edit ${editing.name}` : 'Add MCP server'}</Dialog.Title
      >
      <Dialog.Description
        >Every machine gets it, and every session started after that can reach
        it.</Dialog.Description
      >
    </Dialog.Header>
    <form class="flex flex-col gap-3" onsubmit={save}>
      <ToggleGroup.Root
        class="w-full"
        onValueChange={(next) => {
          if (next) {
            mode = next as Mode;
          }
        }}
        size="sm"
        type="single"
        value={mode}
        variant="outline"
      >
        <ToggleGroup.Item class="flex-1 text-caption" value="bunx"
          >bunx package</ToggleGroup.Item
        >
        <ToggleGroup.Item class="flex-1 text-caption" value="command"
          >Command</ToggleGroup.Item
        >
        <ToggleGroup.Item class="flex-1 text-caption" value="remote"
          >Remote</ToggleGroup.Item
        >
      </ToggleGroup.Root>
      <p class="text-micro text-muted-foreground">{HOW[mode]}</p>

      {#if mode === 'bunx'}
        <!-- biome-ignore lint/a11y/noLabelWithoutControl: the `Input` component (shadcn-svelte) renders a native <input> as its only child -->
        <label class="flex flex-col gap-1.5 text-caption"
          >Package
          <Input
            autocomplete="off"
            class="font-mono text-sm md:text-sm"
            oninput={suggestName}
            placeholder="@modelcontextprotocol/server-filesystem"
            spellcheck="false"
            bind:value={pkg}
          />
        </label>
        <!-- biome-ignore lint/a11y/noLabelWithoutControl: the `Input` component (shadcn-svelte) renders a native <input> as its only child -->
        <label class="flex flex-col gap-1.5 text-caption"
          >Arguments (optional)
          <Input
            autocomplete="off"
            class="font-mono text-sm md:text-sm"
            placeholder="/home/you/projects"
            spellcheck="false"
            bind:value={pkgArgs}
          />
        </label>
      {:else if mode === 'command'}
        <!-- biome-ignore lint/a11y/noLabelWithoutControl: the `Input` component (shadcn-svelte) renders a native <input> as its only child -->
        <label class="flex flex-col gap-1.5 text-caption"
          >Command
          <Input
            autocomplete="off"
            class="font-mono text-sm md:text-sm"
            placeholder="uvx"
            spellcheck="false"
            bind:value={command}
          />
        </label>
        <!-- biome-ignore lint/a11y/noLabelWithoutControl: the `Input` component (shadcn-svelte) renders a native <input> as its only child -->
        <label class="flex flex-col gap-1.5 text-caption"
          >Arguments
          <Input
            autocomplete="off"
            class="font-mono text-sm md:text-sm"
            placeholder="mcp-server-git --repository /home/you/repo"
            spellcheck="false"
            bind:value={argsLine}
          />
          <span class="text-micro text-muted-foreground"
            >Split on spaces. Quotes are not honoured.</span
          >
        </label>
        <KeyValueRows
          keyPlaceholder="API_KEY"
          legend="Environment"
          valuePlaceholder="&#36;&#123;MY_API_KEY&#125;"
          bind:rows={env}
        />
      {:else}
        <!-- biome-ignore lint/a11y/noLabelWithoutControl: the `Input` component (shadcn-svelte) renders a native <input> as its only child -->
        <label class="flex flex-col gap-1.5 text-caption"
          >URL
          <Input
            autocomplete="off"
            class="font-mono text-sm md:text-sm"
            placeholder="https://mcp.example.com/sse"
            spellcheck="false"
            bind:value={url}
          />
        </label>
        <fieldset class="flex flex-col gap-1.5 text-caption">
          <legend class="mb-1">Transport</legend>
          <ToggleGroup.Root
            class="w-full"
            onValueChange={(next) => {
              if (next) {
                transport = next as 'http' | 'sse';
              }
            }}
            size="sm"
            type="single"
            value={transport}
            variant="outline"
          >
            <ToggleGroup.Item class="flex-1 text-caption" value="http"
              >HTTP</ToggleGroup.Item
            >
            <ToggleGroup.Item class="flex-1 text-caption" value="sse"
              >SSE
              <span class="text-muted-foreground"
                >· deprecated</span
              ></ToggleGroup.Item
            >
          </ToggleGroup.Root>
        </fieldset>
        <KeyValueRows
          keyPlaceholder="Authorization"
          legend="Headers"
          valuePlaceholder="Bearer &#36;&#123;MY_TOKEN&#125;"
          bind:rows={headers}
        />
      {/if}

      <!-- biome-ignore lint/a11y/noLabelWithoutControl: the `Input` component (shadcn-svelte) renders a native <input> as its only child -->
      <label class="flex flex-col gap-1.5 text-caption"
        >Name
        <Input
          aria-invalid={name !== '' && nameProblem ? 'true' : undefined}
          autocomplete="off"
          class="font-mono text-sm md:text-sm"
          oninput={() => {
            named = true;
          }}
          placeholder="filesystem"
          spellcheck="false"
          bind:value={name}
        />
        <span class="text-micro">
          {#if name !== '' && nameProblem}
            <span class="text-destructive">{nameProblem}</span>
          {:else}
            What sessions call its tools —
            <span class="font-mono">mcp__{name || 'name'}__…</span>
          {/if}
        </span>
      </label>
      <p class="text-micro text-muted-foreground">
        <span class="font-mono">&#36;&#123;VAR&#125;</span>
        is expanded on each machine, from that machine's own environment —
        secrets never pass through the hub.
      </p>
      {#if failed}
        <p class="text-caption text-destructive" role="alert">{failed}</p>
      {/if}
      <div class="flex justify-end gap-2 pt-1">
        <Button
          disabled={busy}
          onclick={() => {
            dialogOpen = false;
          }}
          type="button"
          variant="outline"
          >Cancel</Button
        >
        <Button
          disabled={busy || !filled || nameProblem !== undefined}
          type="submit"
          >{saveLabel}</Button
        >
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>

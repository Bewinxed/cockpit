<script lang="ts">
  /**
   * Adds or edits one fleet MCP server (NEW.md §11). Three ways in, because a
   * package is nearly always the answer and the other two are what you reach
   * for when it is not: a `bunx` package, an arbitrary command, or a remote
   * endpoint. What comes out is the SDK's own config shape, stored verbatim.
   */
  import type { FleetMcpConfig, FleetMcpServer } from '@cockpit/core';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import {
    isRemoteMcp,
    mcpNameProblem,
    pairsToRecord,
    recordToPairs,
    saveMcpServer,
    splitArgs,
    suggestMcpName,
  } from './fleet';
  import KeyValueRows from './KeyValueRows.svelte';

  let {
    open = $bindable(false),
    editing = null,
    taken = [],
    onsaved,
  }: {
    open?: boolean;
    /** The row being changed, or nothing when this is a new server. */
    editing?: FleetMcpServer | null;
    /** Names already spoken for, so a clash is caught before the write. */
    taken?: string[];
    onsaved: (row: FleetMcpServer) => void;
  } = $props();

  type Mode = 'bunx' | 'command' | 'remote';

  const HOW: Record<Mode, string> = {
    bunx: 'Every machine runs the package with bunx. Nothing to install first.',
    command: 'Runs a command the machines already have on their PATH.',
    remote: 'Calls an endpoint. No process runs on the machines.',
  };

  let mode = $state<Mode>('bunx');
  let name = $state('');
  let pkg = $state('');
  let pkgArgs = $state('');
  let command = $state('');
  let argsLine = $state('');
  let env = $state(recordToPairs(undefined));
  let url = $state('');
  let transport = $state<'http' | 'sse'>('http');
  let headers = $state(recordToPairs(undefined));
  let busy = $state(false);
  let failed = $state<string | undefined>(undefined);

  /** Once the name has been typed in, the package stops writing over it. */
  let named = $state(false);

  const nameProblem = $derived(mcpNameProblem(name, taken));
  const filled = $derived(
    mode === 'bunx' ? pkg.trim() !== '' : mode === 'command' ? command.trim() !== '' : url.trim() !== ''
  );

  /**
   * Seeded from `open` itself: the dialog is opened by setting the bound value
   * from a menu, and a bound write runs no change callback.
   */
  let seeded = $state(false);
  $effect(() => {
    if (!open) {
      seeded = false;
      return;
    }
    if (seeded) return;
    seeded = true;
    seed();
  });

  function seed() {
    failed = undefined;
    mode = 'bunx';
    name = editing?.name ?? '';
    named = editing !== null;
    pkg = '';
    pkgArgs = '';
    command = '';
    argsLine = '';
    env = recordToPairs(undefined);
    url = '';
    transport = 'http';
    headers = recordToPairs(undefined);

    if (!editing) return;
    if (isRemoteMcp(editing.config)) {
      mode = 'remote';
      url = editing.config.url;
      transport = editing.config.type;
      headers = recordToPairs(editing.config.headers);
    } else {
      // A server added the `bunx` way comes back as the command it really is,
      // which is the same thing said plainly — nothing is lost either way.
      mode = 'command';
      command = editing.config.command;
      argsLine = (editing.config.args ?? []).join(' ');
      env = recordToPairs(editing.config.env);
    }
  }

  function build(): FleetMcpConfig {
    if (mode === 'remote') {
      const sent = pairsToRecord(headers);
      return {
        type: transport,
        url: url.trim(),
        ...(Object.keys(sent).length > 0 ? { headers: sent } : {}),
      };
    }
    if (mode === 'bunx') {
      return { command: 'bunx', args: [pkg.trim(), ...splitArgs(pkgArgs)] };
    }
    const passed = pairsToRecord(env);
    const args = splitArgs(argsLine);
    return {
      command: command.trim(),
      ...(args.length > 0 ? { args } : {}),
      ...(Object.keys(passed).length > 0 ? { env: passed } : {}),
    };
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (nameProblem || !filled || busy) return;
    busy = true;
    failed = undefined;
    try {
      onsaved(await saveMcpServer(name.trim(), build(), editing?.enabled ?? true));
      open = false;
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{editing ? `Edit ${editing.name}` : 'Add MCP server'}</Dialog.Title>
      <Dialog.Description>
        Every machine gets it, and every session started after that can reach it.
      </Dialog.Description>
    </Dialog.Header>

    <form class="flex flex-col gap-3" onsubmit={save}>
      <ToggleGroup.Root
        type="single"
        variant="outline"
        size="sm"
        value={mode}
        onValueChange={(next) => next && (mode = next as Mode)}
        class="w-full"
      >
        <ToggleGroup.Item value="bunx" class="flex-1 text-[13px]">bunx package</ToggleGroup.Item>
        <ToggleGroup.Item value="command" class="flex-1 text-[13px]">Command</ToggleGroup.Item>
        <ToggleGroup.Item value="remote" class="flex-1 text-[13px]">Remote</ToggleGroup.Item>
      </ToggleGroup.Root>
      <p class="text-xs text-muted-foreground">{HOW[mode]}</p>

      {#if mode === 'bunx'}
        <label class="flex flex-col gap-1 text-[13px] text-muted-foreground">
          Package
          <Input
            bind:value={pkg}
            oninput={() => !named && (name = suggestMcpName(pkg))}
            autocomplete="off"
            spellcheck="false"
            placeholder="@modelcontextprotocol/server-filesystem"
            class="font-mono text-sm md:text-sm"
          />
        </label>
        <label class="flex flex-col gap-1 text-[13px] text-muted-foreground">
          Arguments (optional)
          <Input
            bind:value={pkgArgs}
            autocomplete="off"
            spellcheck="false"
            placeholder="/home/you/projects"
            class="font-mono text-sm md:text-sm"
          />
        </label>
      {:else if mode === 'command'}
        <label class="flex flex-col gap-1 text-[13px] text-muted-foreground">
          Command
          <Input
            bind:value={command}
            autocomplete="off"
            spellcheck="false"
            placeholder="uvx"
            class="font-mono text-sm md:text-sm"
          />
        </label>
        <label class="flex flex-col gap-1 text-[13px] text-muted-foreground">
          Arguments
          <Input
            bind:value={argsLine}
            autocomplete="off"
            spellcheck="false"
            placeholder="mcp-server-git --repository /home/you/repo"
            class="font-mono text-sm md:text-sm"
          />
          <!-- Split on spaces, with no quoting: an argument that contains a
               space has to go in as its own env var or path. -->
          <span class="text-xs">Split on spaces. Quotes are not honoured.</span>
        </label>
        <KeyValueRows
          bind:rows={env}
          legend="Environment"
          keyPlaceholder="API_KEY"
          valuePlaceholder="&#36;&#123;MY_API_KEY&#125;"
        />
      {:else}
        <label class="flex flex-col gap-1 text-[13px] text-muted-foreground">
          URL
          <Input
            bind:value={url}
            autocomplete="off"
            spellcheck="false"
            placeholder="https://mcp.example.com/sse"
            class="font-mono text-sm md:text-sm"
          />
        </label>
        <fieldset class="flex flex-col gap-1 text-[13px] text-muted-foreground">
          <legend class="mb-1">Transport</legend>
          <ToggleGroup.Root
            type="single"
            variant="outline"
            size="sm"
            value={transport}
            onValueChange={(next) => next && (transport = next as 'http' | 'sse')}
            class="w-full"
          >
            <ToggleGroup.Item value="http" class="flex-1 text-[13px]">HTTP</ToggleGroup.Item>
            <ToggleGroup.Item value="sse" class="flex-1 text-[13px]">
              SSE <span class="text-muted-foreground">· deprecated</span>
            </ToggleGroup.Item>
          </ToggleGroup.Root>
        </fieldset>
        <KeyValueRows
          bind:rows={headers}
          legend="Headers"
          keyPlaceholder="Authorization"
          valuePlaceholder="Bearer &#36;&#123;MY_TOKEN&#125;"
        />
      {/if}

      <label class="flex flex-col gap-1 text-[13px] text-muted-foreground">
        Name
        <Input
          bind:value={name}
          oninput={() => (named = true)}
          autocomplete="off"
          spellcheck="false"
          aria-invalid={name !== '' && nameProblem ? 'true' : undefined}
          placeholder="filesystem"
          class="font-mono text-sm md:text-sm"
        />
        <span class="text-xs">
          {#if name !== '' && nameProblem}
            <span class="text-destructive">{nameProblem}</span>
          {:else}
            What sessions call its tools — <span class="font-mono">mcp__{name || 'name'}__…</span>
          {/if}
        </span>
      </label>

      <p class="text-xs text-muted-foreground">
        <span class="font-mono">&#36;&#123;VAR&#125;</span> is expanded on each machine, from that machine's
        own environment — secrets never pass through the hub.
      </p>

      {#if failed}
        <p class="text-[13px] text-destructive" role="alert">{failed}</p>
      {/if}

      <div class="flex justify-end gap-2">
        <Button type="button" variant="outline" onclick={() => (open = false)} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !filled || nameProblem !== undefined}>
          {busy ? 'Saving…' : editing ? 'Save' : 'Add server'}
        </Button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>

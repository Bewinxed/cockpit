<script lang="ts">
  /**
   * One subagent, edited as what it is: a markdown file. There is no form —
   * Claude Code reads sixteen optional front-matter fields and adds more with
   * every release, so a form here would be a second, always-older schema. The
   * strip above the text says what the file currently claims to be, which is
   * the only reading cockpit does of it.
   */
  import { toast } from 'svelte-sonner';
  import { agentProblem, parseAgentFrontMatter, type FleetAgent } from '@cockpit/core';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Textarea } from '$lib/components/ui/textarea';
  import { saveAgent } from './fleet';

  let { open = $bindable(false), agent = null, onsaved }: {
    open?: boolean;
    /** Null writes a new one; the template is what it starts from. */
    agent?: FleetAgent | null;
    onsaved: (row: FleetAgent) => void;
  } = $props();

  /** The docs' own shape: two required fields, then a role line and its rules. */
  const TEMPLATE = `---
name: new-subagent
description: Use this agent proactively when <the situation it is for>.
---

You are a <role>, working in one repository at a time.

<What you do, what you never do, and what you hand back.>
`;

  let draft = $state('');
  let saving = $state(false);
  let refused = $state<string | undefined>(undefined);
  let seeded = $state(false);

  const front = $derived(parseAgentFrontMatter(draft));
  const problem = $derived(agentProblem(front, agent?.name));
  /** Where the file goes: the row being edited, or whatever this one calls itself. */
  const target = $derived(agent?.name ?? front.name);
  const dirty = $derived(draft !== (agent?.content ?? TEMPLATE));

  // Seeded when the dialog opens and never from the prop after: a fleet read
  // landing mid-edit must not take the text being written with it.
  $effect(() => {
    if (open && !seeded) {
      draft = agent?.content ?? TEMPLATE;
      refused = undefined;
      seeded = true;
    } else if (!open && seeded) {
      seeded = false;
    }
  });

  async function commit() {
    if (!target) return;
    saving = true;
    refused = undefined;
    try {
      onsaved(await saveAgent(target, draft));
      open = false;
      toast.success(`${target} is on its way to every machine that is online.`);
    } catch (error) {
      refused = error instanceof Error ? error.message : String(error);
    } finally {
      saving = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="material-panel rounded-[var(--radius-shell)] shadow-xl sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>{agent ? agent.name : 'New subagent'}</Dialog.Title>
      <Dialog.Description>
        The file is the definition. It lands at
        <span class="font-mono">~/.claude/agents/{target ?? 'name'}.md</span> on every machine, and
        Claude Code picks it up within seconds.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-well)] bg-muted px-3 py-2">
      {#if front.name}
        <span class="shrink-0 font-mono text-micro text-foreground">{front.name}</span>
      {/if}
      {#if front.model && front.model !== 'inherit'}
        <Badge variant="outline">{front.model}</Badge>
      {/if}
      {#if front.tools}
        <Badge variant="outline">{front.tools.length} tools</Badge>
      {/if}
      {#if front.effort}
        <Badge variant="outline">{front.effort} effort</Badge>
      {/if}
      {#if problem}
        <span class="min-w-0 flex-1 text-micro text-muted-foreground">Not storable yet — {problem}.</span>
      {:else if front.description}
        <span class="min-w-0 flex-1 truncate text-micro text-muted-foreground" title={front.description}>
          {front.description}
        </span>
      {/if}
    </div>

    <!-- The kit's textarea is `field-sizing-content`, so a long prompt body would
         grow the dialog straight off the screen, buttons and all. -->
    <Textarea
      bind:value={draft}
      spellcheck="false"
      aria-label="{target ?? 'New'} definition"
      class="max-h-[55vh] min-h-80 overflow-y-auto font-mono text-sm md:text-sm"
    />

    {#if refused}<p class="text-caption text-destructive" role="alert">{refused}</p>{/if}

    <div class="flex justify-end gap-2">
      <Button variant="outline" onclick={() => (open = false)} disabled={saving}>Cancel</Button>
      <Button disabled={saving || !target || !dirty} onclick={commit}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

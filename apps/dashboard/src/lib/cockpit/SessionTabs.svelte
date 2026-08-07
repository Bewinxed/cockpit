<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { IconClose } from '$lib/icons';
  import { isTyping } from '$lib/utils/typing';
  import ActivityDot from './ActivityDot.svelte';
  import { cockpit } from './client.svelte';
  import { sessionTitle, transcriptHref } from './links';
  import { workingSet } from './working-set.svelte';

  const MAX_VISIBLE = 6;

  interface Tab {
    id: string;
    title: string;
    href: string;
    activity: ReturnType<typeof cockpit.activityOf>;
  }

  function resolveTab(id: string): Tab | null {
    const instance = cockpit.listedInstances.find((row) => row.id === id);
    if (instance) {
      const leaf = instance.cwd.split('/').filter(Boolean).pop() ?? instance.id;
      const stored = cockpit
        .catalogOf(instance.machineId)
        .find((info) => info.sessionId === instance.sessionId);
      return {
        id,
        title: stored ? sessionTitle(stored) : leaf,
        href: `/session/${id}`,
        activity: cockpit.activityOf(id),
      };
    }
    const session = cockpit.session(id);
    if (session) {
      const leaf = session.cwd.split('/').filter(Boolean).pop() ?? id.slice(0, 8);
      return {
        id,
        title: leaf,
        href: `/session/${id}`,
        activity: cockpit.activityOf(id),
      };
    }
    return null;
  }

  const tabs = $derived(
    workingSet.order.map(resolveTab).filter((tab): tab is Tab => tab !== null)
  );
  const visible = $derived(tabs.slice(0, MAX_VISIBLE));
  const overflow = $derived(tabs.slice(MAX_VISIBLE));
  const currentId = $derived(page.params?.id ?? '');

  function navigate(id: string) {
    void goto(`/session/${id}`);
  }

  function close(event: MouseEvent, id: string) {
    event.stopPropagation();
    event.preventDefault();
    workingSet.forget(id);
    if (id === currentId && tabs.length > 1) {
      const next = tabs.find((tab) => tab.id !== id);
      if (next) void goto(next.href);
    }
  }

  function handleTabKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    const tablist = target.closest('[role="tablist"]');
    if (!tablist) return;
    const buttons = [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')];
    const at = buttons.indexOf(target);
    const next = event.key === 'ArrowRight' ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  /** The fallback list for stepping when the working set is thin. */
  const fallbackIds = $derived(cockpit.listedInstances.map((row) => row.id));

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.key !== '[' && event.key !== ']') return;
    if (isTyping()) return;
    event.preventDefault();
    const by = event.key === ']' ? 1 : -1;
    const next = workingSet.step(currentId, by, fallbackIds);
    if (next) navigate(next);
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#if visible.length > 0}
  <div
    role="tablist"
    aria-label="Open sessions"
    class="hidden items-center gap-0.5 md:flex"
  >
    {#each visible as tab (tab.id)}
      {@const active = tab.id === currentId}
      <div
        role="tab"
        aria-selected={active}
        tabindex={active ? 0 : -1}
        class="group flex h-8 max-w-[180px] cursor-default items-center gap-1.5 rounded-lg px-2.5
               text-[13px] transition-colors duration-150
               {active
                 ? 'bg-card text-foreground shadow-sm font-medium'
                 : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
        onclick={() => navigate(tab.id)}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(tab.id); } else { handleTabKeydown(e); } }}
      >
        <ActivityDot activity={tab.activity} size={1.5} />
        <span class="truncate">{tab.title}</span>
        <button
          type="button"
          tabindex={-1}
          class="ml-0.5 flex size-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity
                 hover:bg-muted group-hover:opacity-100 {active ? 'opacity-60' : ''}"
          aria-label="Close {tab.title}"
          onclick={(e) => close(e, tab.id)}
        >
          <IconClose class="size-3" />
        </button>
      </div>
    {/each}

    {#if overflow.length > 0}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="flex h-8 items-center rounded-lg px-2.5 text-[13px] text-muted-foreground
                 hover:bg-accent hover:text-accent-foreground"
        >
          +{overflow.length}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start">
          {#each overflow as tab (tab.id)}
            <DropdownMenu.Item onSelect={() => navigate(tab.id)}>
              <ActivityDot activity={tab.activity} size={1.5} />
              <span class="truncate">{tab.title}</span>
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>
{/if}

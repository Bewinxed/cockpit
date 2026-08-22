<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import { Kbd } from '$lib/components/ui/kbd';
  import { isTyping } from '$lib/utils/typing';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const mod = isMac ? '⌘' : 'Ctrl';

  interface Shortcut {
    keys: string[];
    label: string;
  }

  interface Group {
    name: string;
    shortcuts: Shortcut[];
  }

  const groups: Group[] = [
    {
      name: 'Navigate',
      shortcuts: [
        { keys: [mod, 'K'], label: 'Jump to session' },
        { keys: [mod, 'F'], label: 'Search transcript' },
        { keys: ['['], label: 'Previous session' },
        { keys: [']'], label: 'Next session' },
        { keys: ['Esc'], label: 'Dismiss' },
      ],
    },
    {
      name: 'Respond',
      shortcuts: [
        { keys: ['Y'], label: 'Allow' },
        { keys: ['A'], label: 'Allow' },
        { keys: ['N'], label: 'Deny' },
        { keys: ['D'], label: 'Deny' },
        { keys: ['⇧', 'Y'], label: 'Always allow' },
        { keys: ['1', '–', '9'], label: 'Pick option' },
        { keys: ['Enter'], label: 'Submit answer' },
      ],
    },
    {
      name: 'Compose',
      shortcuts: [
        { keys: ['Enter'], label: 'Send message' },
        { keys: ['⇧', 'Enter'], label: 'New line' },
        { keys: [mod, 'Enter'], label: 'Interrupt and send' },
      ],
    },
  ];

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === '?' && event.shiftKey && !isTyping()) {
      event.preventDefault();
      open = !open;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Keyboard shortcuts</Dialog.Title>
      <Dialog.Description>
        Keys that work across Outpost. Letter keys require no modifier.
      </Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-6 py-2">
      {#each groups as group (group.name)}
        <div>
          <h3 class="mb-2 text-[13px] font-medium text-muted-foreground">{group.name}</h3>
          <div class="grid gap-1">
            {#each group.shortcuts as shortcut (shortcut.label + shortcut.keys.join(''))}
              <div class="flex items-center justify-between rounded-[var(--radius-control)] px-2 py-1.5 hover:bg-accent">
                <span class="text-[14px]">{shortcut.label}</span>
                <span class="flex items-center gap-0.5">
                  {#each shortcut.keys as key}
                    <Kbd>{key}</Kbd>
                  {/each}
                </span>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </Dialog.Content>
</Dialog.Root>

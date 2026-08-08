<script lang="ts">
  /**
   * The mark of the operating system itself, rather than the shape of a box —
   * a laptop glyph on a Mac and a monitor glyph on a Linux tower said which
   * furniture the machine is, which is the one thing nobody needed to know.
   *
   * Drawn here rather than fetched: no icon set the app carries has the three
   * marks, and a brand mark is worth authoring once. Each sits in a 16px box
   * on the same optical weight and fills with `currentColor`, so it takes the
   * ink of whatever row it lands in.
   */
  import { cn } from '$lib/utils';
  import { IconServerDuo } from '$lib/icons';

  interface Props {
    /** The daemon's `platform-arch` fingerprint, as `machineOs` reads it. */
    os: string;
    class?: string;
  }

  let { os, class: className }: Props = $props();

  const platform = $derived(os.trim().toLowerCase().split('-')[0]);
  const shape = $derived(
    platform === 'darwin'
      ? 'apple'
      : platform === 'linux'
        ? 'tux'
        : platform === 'win32' || platform === 'windows'
          ? 'windows'
          : 'unknown'
  );
</script>

{#if shape === 'unknown'}
  <IconServerDuo class={cn('size-4 shrink-0', className)} />
{:else}
  <svg
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
    class={cn('size-4 shrink-0', className)}
  >
    {#if shape === 'apple'}
      <path
        d="M11.9 8.6c0-1.4.8-2.3 1.5-2.8-.6-.9-1.6-1.4-2.7-1.4-1.1-.1-2.2.7-2.8.7-.6 0-1.5-.7-2.4-.6C4
           4.5 2.9 5.2 2.3 6.3c-1.2 2.1-.3 5.3.9 7 .6.9 1.3 1.8 2.2 1.8.9 0 1.2-.6 2.3-.6s1.4.6 2.3.5c1-.1
           1.6-.9 2.2-1.7.4-.6.7-1.2.9-1.9-1.4-.5-2.2-1.6-2.2-2.8ZM10.2 3.3c.5-.6.8-1.4.7-2.3-.7.1-1.6.5-2.1
           1.1-.5.6-.9 1.4-.7 2.2.8.1 1.6-.4 2.1-1Z"
      />
    {:else if shape === 'tux'}
      <!-- Nonzero winding, so the belly and face are cut out of the body and
           the eyes and beak are filled back into the face. -->
      <path
        d="M8 .7C9.9.7 11.1 2.3 11.1 4.2c0 .6-.1 1.1-.1 1.5 0 .7.5 1.2 1.1 1.9 1.1 1.4 1.7 2.8 1.7 4.2 0
           1.6-1.5 2.6-5.8 2.6s-5.8-1-5.8-2.6c0-1.4.6-2.8 1.7-4.2C4.5 6.9 5 6.4 5 5.7c0-.4-.1-.9-.1-1.5C4.9
           2.3 6.1.7 8 .7ZM5.3 10.6a2.7 3 0 0 0 5.4 0 2.7 3 0 0 0-5.4 0ZM5.9 4.6a2.1 2.3 0 0 0 4.2 0 2.1 2.3
           0 0 0-4.2 0ZM6.45 4.2a.5.7 0 0 1 1 0 .5.7 0 0 1-1 0ZM8.55 4.2a.5.7 0 0 1 1 0 .5.7 0 0 1-1
           0ZM6.9 5.9a1.1.7 0 0 1 2.2 0 1.1.7 0 0 1-2.2 0ZM2.71 14.58a2.2.9-18 0 1 4.18-1.36 2.2.9-18 0
           1-4.18 1.36ZM9.11 13.22a2.2.9 18 0 1 4.18 1.36 2.2.9 18 0 1-4.18-1.36Z"
      />
    {:else}
      <path d="M7.6 2.5 15 1.4v6.1H7.6ZM6.9 2.6v4.9H1V3.4ZM6.9 8.5v4.9L1 12.6V8.5ZM7.6 8.5H15v6.1L7.6 13.5Z" />
    {/if}
  </svg>
{/if}

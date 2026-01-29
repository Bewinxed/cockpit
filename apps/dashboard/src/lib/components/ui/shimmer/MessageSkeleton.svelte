<script lang="ts">
  /**
   * MessageSkeleton - renders skeleton placeholders that match ChatMessage structure.
   * Used during SSR when we know approximately how many messages to expect.
   */

  interface Props {
    /** Number of skeleton messages to render */
    count?: number;
  }

  let { count = 3 }: Props = $props();

  // Generate varied widths for more realistic skeletons
  const widths = ['75%', '60%', '85%', '70%', '55%', '80%', '65%', '90%'];

  function getWidth(index: number): string {
    return widths[index % widths.length];
  }

  // Alternate between user-like (right aligned, shorter) and assistant-like (left, longer)
  function isUserMessage(index: number): boolean {
    return index % 3 === 0; // Every 3rd message is "user"
  }
</script>

<div class="space-y-4">
  {#each Array(count) as _item, i (i)}
    {@const isUser = isUserMessage(i)}
    <div class="flex items-start gap-3 {isUser ? 'flex-row-reverse' : ''}">
      <!-- Avatar skeleton -->
      <div
        class="shrink-0 w-9 h-9 rounded-xl shimmer-block {isUser ? 'bg-primary/20' : 'bg-muted'}"
      ></div>

      <!-- Content skeleton -->
      <div class="flex-1 space-y-2 {isUser ? 'max-w-[70%]' : 'max-w-[85%]'}">
        <!-- Header line (timestamp) -->
        <div class="h-3 w-16 rounded shimmer-block bg-muted/50"></div>

        <!-- Message lines -->
        {#if isUser}
          <!-- User messages are shorter, 1-2 lines -->
          <div class="h-4 rounded shimmer-block bg-primary/10" style:width={getWidth(i)}></div>
        {:else}
          <!-- Assistant messages are longer, multiple lines -->
          <div class="h-4 w-full rounded shimmer-block bg-muted"></div>
          <div class="h-4 rounded shimmer-block bg-muted" style:width={getWidth(i + 1)}></div>
          {#if i % 2 === 0}
            <div class="h-4 rounded shimmer-block bg-muted" style:width={getWidth(i + 2)}></div>
          {/if}
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .shimmer-block {
    position: relative;
    overflow: hidden;
  }

  .shimmer-block::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      hsl(var(--muted)) 50%,
      transparent 100%
    );
    animation: shimmer 1.5s ease-in-out infinite;
    transform: translateX(-100%);
  }

  @keyframes shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    loading: boolean;
    children: Snippet;
    /** Optional placeholder snippet to show while loading (for better skeleton structure) */
    placeholder?: Snippet;
    /** Shimmer highlight color */
    shimmerColor?: string;
    /** Base skeleton color */
    baseColor?: string;
    /** Animation duration in seconds */
    duration?: number;
    /** Fallback border radius for text elements */
    borderRadius?: string;
  }

  let {
    loading,
    children,
    placeholder,
    shimmerColor = 'hsl(var(--muted))',
    baseColor = 'hsl(var(--muted) / 0.5)',
    duration = 1.5,
    borderRadius = '4px',
  }: Props = $props();

  let containerRef = $state<HTMLDivElement | null>(null);
  let blocks = $state<Array<{ x: number; y: number; width: number; height: number; radius: string }>>([]);

  // Scan DOM and extract skeleton blocks
  function scanStructure() {
    if (!containerRef) return;

    const containerRect = containerRef.getBoundingClientRect();
    const newBlocks: typeof blocks = [];

    // Find all text nodes and inline elements
    const walker = document.createTreeWalker(
      containerRef,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          const el = node as HTMLElement;
          // Skip the shimmer overlay itself
          if (el.dataset.shimmerOverlay) return NodeFilter.FILTER_REJECT;
          // Accept elements that likely contain content
          const dominated = ['P', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'LI', 'TD', 'TH', 'LABEL', 'BUTTON', 'CODE', 'PRE'];
          const display = getComputedStyle(el).display;
          if (dominated.includes(el.tagName) || display === 'inline' || display === 'inline-block') {
            return NodeFilter.FILTER_ACCEPT;
          }
          // Also accept elements with background images or specific roles
          if (el.tagName === 'IMG' || el.tagName === 'SVG' || el.getAttribute('role') === 'img') {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    const seen = new Set<Element>();
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const el = node as HTMLElement;
      // Skip if already processed a parent
      if (Array.from(seen).some(s => s.contains(el) && s !== el)) continue;

      const rect = el.getBoundingClientRect();
      // Skip tiny or invisible elements
      if (rect.width < 8 || rect.height < 4) continue;

      const style = getComputedStyle(el);
      const radius = style.borderRadius || borderRadius;

      newBlocks.push({
        x: rect.left - containerRect.left,
        y: rect.top - containerRect.top,
        width: rect.width,
        height: rect.height,
        radius,
      });
      seen.add(el);
    }

    blocks = newBlocks;
  }

  // Re-scan when loading starts
  $effect(() => {
    if (loading && containerRef) {
      // Small delay to let DOM render with transparent text
      requestAnimationFrame(() => {
        scanStructure();
      });
    }
  });

  onMount(() => {
    if (loading) {
      requestAnimationFrame(() => scanStructure());
    }
  });
</script>

<div
  bind:this={containerRef}
  class="relative"
  style:--shimmer-color={shimmerColor}
  style:--shimmer-base={baseColor}
  style:--shimmer-duration="{duration}s"
>
  <!-- Content with transparent text when loading, or placeholder if provided -->
  <div class={loading ? 'shimmer-content-hidden' : ''}>
    {#if loading && placeholder}
      {@render placeholder()}
    {:else}
      {@render children()}
    {/if}
  </div>

  <!-- Shimmer overlay -->
  {#if loading && blocks.length > 0}
    <div class="shimmer-overlay" data-shimmer-overlay>
      {#each blocks as block, i (i)}
        <div
          class="shimmer-block"
          style:left="{block.x}px"
          style:top="{block.y}px"
          style:width="{block.width}px"
          style:height="{block.height}px"
          style:border-radius={block.radius}
        ></div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .shimmer-content-hidden {
    color: transparent !important;
    pointer-events: none;
    user-select: none;
  }

  .shimmer-content-hidden :global(*) {
    color: transparent !important;
    border-color: transparent !important;
    background-image: none !important;
  }

  .shimmer-content-hidden :global(img),
  .shimmer-content-hidden :global(svg) {
    opacity: 0;
  }

  .shimmer-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .shimmer-block {
    position: absolute;
    background: var(--shimmer-base);
    overflow: hidden;
  }

  .shimmer-block::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      var(--shimmer-color) 50%,
      transparent 100%
    );
    animation: shimmer var(--shimmer-duration) ease-in-out infinite;
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

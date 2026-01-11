<script lang="ts">
  import { X, GripVertical } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import WorkspaceInstance from './WorkspaceInstance.svelte';
  import { splitViewState, disableSplitView } from '$lib/stores/realtime.svelte';

  interface Props {
    primaryInstanceId: string;
    secondaryInstanceId: string;
  }

  let { primaryInstanceId, secondaryInstanceId }: Props = $props();

  // Split ratio (0.5 = 50/50)
  let splitRatio = $state($splitViewState.splitRatio);

  // Dragging state
  let isDragging = $state(false);
  let containerRef: HTMLDivElement | null = $state(null);

  function startDrag(e: MouseEvent) {
    e.preventDefault();
    isDragging = true;

    function onMouseMove(e: MouseEvent) {
      if (!containerRef) return;
      const rect = containerRef.getBoundingClientRect();
      const x = e.clientX - rect.left;
      // Clamp between 20% and 80%
      splitRatio = Math.max(0.2, Math.min(0.8, x / rect.width));
      splitViewState.update(s => ({ ...s, splitRatio }));
    }

    function onMouseUp() {
      isDragging = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }
</script>

<div
  class="flex-1 flex overflow-hidden relative"
  bind:this={containerRef}
  class:select-none={isDragging}
>
  <!-- Primary Pane -->
  <div class="flex flex-col overflow-hidden" style="width: {splitRatio * 100}%">
    <WorkspaceInstance instanceId={primaryInstanceId} />
  </div>

  <!-- Divider - separator is interactive element -->
  <button
    type="button"
    class="w-1 bg-border hover:bg-primary/50 cursor-col-resize flex items-center justify-center group relative transition-colors border-none p-0"
    onmousedown={startDrag}
    aria-label="Drag to resize split view"
  >
    <!-- Grip indicator -->
    <div class="absolute inset-y-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
      <GripVertical class="w-3 h-3 text-muted-foreground" />
    </div>

    <!-- Close split button (shows on hover) -->
    <Button
      variant="ghost"
      size="icon-sm"
      class="absolute top-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10 bg-background border border-border shadow-sm"
      title="Close split view"
      onclick={(e: MouseEvent) => { e.stopPropagation(); disableSplitView(); }}
    >
      <X class="w-3 h-3" />
    </Button>
  </button>

  <!-- Secondary Pane -->
  <div class="flex flex-col overflow-hidden flex-1">
    <WorkspaceInstance instanceId={secondaryInstanceId} />
  </div>
</div>

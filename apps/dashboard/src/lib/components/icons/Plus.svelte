<script lang="ts">
  // Solar has no bare plus — every "add" it ships is enclosed in a circle or
  // square, which double-encloses inside pill buttons and reads small on a
  // 32px row. This is the missing glyph, drawn to the set's own grammar:
  // 24px grid, 1.5 linear stroke, round caps, 1.2em box like unplugin's.
  import type { SVGAttributes } from 'svelte/elements';

  let { ...rest }: SVGAttributes<SVGSVGElement> = $props();
</script>

<svg xmlns="http://www.w3.org/2000/svg" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" {...rest}>
  <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
</svg>

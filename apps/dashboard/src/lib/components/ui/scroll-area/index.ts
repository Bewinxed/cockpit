// biome-ignore lint/performance/noBarrelFile: shadcn-svelte component barrel — this re-export surface is the public import path consumers use across the app
export { default as Root, default as ScrollArea } from "./scroll-area.svelte";
export {
  default as Scrollbar,
  default as ScrollAreaScrollbar,
} from "./scroll-area-scrollbar.svelte";

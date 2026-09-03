// biome-ignore lint/performance/noBarrelFile: this is the component's public API surface, re-exporting its parts under the shadcn-svelte convention
export {
  default as Root,
  //
  default as Collapsible,
} from "./collapsible.svelte";
export {
  default as Content,
  default as CollapsibleContent,
} from "./collapsible-content.svelte";
export {
  default as Trigger,
  default as CollapsibleTrigger,
} from "./collapsible-trigger.svelte";

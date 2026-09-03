// biome-ignore lint/performance/noBarrelFile: this is the shadcn-svelte component group's public re-export surface, not an accidental barrel
export { default as Root, default as HoverCard } from "./hover-card.svelte";
export {
  default as Content,
  default as HoverCardContent,
} from "./hover-card-content.svelte";
export {
  default as Portal,
  default as HoverCardPortal,
} from "./hover-card-portal.svelte";
export {
  default as Trigger,
  default as HoverCardTrigger,
} from "./hover-card-trigger.svelte";

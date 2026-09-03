// biome-ignore lint/performance/noBarrelFile: public entry point for the avatar component group, consumed as a unit under the shadcn-svelte convention
export {
  default as Root,
  //
  default as Avatar,
} from "./avatar.svelte";
export {
  default as Badge,
  default as AvatarBadge,
} from "./avatar-badge.svelte";
export {
  default as Fallback,
  default as AvatarFallback,
} from "./avatar-fallback.svelte";
export {
  default as Group,
  default as AvatarGroup,
} from "./avatar-group.svelte";
export {
  default as GroupCount,
  default as AvatarGroupCount,
} from "./avatar-group-count.svelte";
export {
  default as Image,
  default as AvatarImage,
} from "./avatar-image.svelte";

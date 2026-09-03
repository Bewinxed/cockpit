// biome-ignore lint/performance/noBarrelFile: shadcn-svelte component barrel — every consumer imports the group from this index
export {
  default as Root,
  //
  default as Toggle,
  type ToggleSize,
  type ToggleVariant,
  type ToggleVariants,
  toggleVariants,
} from "./toggle.svelte";

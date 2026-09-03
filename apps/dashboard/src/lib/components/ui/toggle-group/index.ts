// biome-ignore lint/performance/noBarrelFile: shadcn-svelte component barrel — every consumer imports the group from this index
export {
  default as Root,
  //
  default as ToggleGroup,
} from "./toggle-group.svelte";
export {
  default as Item,
  default as ToggleGroupItem,
} from "./toggle-group-item.svelte";

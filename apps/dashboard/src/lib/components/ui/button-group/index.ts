// biome-ignore lint/performance/noBarrelFile: this is the component's public API surface, re-exporting its parts under the shadcn-svelte convention
export {
  type ButtonGroupOrientation,
  buttonGroupVariants,
  default as Root,
  //
  default as ButtonGroup,
} from "./button-group.svelte";
export {
  default as Separator,
  default as ButtonGroupSeparator,
} from "./button-group-separator.svelte";
export {
  default as Text,
  default as ButtonGroupText,
} from "./button-group-text.svelte";

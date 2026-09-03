// biome-ignore lint/performance/noBarrelFile: shadcn-svelte component barrel — this re-export surface is the public import path consumers use across the app
export {
  default as Root,
  default as NativeSelect,
} from "./native-select.svelte";
export {
  default as OptGroup,
  default as NativeSelectOptGroup,
} from "./native-select-opt-group.svelte";
export {
  default as Option,
  default as NativeSelectOption,
} from "./native-select-option.svelte";

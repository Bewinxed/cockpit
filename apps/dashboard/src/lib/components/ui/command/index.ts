// biome-ignore lint/performance/noBarrelFile: this is the component's public API surface, re-exporting its parts under the shadcn-svelte convention
export {
  default as Root,
  //
  default as Command,
} from "./command.svelte";
export {
  default as Dialog,
  default as CommandDialog,
} from "./command-dialog.svelte";
export {
  default as Empty,
  default as CommandEmpty,
} from "./command-empty.svelte";
export {
  default as Group,
  default as CommandGroup,
} from "./command-group.svelte";
export {
  default as Input,
  default as CommandInput,
} from "./command-input.svelte";
export { default as Item, default as CommandItem } from "./command-item.svelte";
export {
  default as LinkItem,
  default as CommandLinkItem,
} from "./command-link-item.svelte";
export { default as List, default as CommandList } from "./command-list.svelte";
export {
  default as Loading,
  default as CommandLoading,
} from "./command-loading.svelte";
export {
  default as Separator,
  default as CommandSeparator,
} from "./command-separator.svelte";
export {
  default as Shortcut,
  default as CommandShortcut,
} from "./command-shortcut.svelte";

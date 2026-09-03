// biome-ignore lint/performance/noBarrelFile: shadcn-svelte component barrel — this re-export surface is the public import path consumers use across the app
export { Pane, Pane as ResizablePane } from "paneforge";
export {
  default as Handle,
  default as ResizableHandle,
} from "./resizable-handle.svelte";
export {
  default as PaneGroup,
  default as ResizablePaneGroup,
} from "./resizable-pane-group.svelte";

// biome-ignore lint/performance/noBarrelFile: shadcn-svelte component barrel — this re-export surface is the public import path consumers use across the app
export { default as Root, default as RadioGroup } from "./radio-group.svelte";
export {
  default as Item,
  default as RadioGroupItem,
} from "./radio-group-item.svelte";

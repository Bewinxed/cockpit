// biome-ignore lint/performance/noBarrelFile: public entry point for the badge component, consumed under the shadcn-svelte convention
export {
  type BadgeVariant,
  badgeVariants,
  default as Badge,
} from "./badge.svelte";

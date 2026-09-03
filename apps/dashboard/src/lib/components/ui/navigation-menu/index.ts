// biome-ignore lint/performance/noBarrelFile: shadcn-svelte component barrel — this re-export surface is the public import path consumers use across the app
export {
  default as Root,
  default as NavigationMenuRoot,
} from "./navigation-menu.svelte";
export {
  default as Content,
  default as NavigationMenuContent,
} from "./navigation-menu-content.svelte";
export {
  default as Indicator,
  default as NavigationMenuIndicator,
} from "./navigation-menu-indicator.svelte";
export {
  default as Item,
  default as NavigationMenuItem,
} from "./navigation-menu-item.svelte";
export {
  default as Link,
  default as NavigationMenuLink,
} from "./navigation-menu-link.svelte";
export {
  default as List,
  default as NavigationMenuList,
} from "./navigation-menu-list.svelte";
export {
  default as Trigger,
  default as NavigationMenuTrigger,
} from "./navigation-menu-trigger.svelte";
export {
  default as Viewport,
  default as NavigationMenuViewport,
} from "./navigation-menu-viewport.svelte";

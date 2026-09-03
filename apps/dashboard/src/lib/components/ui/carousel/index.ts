// biome-ignore lint/performance/noBarrelFile: this is the component's public API surface, re-exporting its parts under the shadcn-svelte convention
export {
  default as Root,
  //
  default as Carousel,
} from "./carousel.svelte";
export {
  default as Content,
  default as CarouselContent,
} from "./carousel-content.svelte";
export {
  default as Item,
  default as CarouselItem,
} from "./carousel-item.svelte";
export {
  default as Next,
  default as CarouselNext,
} from "./carousel-next.svelte";
export {
  default as Previous,
  default as CarouselPrevious,
} from "./carousel-previous.svelte";

// biome-ignore lint/performance/noBarrelFile: shadcn-svelte component barrel — this re-export surface is the public import path consumers use across the app
export { default as Root, default as Pagination } from "./pagination.svelte";
export {
  default as Content,
  default as PaginationContent,
} from "./pagination-content.svelte";
export {
  default as Ellipsis,
  default as PaginationEllipsis,
} from "./pagination-ellipsis.svelte";
export {
  default as Item,
  default as PaginationItem,
} from "./pagination-item.svelte";
export {
  default as Link,
  default as PaginationLink,
} from "./pagination-link.svelte";
export {
  default as Next,
  default as PaginationNext,
} from "./pagination-next.svelte";
export {
  default as NextButton,
  default as PaginationNextButton,
} from "./pagination-next-button.svelte"; // old
export {
  default as PrevButton,
  default as PaginationPrevButton,
} from "./pagination-prev-button.svelte"; // old
export {
  default as Previous,
  default as PaginationPrevious,
} from "./pagination-previous.svelte";

// biome-ignore lint/performance/noBarrelFile: public entry point for the accordion component group, consumed as a unit under the shadcn-svelte convention
export {
  default as Root,
  //
  default as Accordion,
} from "./accordion.svelte";
export {
  default as Content,
  default as AccordionContent,
} from "./accordion-content.svelte";
export {
  default as Item,
  default as AccordionItem,
} from "./accordion-item.svelte";
export {
  default as Trigger,
  default as AccordionTrigger,
} from "./accordion-trigger.svelte";

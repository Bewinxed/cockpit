/// <reference types="unplugin-icons/types/svelte" />
// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  // biome-ignore lint/style/noNamespace: SvelteKit's app.d.ts convention requires the global App namespace for ambient typing hooks
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};

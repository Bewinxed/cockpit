import { MediaQuery } from 'svelte/reactivity';

export const FLIP_MS = 160;

export const reducedMotion = new MediaQuery('prefers-reduced-motion: reduce');

export const flipDurationMs = (): number => (reducedMotion.current ? 0 : FLIP_MS);

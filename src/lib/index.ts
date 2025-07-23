export { default as inlineSveltePlugin } from "./plugins/inline-component.js";
export type InlineComponent = (
  _strings: TemplateStringsArray,
  ..._vals: unknown[]
) => import("svelte").Component;

export type InlineSnippet<T = unknown> = (
  anchor: import("svelte").ComponentInternals,
  ...props: (() => T)[]
) => void;

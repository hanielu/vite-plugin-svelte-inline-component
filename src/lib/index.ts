export { default as inlineSveltePlugin } from "./plugins/inline-component.js";
export type InlineComponent = (
  _strings: TemplateStringsArray,
  ..._vals: unknown[]
) => Promise<import("svelte").Component>;

import type { Component } from "svelte";
import inlineSveltePlugin from "./plugins/inline-component.js";

// Reexport your entry components here
export { inlineSveltePlugin };
export type InlineComponent = (
  _strings: TemplateStringsArray,
  ..._vals: unknown[]
) => Promise<Component>;

export type InlineComponent = (
  _strings: TemplateStringsArray,
  ..._vals: unknown[]
) => import("svelte").Component;

export type InlineSnippet<T = unknown> = (
  anchor: import("svelte").ComponentInternals,
  ...props: (() => T)[]
) => void;

export const html: InlineComponent = () => {
  return {} as any;
};
export const svelte: InlineComponent = () => {
  return {} as any;
};

/**
 * Brings other inline components into scope for the tagged template that
 * follows, e.g. `scope(Frank).html\`<div><Frank /></div>\``.
 *
 * The tag stays directly before the backtick so editor extensions
 * (e.g. lit-html) keep highlighting the markup. The plugin compiles this
 * away; the runtime value is never used.
 */
export const scope = (..._deps: unknown[]): { html: InlineComponent; svelte: InlineComponent } => {
  return { html, svelte };
};

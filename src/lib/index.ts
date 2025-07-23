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

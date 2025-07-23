import { compile } from "svelte/compiler";
import { createHash } from "crypto";
import MagicString from "magic-string";
import type { Plugin } from "vite";

/**
 * vite:inline-svelte — Vite pre-transform that treats tagged template literals
 * as inline Svelte components.
 *
 * Any template literal whose *tag* is in `options.tags` (defaults to
 * `['html', 'svelte']`) is extracted, compiled with the Svelte compiler, and
 * replaced with an `import` pointing at a virtual module that returns the
 * compiled component.
 *
 * ```ts
 * const Button = html`
 *   <script>
 *     let { label } = $props();
 *   </script>
 *   <button>{label}</button>
 * `;
 * ```
 *
 * becomes →
 *
 * ```ts
 * import Button_e4f9d2 from 'virtual:inline-svelte/e4f9d2.js';
 * const Button = Button_e4f9d2;
 * ```
 */
export interface InlineSvelteOptions {
  /**
   * Template‑tag names that should be treated as Svelte markup.
   * Example: `tags: ['html', 'svelte', 'svx']`.
   * @default ['html', 'svelte']
   */
  tags?: string[];
}

/** RegExp‑safe escape */
const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True for .ts/.tsx/.js/.jsx user files (skips node_modules) */
function isUserSource(id: string): boolean {
  return !id.includes("/node_modules/") && /\.(c?[tj]sx?)$/.test(id);
}

export default function inlineSveltePlugin({
  tags = ["html", "svelte"],
}: InlineSvelteOptions = {}): Plugin {
  // Build one big RegExp that matches any of the allowed tags.
  const tagGroup = tags.map(escapeRegExp).join("|");
  const templateRe = new RegExp(`(?:${tagGroup})\\s*` + "`([\\s\\S]*?)`", "g");

  // Virtual module bookkeeping
  const VIRTUAL_PREFIX = "virtual:inline-svelte/";
  const RESOLVED_PREFIX = "\0" + VIRTUAL_PREFIX; // Vite‑internal resolved form
  const templateCache = new Map<string, string>(); // virtualId → source markup

  return {
    name: "vite-plugin-svelte-inline-component",
    enforce: "pre",

    /**
     * Scan each JS/TS file for matching template literals.
     * Replace them with an import of the compiled virtual module.
     */
    transform(sourceCode, id) {
      if (!isUserSource(id)) return;

      const ms = new MagicString(sourceCode);
      let edited = false;
      let match: RegExpExecArray | null;

      while ((match = templateRe.exec(sourceCode))) {
        const markup = match[1];
        const hash = createHash("sha1").update(markup).digest("hex").slice(0, 8);
        const virtualId = `${VIRTUAL_PREFIX}${hash}.js`;
        const localName = `Inline_${hash}`;

        templateCache.set(virtualId, markup);
        ms.prepend(`import ${localName} from '${virtualId}';\n`);
        ms.overwrite(match.index, templateRe.lastIndex, localName);
        edited = true;
      }

      return edited ? { code: ms.toString(), map: ms.generateMap({ hires: true }) } : null;
    },

    /** Turn `virtual:inline-svelte/xxxxx.js` into an internal id. */
    resolveId(id) {
      return id.startsWith(VIRTUAL_PREFIX)
        ? RESOLVED_PREFIX + id.slice(VIRTUAL_PREFIX.length)
        : undefined;
    },

    /** Compile the cached markup into JS when Vite loads the virtual module. */
    load(id) {
      if (!id.startsWith(RESOLVED_PREFIX)) return;
      const markup = templateCache.get(VIRTUAL_PREFIX + id.slice(RESOLVED_PREFIX.length))!;
      return compile(markup, {
        generate: "client",
        css: "injected",
        filename: id,
        runes: true,
      }).js.code;
    },
  };
}

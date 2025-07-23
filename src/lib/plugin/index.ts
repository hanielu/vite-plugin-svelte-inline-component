import { compile } from "svelte/compiler";
import { createHash } from "crypto";
import MagicString from "magic-string";
import type { Plugin } from "vite";

export interface InlineSvelteOptions {
  /** Template‑tag names treated as Svelte markup – default `["html", "svelte"]` */
  tags?: string[];
  /** Comment that *starts* an import fence – default `/* svelte:imports` */
  fenceStart?: string;
  /** Comment that *ends* an import fence – default `*\/` */
  fenceEnd?: string;
}

/* ───────── helpers ───────── */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isUserSource = (id: string) => !id.includes("/node_modules/") && /\.(c?[tj]sx?)$/.test(id);

/** Inject shared imports without duplicating instance `<script>` blocks */
function applyImports(markup: string, imports: string): string {
  if (!imports) return markup;

  const scriptRE = /<script(?![^>]*context=["']module["'])[^>]*>/i;
  const m = scriptRE.exec(markup);
  if (m) {
    const idx = m.index + m[0].length;
    return markup.slice(0, idx) + "\n" + imports + "\n" + markup.slice(idx);
  }
  return `<script>\n${imports}\n</script>\n` + markup;
}

/* ───────── plugin ───────── */

export default function inlineSveltePlugin({
  tags = ["html", "svelte"],
  fenceStart = "/* svelte:imports",
  fenceEnd = "*/",
}: InlineSvelteOptions = {}): Plugin {
  const tagGroup = tags.map(esc).join("|");
  const tplRE = new RegExp(`(?:${tagGroup})\\s*\`([\\s\\S]*?)\``, "g");
  const fenceRE = new RegExp(`${esc(fenceStart)}([\\s\\S]*?)${esc(fenceEnd)}`, "m");

  const VIRT = "virtual:inline-svelte/";
  const RSLV = "\0" + VIRT;

  /** virtualId → full markup (with injected imports) */
  const cache = new Map<string, string>();

  return {
    name: "@hvniel/vite-plugin-svelte-inline-component",
    enforce: "pre",

    transform(code, id) {
      if (!isUserSource(id)) return;

      /* file‑level shared imports (may be empty) */
      const imports = (fenceRE.exec(code)?.[1] ?? "").trim();

      const ms = new MagicString(code);
      const hashToLocal = new Map<string, string>(); // dedupe within THIS pass
      let edited = false,
        m: RegExpExecArray | null;

      while ((m = tplRE.exec(code))) {
        const rawMarkup = m[1];
        const markup = applyImports(rawMarkup, imports);
        const hash = createHash("sha1").update(markup).digest("hex").slice(0, 8);

        /* reuse the same local var if this hash appears again in the file */
        let local = hashToLocal.get(hash);
        if (!local) {
          local = `Inline_${hash}`;
          hashToLocal.set(hash, local);

          const virt = `${VIRT}${hash}.js`;
          if (!cache.has(virt)) cache.set(virt, markup);

          const ns = `__InlineNS_${hash}`;
          ms.prepend(
            `import * as ${ns} from '${virt}';\n` +
              `const ${local}=Object.assign(${ns}.default, ${ns});\n`
          );
        }

        ms.overwrite(m.index, tplRE.lastIndex, local);
        edited = true;
      }

      return edited ? { code: ms.toString(), map: ms.generateMap({ hires: true }) } : null;
    },

    resolveId(id) {
      return id.startsWith(VIRT) ? RSLV + id.slice(VIRT.length) : undefined;
    },

    load(id) {
      if (!id.startsWith(RSLV)) return;

      const markup = cache.get(VIRT + id.slice(RSLV.length))!;
      return compile(markup, {
        generate: "client",
        css: "injected",
        filename: id,
      }).js.code;
    },
  };
}

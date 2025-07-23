import { compile } from "svelte/compiler";
import { createHash } from "crypto";
import MagicString from "magic-string";
import type { Plugin } from "vite";

export interface InlineSvelteOptions {
  /** Template‑tag names treated as Svelte markup */
  tags?: string[];
  /** Comment that *starts* an import fence – default `/* svelte:imports` */
  fenceStart?: string;
  /** Comment that *ends* an import fence – default `*\/` */
  fenceEnd?: string;
}

/* ───────────────────── helpers ───────────────────── */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isUserSource = (id: string) => !id.includes("/node_modules/") && /\.(c?[tj]sx?)$/.test(id);

/* ───────────────────── plugin ───────────────────── */

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
  const cache = new Map<string, { src: string; imports: string }>();

  return {
    name: "@hvniel/vite-plugin-svelte-inline-component",
    enforce: "pre",

    transform(code, id) {
      if (!isUserSource(id)) return;

      /* 1️⃣  read the optional import‑fence once per file */
      const imports = (fenceRE.exec(code)?.[1] ?? "").trim();

      /* 2️⃣  replace each tagged template with a virtual‑module import */
      const ms = new MagicString(code);
      let m: RegExpExecArray | null,
        edited = false;

      while ((m = tplRE.exec(code))) {
        const src = m[1];
        const hash = createHash("sha1")
          .update(src + imports)
          .digest("hex")
          .slice(0, 8);
        const virt = `${VIRT}${hash}.js`;
        const local = `Inline_${hash}`;

        cache.set(virt, { src, imports });
        ms.prepend(`import ${local} from '${virt}';\n`);
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

      const { src, imports } = cache.get(VIRT + id.slice(RSLV.length))!;
      const compiled = compile(src, {
        generate: "client",
        css: "injected",
        filename: id,
      }).js.code;

      /* prepend shared imports to the JS **after** compilation → no duplicate <script> tags */
      return (imports ? `${imports}\n` : "") + compiled;
    },
  };
}

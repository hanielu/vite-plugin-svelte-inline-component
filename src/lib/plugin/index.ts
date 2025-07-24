import { compile } from "svelte/compiler";
import { createHash } from "crypto";
import MagicString from "magic-string";
import type { Plugin } from "vite";

export interface InlineSvelteOptions {
  /** Template-tag names treated as Svelte markup – default `["html", "svelte"]` */
  tags?: string[];
  /** Comment that *starts* an import fence – default `/* svelte:imports` */
  fenceStart?: string;
  /** Comment that *ends* an import fence – default `*\/` */
  fenceEnd?: string;
  /** Comment that *starts* a globals fence – default `/* svelte:globals` */
  globalsStart?: string;
  /** Comment that *ends* a globals fence – default `*\/` */
  globalsEnd?: string;
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
  globalsStart = "/* svelte:globals",
  globalsEnd = "*/",
}: InlineSvelteOptions = {}): Plugin {
  const tagGroup = tags.map(esc).join("|");
  const tplRE = new RegExp(`(?:${tagGroup})\\s*\`([\\s\\S]*?)\``, "g");
  const fenceRE = new RegExp(`${esc(fenceStart)}([\\s\\S]*?)${esc(fenceEnd)}`, "m");
  const globalsRE = new RegExp(`${esc(globalsStart)}([\\s\\S]*?)${esc(globalsEnd)}`, "m");
  const globalDefRE = /const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:html|svelte)\s*\`([\s\S]*?)\`/g;

  const VIRT = "virtual:inline-svelte/";
  const RSLV = "\0" + VIRT;

  /** virtualId → full markup (with injected imports) */
  const cache = new Map<string, string>();

  return {
    name: "@hvniel/vite-plugin-svelte-inline-component",
    enforce: "pre",

    transform(code, id) {
      if (!isUserSource(id)) return;

      const ms = new MagicString(code);
      let edited = false;

      /* file‑level shared imports (may be empty) */
      const imports = (fenceRE.exec(code)?.[1] ?? "").trim();

      let importsToAdd = "";
      let constsToAdd = "";
      let globalImportsForTpl = "";
      const hashToLocal = new Map<string, string>(); // dedupe within THIS pass

      /* 1. Process globals */
      const globalsMatch = globalsRE.exec(code);
      if (globalsMatch) {
        edited = true;
        const globalsContent = globalsMatch[1] ?? "";
        // Overwrite the entire globals block so it's removed from the final output
        ms.overwrite(globalsMatch.index, globalsMatch.index + globalsMatch[0].length, "");

        let defMatch: RegExpExecArray | null;
        while ((defMatch = globalDefRE.exec(globalsContent))) {
          const compName = defMatch[1];
          const rawMarkup = defMatch[2];
          // Globals can also use file-level imports from the `svelte:imports` fence
          const markup = applyImports(rawMarkup, imports);
          const hash = createHash("sha1").update(markup).digest("hex").slice(0, 8);

          let local = hashToLocal.get(hash);
          if (!local) {
            local = `Inline_${hash}`;
            hashToLocal.set(hash, local);

            const virt = `${VIRT}${hash}.js`;
            if (!cache.has(virt)) cache.set(virt, markup);

            const ns = `__InlineNS_${hash}`;
            importsToAdd +=
              `import * as ${ns} from '${virt}';\n` +
              `const ${local}=Object.assign(${ns}.default, ${ns});\n`;

            // This import will be injected into the <script> of other templates
            globalImportsForTpl += `import ${compName} from '${virt}';\n`;
          }
          // Create the top-level constant for the global component
          constsToAdd += `const ${compName} = ${local};\n`;
        }
      }

      /* 2. Process all regular templates */
      let m: RegExpExecArray | null;
      tplRE.lastIndex = 0; // Reset regex state
      while ((m = tplRE.exec(code))) {
        // Skip any templates found inside the globals block, as they've already been processed.
        if (
          globalsMatch &&
          m.index >= globalsMatch.index &&
          m.index < globalsMatch.index + globalsMatch[0].length
        ) {
          continue;
        }

        const rawMarkup = m[1];
        // Inject imports for global components first, then file-level imports
        const markupWithGlobals = applyImports(rawMarkup, globalImportsForTpl);
        const markup = applyImports(markupWithGlobals, imports);
        const hash = createHash("sha1").update(markup).digest("hex").slice(0, 8);

        let local = hashToLocal.get(hash);
        if (!local) {
          local = `Inline_${hash}`;
          hashToLocal.set(hash, local);

          const virt = `${VIRT}${hash}.js`;
          if (!cache.has(virt)) cache.set(virt, markup);

          const ns = `__InlineNS_${hash}`;
          importsToAdd +=
            `import * as ${ns} from '${virt}';\n` +
            `const ${local}=Object.assign(${ns}.default, ${ns});\n`;
        }

        ms.overwrite(m.index, tplRE.lastIndex, local);
        edited = true;
      }

      /* 3. Prepend all generated code */
      if (edited) {
        // Prepend consts first, then imports, to respect declaration order.
        ms.prepend(constsToAdd);
        ms.prepend(importsToAdd);
        return { code: ms.toString(), map: ms.generateMap({ hires: true }) };
      }

      return null;
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

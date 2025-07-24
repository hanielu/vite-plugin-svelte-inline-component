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
  // FIX: Simplified the regex to remove a problematic negative lookahead that was preventing multiple matches.
  const globalDefWithTplRE = new RegExp(
    `(const\\s+([a-zA-Z0-9_$]+)\\s*=\\s*)((?:${tagGroup})\\s*\`[\\s\\S]*?\`)`,
    "g"
  );

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

      const imports = (fenceRE.exec(code)?.[1] ?? "").trim();

      let importsToAdd = "";
      let globalImportsForTpl = "";
      let hoistedCode = "";
      const hashToLocal = new Map<string, string>();
      const globalVarDefs = new Map<string, string>();
      const globalComponentNames = new Set<string>();

      /* 1. Process globals */
      const globalsMatch = globalsRE.exec(code);
      if (globalsMatch) {
        edited = true;
        const globalsContent = globalsMatch[1] ?? "";
        ms.overwrite(globalsMatch.index, globalsMatch.index + globalsMatch[0].length, "");

        globalDefWithTplRE.lastIndex = 0;

        hoistedCode = globalsContent.replace(
          globalDefWithTplRE,
          (match, declaration: string, compName: string, templateLiteral: string) => {
            globalComponentNames.add(compName);
            const rawMarkup = templateLiteral.match(/`([\s\S]*?)`/)[1];
            const markup = applyImports(rawMarkup, imports);
            const hash = createHash("sha1").update(markup).digest("hex").slice(0, 8);

            let local = hashToLocal.get(hash);
            if (!local) {
              local = `Inline_${hash}`;
              hashToLocal.set(hash, local);
              const virt = `${VIRT}${hash}.js`;
              if (!cache.has(virt)) cache.set(virt, markup);
              const ns = `__InlineNS_${hash}`;
              importsToAdd += `import * as ${ns} from '${virt}';\nconst ${local}=Object.assign(${ns}.default, ${ns});\n`;
              globalImportsForTpl += `import ${compName} from '${virt}';\n`;
            }
            return `${declaration}${local}`;
          }
        );

        const varLines = hoistedCode
          .split("\n")
          .filter(line => line.trim().match(/^(const|let|var)\s/));
        for (const line of varLines) {
          const nameMatch = line.match(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)/);
          if (nameMatch) {
            globalVarDefs.set(nameMatch[1], line);
          }
        }
      }

      /* 2. Process all regular templates */
      let m: RegExpExecArray | null;
      tplRE.lastIndex = 0;
      while ((m = tplRE.exec(code))) {
        if (
          globalsMatch &&
          m.index >= globalsMatch.index &&
          m.index < globalsMatch.index + globalsMatch[0].length
        ) {
          continue;
        }

        const rawMarkup = m[1];
        const scriptContentRE = /<script.*?>([\s\S]*?)<\/script>/;
        const existingScriptContent = rawMarkup.match(scriptContentRE)?.[1] ?? "";
        let scriptToInject = globalImportsForTpl;

        for (const [name, definition] of globalVarDefs.entries()) {
          if (globalComponentNames.has(name)) continue;

          const isUsedInTemplate = new RegExp(`\\b${name}\\b`).test(rawMarkup);
          if (isUsedInTemplate && !existingScriptContent.includes(name)) {
            scriptToInject += `\n${definition}`;
          }
        }

        const markupWithGlobals = applyImports(rawMarkup, scriptToInject);
        const markup = applyImports(markupWithGlobals, imports);
        const hash = createHash("sha1").update(markup).digest("hex").slice(0, 8);

        let local = hashToLocal.get(hash);
        if (!local) {
          local = `Inline_${hash}`;
          hashToLocal.set(hash, local);
          const virt = `${VIRT}${hash}.js`;
          if (!cache.has(virt)) cache.set(virt, markup);
          const ns = `__InlineNS_${hash}`;
          importsToAdd += `import * as ${ns} from '${virt}';\nconst ${local}=Object.assign(${ns}.default, ${ns});\n`;
        }

        ms.overwrite(m.index, tplRE.lastIndex, local);
        edited = true;
      }

      /* 3. Prepend all generated code */
      if (edited) {
        ms.prepend(hoistedCode + "\n");
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

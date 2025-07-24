import { compile } from "svelte/compiler";
import { createHash } from "crypto";
import MagicString from "magic-string";
import type { Plugin } from "vite";

export interface InlineSvelteOptions {
  /** Template-tag names treated as Svelte markup. Default: `["html", "svelte"]` */
  tags?: string[];
  /** Comment that *starts* an import fence. Default: `/* svelte:imports` */
  fenceStart?: string;
  /** Comment that *ends* an import fence. Default: `*\/` */
  fenceEnd?: string;
  /** Comment that *starts* a global components fence. Default: `/* svelte:globals` */
  globalsFenceStart?: string;
}

/* ───────── helpers ───────── */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isUserSource = (id: string) => !id.includes("/node_modules/") && /\.(c?[tj]sx?)$/.test(id);

/** Injects a string of script content into a Svelte component's markup. */
function applyScriptContent(markup: string, scriptContent: string): string {
  if (!scriptContent) return markup;

  const scriptRE = /<script(?![^>]*context=["']module["'])[^>]*>/i;
  const match = scriptRE.exec(markup);

  if (match) {
    const idx = match.index + match[0].length;
    return `${markup.slice(0, idx)}\n${scriptContent}\n${markup.slice(idx)}`;
  } else {
    return `<script>\n${scriptContent}\n</script>\n${markup}`;
  }
}

/* ───────── plugin ───────── */

export default function inlineSveltePlugin({
  tags = ["html", "svelte"],
  fenceStart = "/* svelte:imports",
  fenceEnd = "*/",
  globalsFenceStart = "/* svelte:globals",
}: InlineSvelteOptions = {}): Plugin {
  const tagGroup = tags.map(esc).join("|");
  const tplRE = new RegExp(
    `(?:const|let|var)\\s+([a-zA-Z0-9_$]+)\\s*=\\s*(?:${tagGroup})\\s*\`([\\s\\S]*?)\``,
    "g"
  );
  const importsFenceRE = new RegExp(`${esc(fenceStart)}([\\s\\S]*?)${esc(fenceEnd)}`, "m");
  const globalsFenceRE = new RegExp(`${esc(globalsFenceStart)}([\\s\\S]*?)${esc(fenceEnd)}`, "m");

  const VIRT_PREFIX = "virtual:inline-svelte/";
  const RSLV_PREFIX = `\0${VIRT_PREFIX}`;

  const cache = new Map<string, string>();

  return {
    name: "@hvniel/vite-plugin-svelte-inline-component-v3",
    enforce: "pre",

    transform(code, id) {
      if (!isUserSource(id) || !tags.some(tag => code.includes(tag))) {
        return;
      }

      const ms = new MagicString(code);
      let edited = false;

      // === STAGE 1: Process `svelte:imports` fence ===
      const importsMatch = importsFenceRE.exec(code);
      const standardImports = (importsMatch?.[1] ?? "").trim();

      // === STAGE 2: Process `svelte:globals` fence ===
      const globalsMatch = globalsFenceRE.exec(code);
      // This will hold the full script block (imports + consts) for global components
      let globalScriptBlock = "";
      const hashToLocal = new Map<string, string>();

      if (globalsMatch) {
        const globalsContent = globalsMatch[1];
        const globalsStartIndex = globalsMatch.index;
        let match: RegExpExecArray | null;

        tplRE.lastIndex = 0; // Reset regex before scanning fence content
        while ((match = tplRE.exec(globalsContent))) {
          const [fullMatch, componentName, rawMarkup] = match;

          const finalMarkup = applyScriptContent(rawMarkup, standardImports);
          const hash = createHash("sha1").update(finalMarkup).digest("hex").slice(0, 8);

          let local = hashToLocal.get(hash);
          if (!local) {
            local = `_Inline_${hash}`;
            hashToLocal.set(hash, local);

            const virtId = `${VIRT_PREFIX}${hash}.js`;
            if (!cache.has(virtId)) cache.set(virtId, finalMarkup);

            const ns = `_InlineNS_${hash}`;
            const importStatement = `import * as ${ns} from '${virtId}';`;
            const localDefStatement = `const ${local} = Object.assign(${ns}.default, ${ns});`;

            // Prepend the import to the top of the file for resolution
            ms.prepend(`${importStatement}\n${localDefStatement}\n`);

            // **FIX**: Build a full script block to inject into local components
            // This includes the necessary import and the const declarations.
            const aliasStatement = `const ${componentName} = ${local};`;
            globalScriptBlock += `${importStatement}\n${localDefStatement}\n${aliasStatement}\n`;
          } else {
            // If the component was already processed, just add its alias declaration
            globalScriptBlock += `const ${componentName} = ${local};\n`;
          }

          ms.overwrite(
            globalsStartIndex + match.index,
            globalsStartIndex + match.index + fullMatch.length,
            `const ${componentName} = ${local};`
          );
          edited = true;
        }
        ms.remove(globalsStartIndex, globalsStartIndex + globalsMatch[0].length);
      }

      // === STAGE 3: Process remaining "local" inline components ===
      let match: RegExpExecArray | null;
      tplRE.lastIndex = 0;

      while ((match = tplRE.exec(code))) {
        if (
          globalsMatch &&
          match.index >= globalsMatch.index &&
          match.index < globalsMatch.index + globalsMatch[0].length
        ) {
          continue;
        }

        const [fullMatch, componentName, rawMarkup] = match;

        // Inject standard imports AND the full script block for global components
        const scriptToInject = `${standardImports}\n${globalScriptBlock}`;
        const finalMarkup = applyScriptContent(rawMarkup, scriptToInject);

        const hash = createHash("sha1").update(finalMarkup).digest("hex").slice(0, 8);

        let local = hashToLocal.get(hash);
        if (!local) {
          local = `_Inline_${hash}`;
          hashToLocal.set(hash, local);

          const virtId = `${VIRT_PREFIX}${hash}.js`;
          if (!cache.has(virtId)) cache.set(virtId, finalMarkup);

          const ns = `_InlineNS_${hash}`;
          ms.prepend(
            `import * as ${ns} from '${virtId}';\n` +
              `const ${local} = Object.assign(${ns}.default, ${ns});\n`
          );
        }

        ms.overwrite(
          match.index,
          match.index + fullMatch.length,
          `const ${componentName} = ${local};`
        );
        edited = true;
      }

      if (!edited) return null;

      return {
        code: ms.toString(),
        map: ms.generateMap({ hires: true }),
      };
    },

    resolveId(id) {
      return id.startsWith(VIRT_PREFIX) ? RSLV_PREFIX + id.slice(VIRT_PREFIX.length) : undefined;
    },

    load(id) {
      if (!id.startsWith(RSLV_PREFIX)) return;

      const markup = cache.get(VIRT_PREFIX + id.slice(RSLV_PREFIX.length))!;
      return compile(markup, {
        generate: "client",
        css: "injected",
        filename: id,
      }).js.code;
    },
  };
}

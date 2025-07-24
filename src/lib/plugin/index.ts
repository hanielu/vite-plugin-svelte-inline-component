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

function getTransitiveDependencies(
  entryPoints: Set<string>,
  dependencyGraph: Map<string, Set<string>>
): Set<string> {
  const resolved = new Set<string>();
  const queue = [...entryPoints];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (resolved.has(current)) continue;

    resolved.add(current);
    const dependencies = dependencyGraph.get(current);
    if (dependencies) {
      for (const dep of dependencies) {
        queue.push(dep);
      }
    }
  }
  return resolved;
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
  const globalDefRE = new RegExp(
    `^const\\s+([a-zA-Z0-9_$]+)\\s*=\\s*(?:${tagGroup})\\s*(\`[\\s\\S]*?\`)`,
    "gm"
  );

  const VIRT = "virtual:inline-svelte/";
  const RSLV = "\0" + VIRT;

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
      let hoistedCode = "";
      const hashToLocal = new Map<string, string>();
      const globalComponentNames = new Set<string>();
      const globalVarDefs = new Map<string, string>();
      const depGraph = new Map<string, Set<string>>();
      let allGlobalNames: string[] = [];
      let globalImportsForTpl = "";

      /* 1. Process globals */
      const globalsMatch = globalsRE.exec(code);
      if (globalsMatch) {
        edited = true;
        const globalsContent = globalsMatch[1] ?? "";
        ms.overwrite(globalsMatch.index, globalsMatch.index + globalsMatch[0].length, "");

        const componentMatches = [...globalsContent.matchAll(globalDefRE)];
        componentMatches.forEach(match => globalComponentNames.add(match[1]));

        const startOfDeclRegex = /^(?:const|let|var)\s+([a-zA-Z0-9_$]+)/gm;
        let declMatch;
        while ((declMatch = startOfDeclRegex.exec(globalsContent)) !== null) {
          const varName = declMatch[1];
          if (globalComponentNames.has(varName)) continue;

          const startIndex = declMatch.index;
          let braceDepth = 0,
            bracketDepth = 0,
            parenDepth = 0,
            endIndex = -1;
          for (let i = startIndex; i < globalsContent.length; i++) {
            const char = globalsContent[i];
            if (char === "{") braceDepth++;
            else if (char === "}") braceDepth--;
            else if (char === "[") bracketDepth++;
            else if (char === "]") bracketDepth--;
            else if (char === "(") parenDepth++;
            else if (char === ")") parenDepth--;
            else if (char === ";" && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
              endIndex = i + 1;
              break;
            }
          }
          if (endIndex === -1) {
            const nextNewline = globalsContent.indexOf("\n", startIndex);
            endIndex = nextNewline !== -1 ? nextNewline : globalsContent.length;
          }
          const definition = globalsContent.substring(startIndex, endIndex).trim();
          if (definition) globalVarDefs.set(varName, definition);
          startOfDeclRegex.lastIndex = endIndex;
        }

        allGlobalNames = [...globalComponentNames, ...globalVarDefs.keys()];
        const nameToMarkup = new Map(componentMatches.map(m => [m[1], m[2].slice(1, -1)]));

        for (const name of allGlobalNames) {
          const dependencies = new Set<string>();
          const content = globalComponentNames.has(name)
            ? nameToMarkup.get(name)!
            : globalVarDefs.get(name)!;
          for (const depName of allGlobalNames) {
            if (name === depName) continue;
            if (new RegExp(`\\b${depName}\\b`).test(content)) dependencies.add(depName);
          }
          depGraph.set(name, dependencies);
        }

        const sortedComponentNames = [...globalComponentNames].sort((a, b) => {
          const depsA = getTransitiveDependencies(new Set([a]), depGraph);
          if (depsA.has(b)) return 1;
          const depsB = getTransitiveDependencies(new Set([b]), depGraph);
          if (depsB.has(a)) return -1;
          return allGlobalNames.indexOf(a) - allGlobalNames.indexOf(b);
        });

        const componentInfo = new Map<string, { local: string; virt: string }>();
        const replacements = [];

        for (const compName of sortedComponentNames) {
          const match = componentMatches.find(m => m[1] === compName)!;
          const [, , templateLiteralWithTicks] = match;
          const rawMarkup = templateLiteralWithTicks.slice(1, -1);

          const allDeps = getTransitiveDependencies(new Set([compName]), depGraph);
          allDeps.delete(compName);

          let scriptToInject = "";
          const sortedDeps = [...allDeps].sort(
            (a, b) => allGlobalNames.indexOf(a) - allGlobalNames.indexOf(b)
          );
          for (const depName of sortedDeps) {
            if (globalComponentNames.has(depName)) {
              const info = componentInfo.get(depName);
              if (info) scriptToInject += `import ${depName} from '${info.virt}';\n`;
            } else {
              const definition = globalVarDefs.get(depName);
              if (definition) scriptToInject += `\n${definition}`;
            }
          }

          const markupWithDeps = applyImports(rawMarkup, scriptToInject);
          const markup = applyImports(markupWithDeps, imports);
          const hash = createHash("sha1").update(markup).digest("hex").slice(0, 8);

          let local = hashToLocal.get(hash);
          const virt = `${VIRT}${hash}.js`;
          if (!local) {
            local = `Inline_${hash}`;
            hashToLocal.set(hash, local);
            if (!cache.has(virt)) cache.set(virt, markup);
            const ns = `__InlineNS_${hash}`;
            importsToAdd += `import * as ${ns} from '${virt}';\nconst ${local}=Object.assign(${ns}.default, ${ns});\n`;
          }

          componentInfo.set(compName, { local, virt });
          globalImportsForTpl += `import ${compName} from '${virt}';\n`;
          replacements.push({
            start: match.index,
            end: match.index + match[0].length,
            newText: `const ${compName} = ${local};`,
          });
        }

        let tempHoistedCode = globalsContent;
        for (const rep of replacements.reverse()) {
          tempHoistedCode =
            tempHoistedCode.slice(0, rep.start) + rep.newText + tempHoistedCode.slice(rep.end);
        }
        hoistedCode = tempHoistedCode;
      }

      /* 2. Process all regular templates */
      let m: RegExpExecArray | null;
      tplRE.lastIndex = 0;
      while ((m = tplRE.exec(code))) {
        if (
          globalsMatch &&
          m.index >= globalsMatch.index &&
          m.index < globalsMatch.index + globalsMatch[0].length
        )
          continue;

        const rawMarkup = m[1];
        const directDeps = new Set<string>();
        for (const name of allGlobalNames) {
          if (new RegExp(`\\b${name}\\b`).test(rawMarkup)) directDeps.add(name);
        }
        const allDeps = getTransitiveDependencies(directDeps, depGraph);
        let scriptToInject = globalImportsForTpl;
        const existingScriptContent = rawMarkup.match(/<script.*?>([\s\S]*?)<\/script>/)?.[1] ?? "";
        const sortedDeps = [...allDeps].sort(
          (a, b) => allGlobalNames.indexOf(a) - allGlobalNames.indexOf(b)
        );

        for (const name of sortedDeps) {
          if (globalComponentNames.has(name)) continue;

          const isDeclaredInScript = new RegExp(`\\b(let|const|var)\\s+[^=;]*?\\b${name}\\b`).test(
            existingScriptContent
          );
          if (isDeclaredInScript) continue;

          const definition = globalVarDefs.get(name);
          if (definition) scriptToInject += `\n${definition}`;
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

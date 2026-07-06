import { compile } from "svelte/compiler";
import { createHash } from "crypto";
import { dirname, resolve, sep } from "path";
import MagicString from "magic-string";
import type { Plugin } from "vite";

export interface InlineSvelteOptions {
  /** Template-tag names treated as Svelte markup – default `["html", "svelte"]` */
  tags?: string[];
  /** Comment that *starts* a definitions fence – default `/* svelte:definitions` */
  fenceStart?: string;
  /** Comment that *ends* a definitions fence – default `*\/` */
  fenceEnd?: string;
}

/* ───────── helpers ───────── */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isUserSource = (id: string) => !id.includes("/node_modules/") && /\.(c?[tj]sx?)$/.test(id);

/** Inject shared code without duplicating instance `<script>` blocks */
function applySharedCode(markup: string, code: string): string {
  if (!code) return markup;

  const scriptRE = /<script(?![^>]*context=["']module["'])[^>]*>/i;
  const m = scriptRE.exec(markup);
  if (m) {
    const idx = m.index + m[0].length;
    return markup.slice(0, idx) + "\n" + code + "\n" + markup.slice(idx);
  }
  return `<script>\n${code}\n</script>\n` + markup;
}

const relativeImportSpecifierRE = /((?:^|\s)(?:import|from)\s*)(['"])(\.\.?\/[^'"]+)\2/gm;

/** Rewrite relative import specifiers in generated markup to absolute paths, resolved
 *  against the directory of the file the macro was used in, so they still resolve once
 *  the markup is compiled as a standalone virtual module. */
function resolveRelativeImports(markup: string, sourceId: string): string {
  const sourceDir = dirname(sourceId);
  return markup.replace(relativeImportSpecifierRE, (_full, prefix, quote, specifier) => {
    const absolute = resolve(sourceDir, specifier).split(sep).join("/");
    return `${prefix}${quote}${absolute}${quote}`;
  });
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
  fenceStart = "/* svelte:definitions",
  fenceEnd = "*/",
}: InlineSvelteOptions = {}): Plugin {
  const tagGroup = tags.map(esc).join("|");
  // Optionally preceded by `scope(...).` — the tag must stay directly before the
  // backtick so editor extensions (e.g. lit-html) keep highlighting the markup.
  const tplRE = new RegExp(
    `(?:scope\\s*\\(([^)]*)\\)\\s*\\.\\s*)?(?:${tagGroup})\\s*\`([\\s\\S]*?)\``,
    "g"
  );
  const fenceRE = new RegExp(`${esc(fenceStart)}([\\s\\S]*?)${esc(fenceEnd)}`, "m");
  const globalDefRE = new RegExp(
    `^const\\s+([a-zA-Z0-9_$]+)\\s*=\\s*(?:scope\\s*\\([^)]*\\)\\s*\\.\\s*)?(?:${tagGroup})\\s*(\`[\\s\\S]*?\`)`,
    "gm"
  );
  const moduleScriptExportRE = /<script\s+module\s*>[^<]*\bexport\b/;
  const assignedNameRE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/;

  const isDeclaredInScript = (name: string, scriptContent: string) =>
    new RegExp(`\\b(?:let|const|var)\\s+[^=;]*?\\b${esc(name)}\\b`).test(scriptContent);

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

      let importsToAdd = "";
      let hoistedCode = "";
      const hashToLocal = new Map<string, string>();
      const globalComponentNames = new Set<string>();
      const globalVarDefs = new Map<string, string>();
      const depGraph = new Map<string, Set<string>>();
      let allGlobalNames: string[] = [];
      let fenceContent = "";
      let fenceImports = "";
      /** fence component name -> its virtual module */
      const componentInfo = new Map<string, { local: string; virt: string }>();
      /** local (non-fence) inline component name -> its virtual module */
      const localComponents = new Map<string, string>();

      /* 1. Process definitions fence */
      const fenceMatch = fenceRE.exec(code);
      if (fenceMatch) {
        edited = true;
        fenceContent = fenceMatch[1] ?? "";
        ms.overwrite(fenceMatch.index, fenceMatch.index + fenceMatch[0].length, "");

        const componentMatches = [...fenceContent.matchAll(globalDefRE)];
        componentMatches.forEach(match => globalComponentNames.add(match[1]));

        const nonComponentCode = fenceContent.replace(globalDefRE, "").trim();

        const startOfDeclRegex = /^(?:const|let|var)\s+([a-zA-Z0-9_$]+)/gm;
        let declMatch;
        while ((declMatch = startOfDeclRegex.exec(nonComponentCode)) !== null) {
          const varName = declMatch[1];
          if (globalComponentNames.has(varName)) continue;

          const startIndex = declMatch.index;
          let braceDepth = 0,
            bracketDepth = 0,
            parenDepth = 0,
            endIndex = -1;
          for (let i = startIndex; i < nonComponentCode.length; i++) {
            const char = nonComponentCode[i];
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
            const nextNewline = nonComponentCode.indexOf("\n", startIndex);
            endIndex = nextNewline !== -1 ? nextNewline : nonComponentCode.length;
          }
          const definition = nonComponentCode.substring(startIndex, endIndex).trim();
          if (definition) globalVarDefs.set(varName, definition);
          startOfDeclRegex.lastIndex = endIndex;
        }

        const importStatements =
          nonComponentCode.match(/import[\s\S]*?from\s*['"].*?['"];?/g) || [];
        fenceImports = importStatements.join("\n");
        hoistedCode += fenceImports + "\n";

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

        for (const compName of sortedComponentNames) {
          const rawMarkup = nameToMarkup.get(compName)!;

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

          const importCode = importStatements.join("\n");
          const markupWithImports = applySharedCode(rawMarkup, importCode);
          const markupWithDeps = applySharedCode(markupWithImports, scriptToInject);
          const markupWithResolvedImports = resolveRelativeImports(markupWithDeps, id);
          const hash = createHash("sha1").update(markupWithResolvedImports).digest("hex").slice(0, 8);

          let local = hashToLocal.get(hash);
          const virt = `${VIRT}${hash}.js`;
          if (!local) {
            local = `Inline_${hash}`;
            hashToLocal.set(hash, local);
            if (!cache.has(virt)) cache.set(virt, markupWithResolvedImports);

            const hasModuleExports = moduleScriptExportRE.test(rawMarkup);
            if (hasModuleExports) {
              const ns = `__InlineNS_${hash}`;
              importsToAdd += `import * as ${ns} from '${virt}';\nconst ${local}=Object.assign(${ns}.default, ${ns});\n`;
            } else {
              importsToAdd += `import ${local} from '${virt}';\n`;
            }
          }

          componentInfo.set(compName, { local, virt });
          hoistedCode += `const ${compName} = ${local};\n`;
        }

        let tempFenceCode = fenceContent;
        componentMatches.forEach(match => {
          tempFenceCode = tempFenceCode.replace(match[0], "");
        });

        hoistedCode += tempFenceCode.replace(/import[\s\S]*?from\s*['"].*?['"];?/g, "").trim();
      }

      /* 2. Process all regular templates */
      let m: RegExpExecArray | null;
      tplRE.lastIndex = 0;
      while ((m = tplRE.exec(code))) {
        if (
          fenceMatch &&
          m.index >= fenceMatch.index &&
          m.index < fenceMatch.index + fenceMatch[0].length
        )
          continue;

        const scopeArgs = (m[1] ?? "")
          .split(",")
          .map(s => s.trim())
          .filter(Boolean);
        const rawMarkup = m[2];
        const assignedName = assignedNameRE.exec(code.slice(0, m.index))?.[1];
        const existingScriptContent = rawMarkup.match(/<script.*?>([\s\S]*?)<\/script>/)?.[1] ?? "";

        let scriptToInject = "";
        const injectedNames = new Set<string>();

        /* scope(...) deps — local inline components shadow fence globals */
        for (const dep of scopeArgs) {
          if (injectedNames.has(dep) || isDeclaredInScript(dep, existingScriptContent)) continue;
          const virt = localComponents.get(dep) ?? componentInfo.get(dep)?.virt;
          if (virt) {
            scriptToInject += `import ${dep} from '${virt}';\n`;
            injectedNames.add(dep);
          }
        }

        /* fence globals referenced in the markup, resolved transitively */
        const directDeps = new Set<string>();
        for (const name of allGlobalNames) {
          if (new RegExp(`\\b${name}\\b`).test(rawMarkup)) directDeps.add(name);
        }
        const allDeps = getTransitiveDependencies(directDeps, depGraph);
        const sortedDeps = [...allDeps].sort(
          (a, b) => allGlobalNames.indexOf(a) - allGlobalNames.indexOf(b)
        );

        for (const name of sortedDeps) {
          if (injectedNames.has(name) || isDeclaredInScript(name, existingScriptContent)) continue;

          if (globalComponentNames.has(name)) {
            const info = componentInfo.get(name);
            if (info) {
              scriptToInject += `import ${name} from '${info.virt}';\n`;
              injectedNames.add(name);
            }
          } else {
            const definition = globalVarDefs.get(name);
            if (definition) {
              scriptToInject += `\n${definition}`;
              injectedNames.add(name);
            }
          }
        }

        const markupWithFenceCode = applySharedCode(rawMarkup, fenceImports);
        const markupWithGlobals = applySharedCode(markupWithFenceCode, scriptToInject);
        const markupWithResolvedImports = resolveRelativeImports(markupWithGlobals, id);
        const hash = createHash("sha1").update(markupWithResolvedImports).digest("hex").slice(0, 8);
        const virt = `${VIRT}${hash}.js`;

        let local = hashToLocal.get(hash);
        if (!local) {
          local = `Inline_${hash}`;
          hashToLocal.set(hash, local);
          if (!cache.has(virt)) cache.set(virt, markupWithResolvedImports);

          const hasModuleExports = moduleScriptExportRE.test(rawMarkup);
          if (hasModuleExports) {
            const ns = `__InlineNS_${hash}`;
            importsToAdd += `import * as ${ns} from '${virt}';\nconst ${local}=Object.assign(${ns}.default, ${ns});\n`;
          } else {
            importsToAdd += `import ${local} from '${virt}';\n`;
          }
        }

        // record so later templates can pull this component in via scope(...)
        if (assignedName) localComponents.set(assignedName, virt);

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
        runes: true,
      }).js.code;
    },
  };
}

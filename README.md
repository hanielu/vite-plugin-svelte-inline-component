# @hvniel/vite-plugin-svelte-inline-component

> Write tiny Svelte components straight inside your JavaScript / TypeScript tests using tagged‑template literals.

---

## 📖 Table of Contents

- [✨ What it does](https://www.google.com/search?q=%23-what-it-does)
- [🔧 Installation](https://www.google.com/search?q=%23-installation)
- [🚀 Usage](https://www.google.com/search?q=%23-usage)
  - [vite.config.ts / vite.config.js](https://www.google.com/search?q=%23viteconfigts--viteconfigjs)
  - [Declaring the global tag helper](https://www.google.com/search?q=%23declaring-the-global-tag-helper)
- [🧩 Named Exports & Snippets](https://www.google.com/search?q=%23-named-exports--snippets)
  - [Typing Named Exports](https://www.google.com/search?q=%23typing-named-exports)
- [🧪 Testing Inline & Reactive Components](https://www.google.com/search?q=%23-testing-inline--reactive-components)
- [🚦 Import Fences](https://www.google.com/search?q=%23-import-fences)
- [🛠️ API](https://www.google.com/search?q=%23-api)
  - [`InlineSvelteOptions`](https://www.google.com/search?q=%23inlinesvelteoptions)
- [🧐 How it works (nutshell)](https://www.google.com/search?q=%23-how-it-works-nutshell)
- [⚠️ Caveats](https://www.google.com/search?q=%23-caveats)
- [📝 License](https://www.google.com/search?q=%23-license)

---

## ✨ What it does

The plugin lets you write Svelte components directly in your `.ts` or `.js` test files. It finds every template literal whose **tag** matches a list you choose (defaults to `html` and `svelte`), compiles the markup with the Svelte compiler, and replaces it with an `import` of a virtual module that exports the compiled component. No extra files.

## 🔧 Installation

```bash
pnpm add -D @hvniel/vite-plugin-svelte-inline-component
# or
npm i -D @hvniel/vite-plugin-svelte-inline-component
# or
yarn add -D @hvniel/vite-plugin-svelte-inline-component
```

---

## 🚀 Usage

### vite.config.ts / vite.config.js

```ts
import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import inlineSveltePlugin from "@hvniel/vite-plugin-svelte-inline-component/plugin";

export default defineConfig(({ mode }) => ({
  plugins: [mode === "test" && inlineSveltePlugin(), sveltekit()],
  // ⬑ only enable during vitest runs in this example – remove the condition to run always
}));
```

> **Why conditionally enable?**
> In a typical SvelteKit project you already compile `.svelte` files. Turning the plugin on just for unit tests keeps production builds untouched while giving Vitest access to inline components.

### Declaring the global tag helper

Put this near the top level of your project (e.g. `src/app.d.ts` for SvelteKit, or `vite.d.ts` for plain Vite) to make tags like `html` globally available without imports.

```ts
// src/app.d.ts
declare global {
  /** Inline Svelte component helper – provided by the plugin */
  const html: import("@hvniel/vite-plugin-svelte-inline-component").InlineComponent;
}
export {};
```

---

## 🧩 Named Exports & Snippets

Just like regular Svelte files, you can use `<script context="module">` (or `<script module>`) to export values from an inline component. This is especially useful for **Svelte 5 snippets**.

The plugin makes any named exports available as properties on the component itself.

```tsx
import { html, type InlineSnippet } from "@hvniel/vite-plugin-svelte-inline-component";
const ComponentWithSnippets = html`
  <script lang="ts" module>
    // These snippets will be attached to the component export
    export { header, footer };
  </script>

  {#snippet header(text: string)}
  <header>
    <h1>{text}</h1>
  </header>
  {/snippet} {#snippet footer()}
  <footer>
    <p>&copy; 2025</p>
  </footer>
  {/snippet}
`;

// Now you can render the component and pass snippets to it
const { header, footer } = ComponentWithSnippets as unknown as {
  header: InlineSnippet;
  footer: InlineSnippet;
};

const renderer = render(anchor => {
  header(anchor, () => "Welcome!");
});
```

### Typing Named Exports

To make TypeScript aware of your named exports, you'll need to use a type assertion.

```ts
import { html, type InlineSnippet } from "@hvniel/vite-plugin-svelte-inline-component";
const defaultExport = html`
  <script module>
    export { element };
  </script>

  {#snippet element(content)}
  <strong>{content}</strong>
  {/snippet}
`;

// Use `as` to tell TypeScript about the named export
const { element } = defaultExport as unknown as {
  element: InlineSnippet<string>;
};

// `element` is now fully typed!
```

---

## 🧪 Testing Inline & Reactive Components

The plugin is perfect for writing component tests without creating separate `.svelte` files. It works great with **Vitest** and testing libraries like **@testing-library/svelte** or **vitest-browser-svelte**.

Here’s a sample test that proves reactivity with **Svelte 5 runes** works out of the box:

```tsx
import { render } from "vitest-browser-svelte";
import { html, type InlineSnippet } from "@hvniel/vite-plugin-svelte-inline-component";

it("supports reactive components", async () => {
  const ReactiveComponent = html`
    <script>
      let count = $state(0);

      function increment() {
        count++;
      }
    </script>

    <button onclick="{increment}">Count: {count}</button>
  `;

  const { getByRole } = render(ReactiveComponent);
  const button = getByRole("button");

  expect(button).toHaveTextContent("Count: 0");

  await user.click(button);

  expect(button).toHaveTextContent("Count: 1");
});
```

---

## 🚦 Import Fences

To share imports across multiple inline components in the same file, wrap your ES imports in a special comment block. The plugin will inject them into each inline component's script block.

```tsx
/* svelte:imports
import { fireEvent } from "@testing-library/svelte";
import utils from "./test-utils.js";
*/

const Thing1 = html`
  <script>
    let n = $state(0);
  </script>
  <button onclick={() => n++}>{utils.label}: {n}</button>
`;
```

---

## 🛠️ API

```ts
inlineSveltePlugin(options?: InlineSvelteOptions): Plugin;
```

### `InlineSvelteOptions`

| option       | type       | default              | description                                                            |
| :----------- | :--------- | :------------------- | :--------------------------------------------------------------------- |
| `tags`       | `string[]` | `["html", "svelte"]` | Names of template‑tags that should be treated as inline Svelte markup. |
| `fenceStart` | `string`   | `/* svelte:imports`  | The comment that _starts_ an import fence.                             |
| `fenceEnd`   | `string`   | `*/`                 | The comment that _ends_ an import fence.                               |

---

## 🧐 How it works (nutshell)

1.  **Scan** each user source file (`.js`, `.ts`, `.jsx`, `.tsx`).
2.  **Match** template literals whose tag name is in `options.tags`.
3.  **Hash** the template content (including any fenced imports) to create a stable virtual module ID.
4.  **Replace** the literal with a variable that imports the virtual module. Named exports (like snippets) are merged onto the default component export using `Object.assign`.
5.  **Compile** the markup with Svelte when Vite requests the virtual module ID.

The result behaves just like a normal Svelte component import, so SSR, hydration, and Hot Module Replacement work as expected.

---

## ⚠️ Caveats

- The plugin only transforms your application's source code, ignoring anything inside `node_modules`.
- The template content must be valid Svelte component markup. Syntax errors will surface during compilation.
- Because each inline component gets a unique hash, HMR will re‑render the whole component tree containing it. Keep inline components small for best performance.

---

## 📝 License

MIT © 2025 Haniel Ubogu

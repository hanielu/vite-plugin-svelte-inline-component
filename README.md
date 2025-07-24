# @hvniel/vite-plugin-svelte-inline-component

> Write tiny Svelte components straight inside your JavaScript / TypeScript tests using tagged‑template literals.

---

## 📖 Table of Contents

- [✨ What it does](#-what-it-does)
- [🔧 Installation](#-installation)
- [🚀 Usage](#-usage)
  - [vite.config.ts / vite.config.js](#viteconfigts--viteconfigjs)
- [🌍 Global Components](#-global-components)
- [🚦 Import Fences](#-import-fences)
- [🧩 Named Exports & Snippets](#-named-exports--snippets)
- [🧪 Testing Inline & Reactive Components](#-testing-inline--reactive-components)
- [🛠️ API](#️-api)
  - [`InlineSvelteOptions`](#inlinesvelteoptions)
- [🧐 How it works (nutshell)](#-how-it-works-nutshell)
- [⚠️ Caveats](#️-caveats)
- [📝 License](#-license)

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

---

## 🌍 Global Components

You can define components inside a special `/* svelte:globals */` fence to make them automatically available to all other inline components in the same file. This is perfect for defining shared UI elements or mocks without manual imports.

```typescript
/* svelte:globals
  // Any component defined here is "global" to this file.
  const GlobalButton = html`<button on:click>Click Me!</button>`;
*/

// ✅ GlobalButton is now available here automatically.
const Page = html`
  <section>
    <p>Welcome to the page.</p>
    <GlobalButton />
  </section>
`;
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

`inlineSveltePlugin(options?: InlineSvelteOptions): Plugin;`

### `InlineSvelteOptions`

| option              | type       | default              | description                                        |
| :------------------ | :--------- | :------------------- | :------------------------------------------------- |
| `tags`              | `string[]` | `["html", "svelte"]` | Tag names to be treated as inline Svelte markup.   |
| `fenceStart`        | `string`   | `/* svelte:imports`  | The comment that starts a standard import fence.   |
| `globalsFenceStart` | `string`   | `/* svelte:globals`  | The comment that starts a global components fence. |
| `fenceEnd`          | `string`   | `*/`                 | The comment that ends any fence.                   |

---

## 🧐 How it works (nutshell)

The plugin uses a multi-stage process to transform your code:

1.  **Scan for Fences:** The plugin first looks for `/* svelte:globals */` and `/* svelte:imports */` fences to identify shared components and imports.
2.  **Process Globals:** It compiles any components found inside the `globals` fence.
3.  **Process Locals:** It then compiles the remaining "local" components, injecting the standard imports and the compiled global components into each one's script scope.
4.  **Replace Literals:** Finally, it replaces all the original `html\`...\`\` literals in your code with variables that point to the newly created virtual components.

The result behaves just like a normal Svelte component import.

---

## ⚠️ Caveats

- The plugin only transforms your application's source code, ignoring anything inside `node_modules`.
- The template content must be valid Svelte component markup. Syntax errors will surface during compilation.
- Because each inline component gets a unique hash, HMR will re-render the whole component tree containing it. Keep inline components small for best performance.

---

## 📝 License

MIT © 2025 Haniel Ubogu

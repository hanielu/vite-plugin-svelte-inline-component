# @hvniel/vite-plugin-svelte-inline-component

> Write tiny Svelte components straight inside your JavaScript / TypeScript using tagged‑template literals.

---

## ✨ What it does

```ts
const Button = html`
  <script>
    export let label;
  </script>

  <button>{label}</button>
`;
```

The plugin finds every template literal whose **tag** matches a list you choose (defaults to `html` and `svelte`), compiles the markup with the Svelte compiler, and replaces it with an `import` of a virtual module that exports the compiled component. No extra files, no build‑time mess.

---

## 🔧 Installation

```bash
pnpm add -D @hvniel/vite-plugin-svelte-inline-component
# or
npm  i  -D @hvniel/vite-plugin-svelte-inline-component
# or
yarn add -D @hvniel/vite-plugin-svelte-inline-component
```

---

## 🚀 Usage

### vite.config.ts / vite.config.js

```ts
import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { inlineSveltePlugin } from "@hvniel/vite-plugin-svelte-inline-component";

export default defineConfig(({ mode }) => ({
  plugins: [mode === "test" && inlineSveltePlugin(), sveltekit()],
  // ⬑ only enable during vitest runs in this example – remove the condition to run always
}));
```

> **Why conditionally enable?**
> In a typical SvelteKit project you already compile `.svelte` files. Turning the plugin on just for unit tests keeps production builds untouched while giving Vitest access to inline components.

### Declaring the global tag helper

Put this near the top level of your project (e.g. `src/app.d.ts` for SvelteKit, or `vite.d.ts` for plain Vite):

```ts
// src/app.d.ts
declare global {
  /** Inline Svelte component helper – provided by the plugin */
  const html: import("@hvniel/vite-plugin-svelte-inline-component").InlineComponent;
}
export {};
```

Now every file can use the `html` tag without an explicit import.

---

## 🧪 Testing inline & reactive components

The plugin plays nicely with **Vitest** and **@testing-library/svelte**. Here’s a sample test that proves reactivity works out of the box:

```tsx
import { render } from "@testing-library/svelte";

it("supports reactive components", async () => {
  const ReactiveComponent = await html`
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

  await button.click();

  expect(button).toHaveTextContent("Count: 1");
});
```

➡️ **Tip:** conditionally enable the plugin in your `vite.config.*` so it’s active during test runs but not during production builds.

---

## 🛠️ API

```ts
inlineSveltePlugin(options?: InlineSvelteOptions): Plugin;
```

### `InlineSvelteOptions`

| option | type       | default              | description                                                                                                                                |
| ------ | ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `tags` | `string[]` | `["html", "svelte"]` | Names of template‑tags that should be treated as inline Svelte markup. Useful if you prefer something like `svx` or want multiple aliases. |

---

## 🧐 How it works (nutshell)

1. **Scan** each user source file (`.js`, `.ts`, `.jsx`, `.tsx`).
2. **Match** template literals whose tag name is in `options.tags`.
3. **Hash** the template to create a stable virtual module id.
4. **Replace** the literal with an import of that virtual module.
5. **Compile** the markup with Svelte when Vite requests the virtual id.

The result behaves just like a normal Svelte component import, so SSR, hydration and Hot Module Replacement work as expected.

---

## ⚠️ Caveats

- The plugin only touches user code – anything inside `node_modules` is ignored.
- The template content must be valid Svelte component markup. Syntax errors will surface during compilation.
- Because each inline component gets a unique hash, HMR will re‑render the whole component tree containing it. Keep inline components small.

---

## 📝 License

MIT © 2025 Haniel Ubogu

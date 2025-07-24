import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-svelte";
import SimpleComponentParent from "./plugin.svelte";
import { html, type InlineSnippet } from "inline";
import { page } from "@vitest/browser/context";

/* svelte:imports
import { MemoryRouter, Routes, Route } from "@hvniel/svelte-router";
*/

// svelte:globals
const Frank = html`<h1>Frank</h1>`;
const count = $state(0);
// sg

describe("Inline Svelte Components with sv", () => {
  it("renders a simple component", () => {
    const SimpleComponent = html`<h1>Hello World</h1>`;
    const renderer = render(SimpleComponentParent, {
      children: SimpleComponent,
    });

    // <!----> is added in the test because that's what svelte does
    expect(renderer.container.firstElementChild).toMatchInlineSnapshot(`
      <div
        class="plugin-svelte"
      >
        <h1>
          Hello World
        </h1>
        <!---->
      </div>
    `);
  });

  it("renders a component with props", () => {
    const ComponentWithProps = html`
      <script>
        let { name } = $props();
      </script>

      <h1>Hello {name}!</h1>
    `;

    const renderer = render(ComponentWithProps, { name: "Svelte" });

    expect(renderer.container.firstElementChild).toMatchInlineSnapshot(`
      <h1>
        Hello Svelte!
      </h1>
    `);
  });

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

    const renderer = render(ReactiveComponent);

    const button = renderer.getByRole("button");

    expect(button).toHaveTextContent("Count: 0");

    await button.click();

    expect(button).toHaveTextContent("Count: 1");
  });

  it("supports component with children", () => {
    const Layout = html`
      <script>
        let { children } = $props();
      </script>

      <div aria-label="layout">
        <header>Header</header>
        <main>{@render children()}</main>
        <footer>Footer</footer>
      </div>
    `;

    const Content = html`<p>Content goes here</p>`;

    const { getByLabelText } = render(Layout, {
      children: Content,
    });

    const layout = getByLabelText("layout");

    expect(layout).toHaveTextContent("Header");
    expect(layout).toHaveTextContent("Content goes here");
    expect(layout).toHaveTextContent("Footer");
  });

  it("works with router components", () => {
    const HomeComponent = html`<h1>Home Page</h1>`;
    const AboutComponent = html`<h1>About Page</h1>`;

    const App = html`
      <script>
				let {HomeComponent, AboutComponent} = $props();
      </script>

      <MemoryRouter initialEntries={["/home"]}>
        <Routes>
          <Route path="home" Component={HomeComponent} />
          <Route path="about" Component={AboutComponent} />
        </Routes>
      </MemoryRouter>
    `;

    const renderer = render(App, {
      HomeComponent,
      AboutComponent,
    });

    expect(renderer.container.firstElementChild).toMatchInlineSnapshot(`
      <h1>
        Home Page
      </h1>
    `);
  });

  it("allows duplicate components", () => {
    const Component2 = html`<h1>Hello World</h1>`;

    const renderer = render(html`<h1>Hello World</h1>`, {
      children: Component2,
    });

    expect(renderer.container.firstElementChild).toMatchInlineSnapshot(`
      <h1>
        Hello World
      </h1>
    `);
  });

  it("allows exported snippets", () => {
    const defaultExport = html`
      <script module>
        export { element1, element2 };
      </script>

      {#snippet element1(html)} {@html html} {/snippet} {#snippet element2(html)} {@html html}
      {/snippet}
    `;

    const { element1, element2 } = defaultExport as unknown as {
      element1: InlineSnippet;
      element2: InlineSnippet;
    };

    expect(element1).toBeDefined();
    expect(element2).toBeDefined();

    // console.log("[defaultExport]", defaultExport.toString());
    // console.log("[defaultExport.element1]", element1.toString());
    // console.log("[defaultExport.element2]", element2.toString());
  });

  it("allows exported snippets with props", () => {
    const ComponentWithSnippets = html`
      <script module>
        export { header };
      </script>

      {#snippet header(text)}
      <header>
        <h1>{text}</h1>
      </header>
      {/snippet}
    `;

    // Now you can render the component and pass snippets to it
    const { header } = ComponentWithSnippets as unknown as {
      header: InlineSnippet<string>;
    };

    const renderer = render(anchor => {
      header(anchor, () => "Welcome!");
    });

    expect(renderer.container.firstElementChild).toMatchInlineSnapshot(`
      <header>
        <h1>
          Welcome!
        </h1>
      </header>
    `);
  });

  it("supports global components", () => {
    const renderer = render(html`<div><Frank />{count}</div>`);

    expect(renderer.container.firstElementChild).toMatchInlineSnapshot(`
      <div>
        <h1>
          Frank
        </h1>
        <!---->
        0
      </div>
    `);
  });
});

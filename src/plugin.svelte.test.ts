import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-svelte";
import SimpleComponentParent from "./plugin.svelte";
import { html, type InlineSnippet } from "inline";

// svelte:defs
import { MemoryRouter, Routes, Route } from "@hvniel/svelte-router";

const Frank = html`<h1>Frank</h1>`;
const James = html`<h1>James</h1>`;
const James2 = html`<div><James /><Frank /></div>`;
const count = $state(0);
const dupes = [
  {
    name: "John",
    comp: James,
  },
  {
    name: "Jane",
    comp: James,
  },
];
const dupe = dupes[0];
// sd

describe("Inline Svelte Components with sv", () => {
  it("renders a simple component", () => {
    const SimpleComponent = html`<h1>Hello World</h1>`;
    const screen = render(SimpleComponentParent, {
      children: SimpleComponent,
    });

    // <!----> is added in the test because that's what svelte does
    expect(screen.container.firstElementChild).toMatchInlineSnapshot(`
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

    const screen = render(ComponentWithProps, { name: "Svelte" });

    expect(screen.container.firstElementChild).toMatchInlineSnapshot(`
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

    const screen = render(ReactiveComponent);

    const button = screen.getByRole("button");

    expect(button).toHaveTextContent("Count: 0");

    await button.click();
    await expect.element(button).toHaveTextContent("Count: 1");
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

    const screen = render(Layout, {
      children: Content,
    });

    const layout = screen.getByLabelText("layout");

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

    const screen = render(App, {
      HomeComponent,
      AboutComponent,
    });

    expect(screen.container.firstElementChild).toMatchInlineSnapshot(`
      <h1>
        Home Page
      </h1>
    `);
  });

  it("allows duplicate components", () => {
    const Component2 = html`<h1>Hello World</h1>`;

    const screen = render(html`<h1>Hello World</h1>`, {
      children: Component2,
    });

    expect(screen.container.firstElementChild).toMatchInlineSnapshot(`
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

    const screen = render(anchor => {
      header(anchor, () => "Welcome!");
    });

    expect(screen.container.firstElementChild).toMatchInlineSnapshot(`
      <header>
        <h1>
          Welcome!
        </h1>
      </header>
    `);
  });

  it("supports global components", () => {
    const screen = render(html`<div><Frank />{count}</div>`);

    expect(screen.container.firstElementChild).toMatchInlineSnapshot(`
      <div>
        <h1>
          Frank
        </h1>
        <!---->
        0
      </div>
    `);
  });

  it("supports multiple global components", () => {
    const screen = render(html`<div><James /><James /></div>`);

    expect(screen.container.firstElementChild).toMatchInlineSnapshot(`
      <div>
        <h1>
          James
        </h1>
        <!---->
        <h1>
          James
        </h1>
        <!---->
      </div>
    `);
  });

  it("allows local state take precendence", () => {
    const Counter = html`
      <script>
        let count = $state(100);
      </script>
      <p>Count: {count}</p>
    `;

    const screen = render(Counter);

    expect(screen.container.firstElementChild).toMatchInlineSnapshot(`
      <p>
        Count: 100
      </p>
    `);
  });

  it("allows global vars to reference global components", () => {
    const screen = render(html`<div><dupe.comp /></div>`);

    expect(screen.container.firstElementChild).toMatchInlineSnapshot(`
      <div>
        <h1>
          James
        </h1>
        <!---->
      </div>
    `);
  });

  it("allows global components to reference other global components", () => {
    const screen = render(James2);

    expect(screen.container.firstElementChild).toMatchInlineSnapshot(`
      <div>
        <h1>
          James
        </h1>
        <!---->
        <h1>
          Frank
        </h1>
        <!---->
      </div>
    `);
  });
});

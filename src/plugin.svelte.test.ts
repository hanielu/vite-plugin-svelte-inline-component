import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-svelte";
import SimpleComponentParent from "./plugin.svelte";

describe("Inline Svelte Components with sv", () => {
  it("renders a simple component", async () => {
    const SimpleComponent = await html`<h1>Hello World</h1>`;
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

  it("renders a component with props", async () => {
    const ComponentWithProps = await html`
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

  it("supports component with children", async () => {
    const Layout = await html`
      <script>
        let { children } = $props();
      </script>

      <div aria-label="layout">
        <header>Header</header>
        <main>{@render children()}</main>
        <footer>Footer</footer>
      </div>
    `;

    const Content = await html`<p>Content goes here</p>`;

    const { getByLabelText } = render(Layout, {
      children: Content,
    });

    const layout = getByLabelText("layout");

    expect(layout).toHaveTextContent("Header");
    expect(layout).toHaveTextContent("Content goes here");
    expect(layout).toHaveTextContent("Footer");
  });

  it("works with router components", async () => {
    const HomeComponent = await html`<h1>Home Page</h1>`;
    const AboutComponent = await html`<h1>About Page</h1>`;

    const App = await html`
      <script>
        import { MemoryRouter, Routes, Route } from "@hvniel/svelte-router";
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
});

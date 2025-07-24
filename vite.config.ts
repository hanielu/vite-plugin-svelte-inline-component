import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import inlineSveltePlugin from "./src/lib/plugin/index.js";

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      mode === "test" &&
        inlineSveltePlugin({
          fenceStart: "// svelte:defs",
          fenceEnd: "// sd",
        }),
      sveltekit(),
    ],
    test: {
      projects: [
        {
          extends: "./vite.config.ts",
          test: {
            name: "client",
            environment: "browser",
            browser: {
              enabled: true,
              provider: "playwright",
              instances: [{ browser: "chromium" }],
            },
            include: ["src/**/*.svelte.{test,spec}.{js,ts}"],
            exclude: ["src/lib/server/**"],
            setupFiles: ["./vitest-setup-client.ts"],
          },
        },
        {
          extends: "./vite.config.ts",
          test: {
            name: "server",
            environment: "node",
            include: ["src/**/*.{test,spec}.{js,ts}"],
            exclude: ["src/**/*.svelte.{test,spec}.{js,ts}"],
          },
        },
      ],
    },
  };
});

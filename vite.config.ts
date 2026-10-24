// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { browserBufferPlugin } from "./tooling/browser-buffer";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [browserBufferPlugin()],
    // Pre-bundle the lazily imported preview bundler so first use never re-optimizes deps mid-session (that mixes React copies).
    optimizeDeps: { include: ["esbuild-wasm"] },
    resolve: {
      // pkce-challenge (pulled in by the MCP SDK) only exports "browser"/"node" builds; the worker
      // build matches neither. Its browser build uses Web Crypto, which the worker supports.
      alias: [
        { find: "pkce-challenge", replacement: fileURLToPath(new URL("./node_modules/pkce-challenge/dist/index.browser.js", import.meta.url)) },
      ],
    },
  },
});

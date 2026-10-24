import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// Resolve all Buffer spellings to one file in Vite 7's client bundler.
export const browserBufferAlias = {
  find: /^(?:node:)?buffer\/?$/,
  replacement: fileURLToPath(new URL("../node_modules/buffer/index.js", import.meta.url)),
};

export function browserBufferPlugin(): Plugin {
  let isBuild = false;
  return {
    name: "browser-buffer-alias",
    enforce: "pre",
    configResolved(config) {
      isBuild = config.command === "build";
    },
    resolveId(source, importer, options) {
      if (options.ssr || !browserBufferAlias.find.test(source)) return null;
      // Development needs Vite's optimized ESM wrapper, not raw CommonJS.
      if (!isBuild) return this.resolve("buffer/", importer, { ...options, skipSelf: true });
      // Do not re-resolve "buffer/": Nitro can alias it back to node:buffer,
      // which is a builtin name, not a file that Vite's loader can open.
      return browserBufferAlias.replacement;
    },
  };
}

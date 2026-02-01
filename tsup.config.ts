import { defineConfig } from "tsup";

export default defineConfig([
  // Main library entry
  {
    entry: {
      index: "src/index.ts",
    },
    format: ["esm"],
    target: "node22",
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    minify: false,
    shims: false,
  },
  // CLI entry with shebang
  {
    entry: {
      "cli/index": "src/cli/index.ts",
    },
    format: ["esm"],
    target: "node22",
    dts: false,
    sourcemap: true,
    clean: false, // Don't clean again
    splitting: false,
    treeshake: true,
    minify: false,
    shims: false,
  },
]);

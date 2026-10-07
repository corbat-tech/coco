#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// Invoke local JavaScript entrypoints with the same Node version on every OS.
// Never fall back to unrelated global executables from PATH.
const checks = [
  { name: "Typecheck", entry: "typescript/bin/tsc", args: ["--noEmit"] },
  { name: "Lint", entry: "oxlint/bin/oxlint", args: ["src", "test"] },
  { name: "Format", entry: "oxfmt/bin/oxfmt", args: ["--check", "src", "test"] },
  { name: "Main Suite", entry: "vitest/vitest.mjs", args: ["run", "--coverage", "--maxWorkers=4"] },
  {
    name: "REPL Integration",
    entry: "vitest/vitest.mjs",
    args: ["run", "--config", "vitest.repl.config.ts"],
  },
  { name: "Build", entry: "tsup/dist/cli-default.js", args: [] },
];

for (const check of checks) {
  console.log(`\n[release-gate] ${check.name}`);
  const entry = path.resolve("node_modules", check.entry);
  if (!existsSync(entry)) {
    console.error(`[release-gate] FAILED: missing local dependency ${check.entry}`);
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [entry, ...check.args], {
    stdio: "inherit",
    shell: false,
    env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=4096" },
  });
  if (result.error || result.signal || result.status !== 0) {
    console.error(
      `[release-gate] FAILED: ${check.name}${result.signal ? ` (${result.signal})` : ""}`,
    );
    process.exit(result.status ?? 1);
  }
}

console.log("\n[release-gate] All checks passed");

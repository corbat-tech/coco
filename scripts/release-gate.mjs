#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const checks = [
  {
    name: "Typecheck",
    cmd: ["pnpm", "-s", "tsc", "--noEmit"],
  },
  {
    name: "Lint",
    cmd: ["pnpm", "-s", "lint"],
  },
  {
    name: "Stable Provider/Agent Suites",
    cmd: [
      "pnpm",
      "-s",
      "vitest",
      "run",
      "src/providers/openai.test.ts",
      "src/providers/codex.test.ts",
      "src/providers/gemini.test.ts",
      "src/providers/index.test.ts",
      "src/providers/integration.test.ts",
      "src/providers/resilient.test.ts",
      "src/providers/tool-call-normalizer.test.ts",
      "src/cli/repl/agent-loop.test.ts",
      "src/cli/repl/agent-loop-error-handling.test.ts",
      "src/cli/repl/error-resilience.test.ts",
      "src/cli/repl/replay-harness.test.ts",
      "src/cli/repl/turn-quality.test.ts",
    ],
  },
];

for (const check of checks) {
  console.log(`\n[release-gate] ${check.name}`);
  const result = spawnSync(check.cmd[0], check.cmd.slice(1), {
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  if (result.status !== 0) {
    console.error(`\n[release-gate] FAILED: ${check.name}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\n[release-gate] All checks passed");

/**
 * Separate vitest config for REPL integration tests.
 * These tests are excluded from the main `pnpm test` run because running
 * them alongside the full test suite causes OOM in headless CI environments.
 *
 * Run with: pnpm vitest run --config vitest.repl.config.ts
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    poolOptions: {
      forks: {
        // Each test file gets its own fork to limit memory pressure
        singleFork: false,
      },
    },
    include: ["src/cli/repl/index.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

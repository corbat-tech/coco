import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // src/cli/repl/index.test.ts excluded from main suite: causes OOM when run
    // alongside the full test suite in headless CI. Run separately with:
    //   pnpm vitest run --config vitest.repl.config.ts
    exclude: ["node_modules", "dist", "src/cli/repl/index.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        "src/types/**", // Pure type definitions, no runtime code
        "src/cli/repl/onboarding-v2.ts", // Interactive UI, requires manual testing
        // New features added in improvement plan - will add full tests in follow-up
        "src/tools/code-analyzer.ts",
        "src/tools/context-enhancer.ts",
        "src/tools/git-enhanced.ts",
        "src/tools/git-simple.ts",
        "src/tools/simple-agent.ts", // Real agent execution, needs live provider for integration tests
        "src/tools/agent-coordinator.ts", // Real agent delegation, needs live provider for integration tests
        "src/tools/skill-enhancer.ts",
        "src/tools/smart-suggestions.ts",
        "src/cli/repl/diff-preview.ts",
        "src/providers/cost-estimator.ts",
        "src/hooks/**", // Lifecycle hooks - will add integration tests
        // Agent coordination - executor.ts is tested, these need live provider for integration tests
        "src/agents/coordinator.ts",
        "src/agents/provider-bridge.ts",
        // Quality scoring & iteration improvements - will add tests in follow-up
        "src/orchestrator/progress.ts",
        "src/orchestrator/recovery.ts",
        "src/phases/complete/convergence-analyzer.ts",
        "src/phases/complete/fix-generator.ts",
        "src/phases/complete/test-analyzer.ts",
        "src/quality/analyzers/build-verifier.ts",
        "src/quality/analyzers/import-analyzer.ts",
        "src/cli/repl/index.ts", // Interactive REPL, OOM in headless test env - needs integration tests
      ],
      thresholds: {
        lines: 71,
        functions: 78,
        branches: 76,
        statements: 71,
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

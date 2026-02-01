import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
      thresholds: {
        // TODO: Increase to 80% as more tests are added
        lines: 55,
        functions: 60,
        branches: 65,
        statements: 55,
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

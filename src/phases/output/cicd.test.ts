/**
 * Tests for CI/CD generator
 */

import { describe, it, expect } from "vitest";

describe("CICDGenerator", () => {
  describe("generate", () => {
    it("should generate GitHub Actions workflows by default", async () => {
      const { CICDGenerator } = await import("./cicd.js");

      const generator = new CICDGenerator(
        { name: "test", language: "typescript", packageManager: "npm" } as any,
        {
          provider: "github_actions",
          features: { tests: true, lint: true, coverage: true, build: true },
        } as any
      );

      const files = generator.generate();

      expect(files.length).toBeGreaterThan(0);
      expect(files.some((f) => f.path.includes("ci.yml"))).toBe(true);
    });

    it("should generate GitLab CI when configured", async () => {
      const { CICDGenerator } = await import("./cicd.js");

      const generator = new CICDGenerator(
        { name: "test", language: "typescript", packageManager: "npm" } as any,
        { provider: "gitlab_ci", features: {} } as any
      );

      const files = generator.generate();

      expect(files.length).toBeGreaterThan(0);
      expect(files.some((f) => f.path.includes(".gitlab-ci.yml"))).toBe(true);
    });

    it("should include release workflow when enabled", async () => {
      const { CICDGenerator } = await import("./cicd.js");

      const generator = new CICDGenerator(
        { name: "test", language: "typescript", packageManager: "npm" } as any,
        { provider: "github_actions", features: { release: true } } as any
      );

      const files = generator.generate();

      expect(files.some((f) => f.path.includes("release.yml"))).toBe(true);
    });

    it("should include dependabot config when enabled", async () => {
      const { CICDGenerator } = await import("./cicd.js");

      const generator = new CICDGenerator(
        { name: "test", language: "typescript", packageManager: "npm" } as any,
        { provider: "github_actions", features: { dependabot: true } } as any
      );

      const files = generator.generate();

      expect(files.some((f) => f.path.includes("dependabot.yml"))).toBe(true);
    });

    it("should use pnpm commands for pnpm projects", async () => {
      const { CICDGenerator } = await import("./cicd.js");

      const generator = new CICDGenerator(
        { name: "test", language: "typescript", packageManager: "pnpm" } as any,
        { provider: "github_actions", features: { tests: true } } as any
      );

      const files = generator.generate();
      const ciFile = files.find((f) => f.path.includes("ci.yml"));

      expect(ciFile?.content).toContain("pnpm");
    });

    it("should include test step when tests enabled", async () => {
      const { CICDGenerator } = await import("./cicd.js");

      const generator = new CICDGenerator(
        { name: "test", language: "typescript", packageManager: "npm" } as any,
        { provider: "github_actions", features: { tests: true } } as any
      );

      const files = generator.generate();
      const ciFile = files.find((f) => f.path.includes("ci.yml"));

      expect(ciFile?.content).toContain("Test");
      expect(ciFile?.content).toContain("npm run test");
    });

    it("should include lint step when lint enabled", async () => {
      const { CICDGenerator } = await import("./cicd.js");

      const generator = new CICDGenerator(
        { name: "test", language: "typescript", packageManager: "npm" } as any,
        { provider: "github_actions", features: { lint: true } } as any
      );

      const files = generator.generate();
      const ciFile = files.find((f) => f.path.includes("ci.yml"));

      expect(ciFile?.content).toContain("Lint");
    });

    it("should include security job when security enabled", async () => {
      const { CICDGenerator } = await import("./cicd.js");

      const generator = new CICDGenerator(
        { name: "test", language: "typescript", packageManager: "npm" } as any,
        { provider: "github_actions", features: { security: true } } as any
      );

      const files = generator.generate();
      const ciFile = files.find((f) => f.path.includes("ci.yml"));

      expect(ciFile?.content).toContain("security");
      expect(ciFile?.content).toContain("audit");
    });
  });
});

describe("createDefaultCICDConfig", () => {
  it("should create config for github_actions by default", async () => {
    const { createDefaultCICDConfig } = await import("./cicd.js");

    const config = createDefaultCICDConfig();

    expect(config.provider).toBe("github_actions");
    expect(config.features.tests).toBe(true);
    expect(config.features.lint).toBe(true);
  });

  it("should create config for specified provider", async () => {
    const { createDefaultCICDConfig } = await import("./cicd.js");

    const config = createDefaultCICDConfig("gitlab_ci");

    expect(config.provider).toBe("gitlab_ci");
  });
});

describe("createCICDGenerator", () => {
  it("should create a CICDGenerator instance", async () => {
    const { createCICDGenerator, createDefaultCICDConfig } = await import("./cicd.js");

    const generator = createCICDGenerator(
      { name: "test" } as any,
      createDefaultCICDConfig()
    );

    expect(generator).toBeDefined();
  });
});

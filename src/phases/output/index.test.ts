/**
 * Tests for output phase module exports
 */

import { describe, it, expect } from "vitest";
import * as OutputExports from "./index.js";

describe("Output phase module exports", () => {
  describe("CI/CD Generator", () => {
    it("should export CICDGenerator", () => {
      expect(OutputExports.CICDGenerator).toBeDefined();
    });

    it("should export createCICDGenerator", () => {
      expect(OutputExports.createCICDGenerator).toBeDefined();
      expect(typeof OutputExports.createCICDGenerator).toBe("function");
    });

    it("should export createDefaultCICDConfig", () => {
      expect(OutputExports.createDefaultCICDConfig).toBeDefined();
      expect(typeof OutputExports.createDefaultCICDConfig).toBe("function");
    });
  });

  describe("Docker Generator", () => {
    it("should export DockerGenerator", () => {
      expect(OutputExports.DockerGenerator).toBeDefined();
    });

    it("should export createDockerGenerator", () => {
      expect(OutputExports.createDockerGenerator).toBeDefined();
      expect(typeof OutputExports.createDockerGenerator).toBe("function");
    });
  });

  describe("Documentation Generator", () => {
    it("should export DocsGenerator", () => {
      expect(OutputExports.DocsGenerator).toBeDefined();
    });

    it("should export createDocsGenerator", () => {
      expect(OutputExports.createDocsGenerator).toBeDefined();
      expect(typeof OutputExports.createDocsGenerator).toBe("function");
    });
  });

  describe("Executor", () => {
    it("should export OutputExecutor", () => {
      expect(OutputExports.OutputExecutor).toBeDefined();
    });

    it("should export createOutputExecutor", () => {
      expect(OutputExports.createOutputExecutor).toBeDefined();
      expect(typeof OutputExports.createOutputExecutor).toBe("function");
    });
  });

  describe("Config defaults", () => {
    it("should export DEFAULT_OUTPUT_CONFIG", () => {
      expect(OutputExports.DEFAULT_OUTPUT_CONFIG).toBeDefined();
    });
  });
});

describe("Output phase defaults", () => {
  describe("DEFAULT_OUTPUT_CONFIG", () => {
    it("should have valid configuration", () => {
      const config = OutputExports.DEFAULT_OUTPUT_CONFIG;
      expect(config).toBeDefined();
    });
  });
});

describe("Output utility functions", () => {
  describe("createDefaultCICDConfig", () => {
    it("should create a valid CICD config", () => {
      const config = OutputExports.createDefaultCICDConfig("github-actions");

      expect(config).toBeDefined();
      expect(config.provider).toBe("github-actions");
    });

    it("should create config for different providers", () => {
      const githubConfig = OutputExports.createDefaultCICDConfig("github-actions");
      const gitlabConfig = OutputExports.createDefaultCICDConfig("gitlab-ci");

      expect(githubConfig.provider).toBe("github-actions");
      expect(gitlabConfig.provider).toBe("gitlab-ci");
    });
  });

  describe("CICDGenerator", () => {
    it("should be instantiable", () => {
      const generator = new OutputExports.CICDGenerator();
      expect(generator).toBeInstanceOf(OutputExports.CICDGenerator);
    });
  });

  describe("DockerGenerator", () => {
    it("should be instantiable", () => {
      const generator = new OutputExports.DockerGenerator();
      expect(generator).toBeInstanceOf(OutputExports.DockerGenerator);
    });
  });

  describe("DocsGenerator", () => {
    it("should be instantiable", () => {
      const generator = new OutputExports.DocsGenerator();
      expect(generator).toBeInstanceOf(OutputExports.DocsGenerator);
    });
  });
});

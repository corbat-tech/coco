/**
 * Tests for configuration schema
 */

import { describe, it, expect } from "vitest";
import {
  CocoConfigSchema,
  ProviderConfigSchema,
  QualityConfigSchema,
  PersistenceConfigSchema,
  StackConfigSchema,
  validateConfig,
  createDefaultConfigObject,
} from "./schema.js";

describe("CocoConfigSchema", () => {
  describe("valid configurations", () => {
    it("should accept minimal valid config", () => {
      const config = {
        project: {
          name: "test-project",
        },
      };

      const result = CocoConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should accept full valid config", () => {
      const config = {
        project: {
          name: "test-project",
          version: "1.0.0",
          description: "A test project",
        },
        provider: {
          type: "anthropic",
          model: "claude-sonnet-4-20250514",
          maxTokens: 8192,
          temperature: 0,
          timeout: 120000,
        },
        quality: {
          minScore: 85,
          minCoverage: 80,
          maxIterations: 10,
          minIterations: 2,
          convergenceThreshold: 2,
          securityThreshold: 100,
        },
        persistence: {
          checkpointInterval: 300000,
          maxCheckpoints: 50,
          retentionDays: 7,
          compressOldCheckpoints: true,
        },
        stack: {
          language: "typescript",
          framework: "express",
        },
      };

      const result = CocoConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should apply default values", () => {
      const config = {
        project: {
          name: "test-project",
        },
      };

      const result = CocoConfigSchema.parse(config);

      // Check provider defaults
      expect(result.provider.type).toBe("anthropic");
      expect(result.provider.model).toBe("claude-sonnet-4-20250514");

      // Check quality defaults
      expect(result.quality.minScore).toBe(85);
      expect(result.quality.minCoverage).toBe(80);
      expect(result.quality.maxIterations).toBe(10);
    });
  });

  describe("invalid configurations", () => {
    it("should reject config without project name", () => {
      const config = {
        project: {},
      };

      const result = CocoConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject invalid provider type", () => {
      const config = {
        project: { name: "test" },
        provider: { type: "invalid-provider" },
      };

      const result = CocoConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject quality score out of range", () => {
      const config = {
        project: { name: "test" },
        quality: { minScore: 150 },
      };

      const result = CocoConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it("should reject negative coverage", () => {
      const config = {
        project: { name: "test" },
        quality: { minCoverage: -10 },
      };

      const result = CocoConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });
});

describe("ProviderConfigSchema", () => {
  it("should accept all ProviderType values — schema enum matches runtime ProviderType union", () => {
    // All values that exist in src/config/env.ts ProviderType must also pass the schema.
    const allProviderTypes = [
      "anthropic",
      "openai",
      "codex",
      "gemini",
      "kimi",
      "lmstudio",
      "ollama",
      "groq",
      "openrouter",
      "mistral",
      "deepseek",
      "together",
      "huggingface",
    ] as const;

    for (const type of allProviderTypes) {
      const result = ProviderConfigSchema.safeParse({ type });
      expect(result.success, `ProviderType "${type}" should pass ProviderConfigSchema`).toBe(true);
    }
  });

  it("should accept anthropic provider", () => {
    const config = {
      type: "anthropic",
      model: "claude-sonnet-4-20250514",
    };

    const result = ProviderConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("should accept openai provider", () => {
    const config = {
      type: "openai",
      model: "gpt-4",
    };

    const result = ProviderConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("should accept kimi provider", () => {
    const config = {
      type: "kimi",
      model: "moonshot-v1-8k",
    };

    const result = ProviderConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("should accept gemini provider", () => {
    const config = {
      type: "gemini",
      model: "gemini-2.0-flash",
    };

    const result = ProviderConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("should enforce maxTokens minimum", () => {
    const config = {
      type: "anthropic",
      maxTokens: 0,
    };

    const result = ProviderConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it("should enforce temperature range", () => {
    const config = {
      type: "anthropic",
      temperature: 2.5,
    };

    const result = ProviderConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe("QualityConfigSchema", () => {
  it("should accept valid quality config", () => {
    const config = {
      minScore: 90,
      minCoverage: 85,
      maxIterations: 15,
      minIterations: 3,
      convergenceThreshold: 3,
      securityThreshold: 100,
    };

    const result = QualityConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("should enforce minScore range (0-100)", () => {
    expect(QualityConfigSchema.safeParse({ minScore: -1 }).success).toBe(false);
    expect(QualityConfigSchema.safeParse({ minScore: 101 }).success).toBe(false);
    expect(QualityConfigSchema.safeParse({ minScore: 50 }).success).toBe(true);
  });

  it("should enforce minCoverage range (0-100)", () => {
    expect(QualityConfigSchema.safeParse({ minCoverage: -1 }).success).toBe(false);
    expect(QualityConfigSchema.safeParse({ minCoverage: 101 }).success).toBe(false);
    expect(QualityConfigSchema.safeParse({ minCoverage: 80 }).success).toBe(true);
  });

  it("should enforce positive iterations", () => {
    expect(QualityConfigSchema.safeParse({ maxIterations: 0 }).success).toBe(false);
    expect(QualityConfigSchema.safeParse({ maxIterations: -5 }).success).toBe(false);
    expect(QualityConfigSchema.safeParse({ maxIterations: 10 }).success).toBe(true);
  });
});

describe("QualityConfigSchema cross-field validation", () => {
  it("should reject minIterations > maxIterations", () => {
    const result = QualityConfigSchema.safeParse({
      minScore: 85,
      minCoverage: 80,
      maxIterations: 3,
      minIterations: 5,
      convergenceThreshold: 2,
      securityThreshold: 100,
    });
    expect(result.success).toBe(false);
  });

  it("should accept convergenceThreshold regardless of minScore (different units)", () => {
    const result = QualityConfigSchema.safeParse({
      minScore: 85,
      minCoverage: 80,
      maxIterations: 10,
      minIterations: 2,
      convergenceThreshold: 8,
      securityThreshold: 100,
    });
    expect(result.success).toBe(true);
  });

  it("should accept valid cross-field values", () => {
    const result = QualityConfigSchema.safeParse({
      minScore: 85,
      minCoverage: 80,
      maxIterations: 10,
      minIterations: 2,
      convergenceThreshold: 2,
      securityThreshold: 100,
    });
    expect(result.success).toBe(true);
  });
});

describe("PersistenceConfigSchema", () => {
  it("should accept valid persistence config", () => {
    const config = {
      checkpointInterval: 300000,
      maxCheckpoints: 100,
      retentionDays: 14,
      compressOldCheckpoints: true,
    };

    const result = PersistenceConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("should enforce positive checkpoint interval", () => {
    expect(PersistenceConfigSchema.safeParse({ checkpointInterval: 0 }).success).toBe(false);
    expect(PersistenceConfigSchema.safeParse({ checkpointInterval: -1000 }).success).toBe(false);
  });

  it("should enforce positive max checkpoints", () => {
    expect(PersistenceConfigSchema.safeParse({ maxCheckpoints: 0 }).success).toBe(false);
    expect(PersistenceConfigSchema.safeParse({ maxCheckpoints: -10 }).success).toBe(false);
  });
});

describe("StackConfigSchema", () => {
  it("should accept valid stack config", () => {
    const config = {
      language: "typescript",
      framework: "express",
      profile: "web-api",
    };

    const result = StackConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("should accept stack without framework", () => {
    const config = {
      language: "python",
    };

    const result = StackConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("should accept various languages", () => {
    const languages = ["typescript", "python", "go", "rust", "java"];

    for (const language of languages) {
      const result = StackConfigSchema.safeParse({ language });
      expect(result.success).toBe(true);
    }
  });
});

describe("validateConfig", () => {
  it("should return success true for valid config", () => {
    const config = {
      project: { name: "test-project" },
    };

    const result = validateConfig(config);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.project.name).toBe("test-project");
    expect(result.error).toBeUndefined();
  });

  it("should return success false for invalid config", () => {
    const config = {
      project: {}, // missing name
    };

    const result = validateConfig(config);

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error).toBeDefined();
    expect(result.error?.issues.length).toBeGreaterThan(0);
  });

  it("should return ZodError with issues for invalid config", () => {
    const config = {
      project: { name: "test" },
      quality: { minScore: 200 }, // out of range
    };

    const result = validateConfig(config);

    expect(result.success).toBe(false);
    expect(result.error?.issues).toBeDefined();
  });
});

describe("createDefaultConfigObject", () => {
  it("should create default config with project name", () => {
    const config = createDefaultConfigObject("my-project");

    expect(config.project.name).toBe("my-project");
    expect(config.project.version).toBe("0.1.0");
  });

  it("should use typescript as default language", () => {
    const config = createDefaultConfigObject("test");

    expect(config.stack.language).toBe("typescript");
  });

  it("should accept custom language", () => {
    const config = createDefaultConfigObject("test", "python");

    expect(config.stack.language).toBe("python");
  });

  it("should accept go language", () => {
    const config = createDefaultConfigObject("test", "go");

    expect(config.stack.language).toBe("go");
  });

  it("should accept rust language", () => {
    const config = createDefaultConfigObject("test", "rust");

    expect(config.stack.language).toBe("rust");
  });

  it("should accept java language", () => {
    const config = createDefaultConfigObject("test", "java");

    expect(config.stack.language).toBe("java");
  });

  it("should set correct provider defaults", () => {
    const config = createDefaultConfigObject("test");

    expect(config.provider.type).toBe("anthropic");
    expect(config.provider.model).toBe("claude-sonnet-4-20250514");
    expect(config.provider.maxTokens).toBe(8192);
    expect(config.provider.temperature).toBe(0);
    expect(config.provider.timeout).toBe(120000);
  });

  it("should set correct quality defaults", () => {
    const config = createDefaultConfigObject("test");

    expect(config.quality.minScore).toBe(85);
    expect(config.quality.minCoverage).toBe(80);
    expect(config.quality.maxIterations).toBe(10);
    expect(config.quality.minIterations).toBe(2);
    expect(config.quality.convergenceThreshold).toBe(2);
    expect(config.quality.securityThreshold).toBe(100);
  });

  it("should set correct persistence defaults", () => {
    const config = createDefaultConfigObject("test");

    expect(config.persistence.checkpointInterval).toBe(300000);
    expect(config.persistence.maxCheckpoints).toBe(50);
    expect(config.persistence.retentionDays).toBe(7);
    expect(config.persistence.compressOldCheckpoints).toBe(true);
  });
});

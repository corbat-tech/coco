/**
 * Tests for environment configuration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getApiKey,
  getBaseUrl,
  getDefaultModel,
  getDefaultProvider,
  env,
  type ProviderType,
} from "./env.js";

describe("getApiKey", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should return ANTHROPIC_API_KEY for anthropic provider", () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

    const key = getApiKey("anthropic");

    expect(key).toBe("test-anthropic-key");
  });

  it("should return OPENAI_API_KEY for openai provider", () => {
    process.env.OPENAI_API_KEY = "test-openai-key";

    const key = getApiKey("openai");

    expect(key).toBe("test-openai-key");
  });

  it("should return GEMINI_API_KEY for gemini provider", () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";

    const key = getApiKey("gemini");

    expect(key).toBe("test-gemini-key");
  });

  it("should fall back to GOOGLE_API_KEY for gemini provider", () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_API_KEY = "test-google-key";

    const key = getApiKey("gemini");

    expect(key).toBe("test-google-key");
  });

  it("should return KIMI_API_KEY for kimi provider", () => {
    process.env.KIMI_API_KEY = "test-kimi-key";

    const key = getApiKey("kimi");

    expect(key).toBe("test-kimi-key");
  });

  it("should fall back to MOONSHOT_API_KEY for kimi provider", () => {
    delete process.env.KIMI_API_KEY;
    process.env.MOONSHOT_API_KEY = "test-moonshot-key";

    const key = getApiKey("kimi");

    expect(key).toBe("test-moonshot-key");
  });

  it("should return undefined for unknown provider", () => {
    const key = getApiKey("unknown" as ProviderType);

    expect(key).toBeUndefined();
  });

  it("should return undefined when no key is set", () => {
    delete process.env.ANTHROPIC_API_KEY;

    const key = getApiKey("anthropic");

    expect(key).toBeUndefined();
  });
});

describe("getBaseUrl", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should return ANTHROPIC_BASE_URL for anthropic provider", () => {
    process.env.ANTHROPIC_BASE_URL = "https://custom-anthropic.com";

    const url = getBaseUrl("anthropic");

    expect(url).toBe("https://custom-anthropic.com");
  });

  it("should return OPENAI_BASE_URL for openai provider", () => {
    process.env.OPENAI_BASE_URL = "https://custom-openai.com";

    const url = getBaseUrl("openai");

    expect(url).toBe("https://custom-openai.com");
  });

  it("should return KIMI_BASE_URL for kimi provider", () => {
    process.env.KIMI_BASE_URL = "https://custom-kimi.com";

    const url = getBaseUrl("kimi");

    expect(url).toBe("https://custom-kimi.com");
  });

  it("should return default moonshot URL when KIMI_BASE_URL is not set", () => {
    delete process.env.KIMI_BASE_URL;

    const url = getBaseUrl("kimi");

    expect(url).toBe("https://api.moonshot.ai/v1");
  });

  it("should return undefined for gemini provider", () => {
    const url = getBaseUrl("gemini");

    expect(url).toBeUndefined();
  });

  it("should return undefined for unknown provider", () => {
    const url = getBaseUrl("unknown" as ProviderType);

    expect(url).toBeUndefined();
  });
});

describe("getDefaultModel", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should return custom ANTHROPIC_MODEL if set", () => {
    process.env.ANTHROPIC_MODEL = "claude-custom";

    const model = getDefaultModel("anthropic");

    expect(model).toBe("claude-custom");
  });

  it("should return default anthropic model", () => {
    delete process.env.ANTHROPIC_MODEL;

    const model = getDefaultModel("anthropic");

    expect(model).toBe("claude-opus-4-6-20260115");
  });

  it("should return custom OPENAI_MODEL if set", () => {
    process.env.OPENAI_MODEL = "gpt-custom";

    const model = getDefaultModel("openai");

    expect(model).toBe("gpt-custom");
  });

  it("should return default openai model", () => {
    delete process.env.OPENAI_MODEL;

    const model = getDefaultModel("openai");

    expect(model).toBe("gpt-5.2-codex");
  });

  it("should return custom GEMINI_MODEL if set", () => {
    process.env.GEMINI_MODEL = "gemini-custom";

    const model = getDefaultModel("gemini");

    expect(model).toBe("gemini-custom");
  });

  it("should return default gemini model", () => {
    delete process.env.GEMINI_MODEL;

    const model = getDefaultModel("gemini");

    expect(model).toBe("gemini-3-flash-preview");
  });

  it("should return custom KIMI_MODEL if set", () => {
    process.env.KIMI_MODEL = "moonshot-custom";

    const model = getDefaultModel("kimi");

    expect(model).toBe("moonshot-custom");
  });

  it("should return default kimi model", () => {
    delete process.env.KIMI_MODEL;

    const model = getDefaultModel("kimi");

    expect(model).toBe("kimi-k2.5");
  });

  it("should return gpt-4o for unknown provider", () => {
    const model = getDefaultModel("unknown" as ProviderType);

    expect(model).toBe("gpt-5.2-codex");
  });
});

describe("getDefaultProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should return anthropic from COCO_PROVIDER", () => {
    process.env.COCO_PROVIDER = "anthropic";

    const provider = getDefaultProvider();

    expect(provider).toBe("anthropic");
  });

  it("should return openai from COCO_PROVIDER", () => {
    process.env.COCO_PROVIDER = "openai";

    const provider = getDefaultProvider();

    expect(provider).toBe("openai");
  });

  it("should return gemini from COCO_PROVIDER", () => {
    process.env.COCO_PROVIDER = "gemini";

    const provider = getDefaultProvider();

    expect(provider).toBe("gemini");
  });

  it("should return kimi from COCO_PROVIDER", () => {
    process.env.COCO_PROVIDER = "kimi";

    const provider = getDefaultProvider();

    expect(provider).toBe("kimi");
  });

  it("should be case insensitive", () => {
    process.env.COCO_PROVIDER = "OPENAI";

    const provider = getDefaultProvider();

    expect(provider).toBe("openai");
  });

  it("should return anthropic for unknown provider", () => {
    process.env.COCO_PROVIDER = "unknown-provider";

    const provider = getDefaultProvider();

    expect(provider).toBe("anthropic");
  });

  it("should return anthropic when COCO_PROVIDER is not set", () => {
    delete process.env.COCO_PROVIDER;

    const provider = getDefaultProvider();

    expect(provider).toBe("anthropic");
  });
});

describe("env object", () => {
  it("should export provider", () => {
    expect(env.provider).toBeDefined();
  });

  it("should export getApiKey function", () => {
    expect(env.getApiKey).toBe(getApiKey);
    expect(typeof env.getApiKey).toBe("function");
  });

  it("should export getBaseUrl function", () => {
    expect(env.getBaseUrl).toBe(getBaseUrl);
    expect(typeof env.getBaseUrl).toBe("function");
  });

  it("should export getDefaultModel function", () => {
    expect(env.getDefaultModel).toBe(getDefaultModel);
    expect(typeof env.getDefaultModel).toBe("function");
  });
});

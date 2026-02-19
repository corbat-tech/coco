# TypeScript Testing with Vitest

## Setup

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
```

## Test File Template

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockedFunction } from "vitest";

// Import the module under test
import { myFunction } from "./my-module.js";

// Mock dependencies at top level
vi.mock("../../providers/index.js");
vi.mock("node:fs/promises");

// Import mocked modules for type-safe mock access
import * as fs from "node:fs/promises";
const mockedReadFile = vi.mocked(fs.readFile);

describe("myModule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("myFunction", () => {
    it("returns expected result", async () => {
      // Arrange
      mockedReadFile.mockResolvedValue("file content" as never);

      // Act
      const result = await myFunction("path/to/file.ts");

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toBe("file content");
    });

    it("handles file not found error", async () => {
      mockedReadFile.mockRejectedValue(new Error("ENOENT: no such file"));

      const result = await myFunction("nonexistent.ts");

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ENOENT/);
    });
  });
});
```

## Mocking LLM Providers

```typescript
import type { LLMProvider, ChatResponse } from "../../providers/types.js";

const mockProvider: LLMProvider = {
  chat: vi.fn<[], Promise<ChatResponse>>().mockResolvedValue({
    content: "mocked LLM response",
    usage: { inputTokens: 100, outputTokens: 50 },
  }),
  chatWithTools: vi.fn().mockResolvedValue({
    content: "mocked",
    toolCalls: [],
    usage: { inputTokens: 100, outputTokens: 50 },
  }),
};
```

## Mocking execa

```typescript
vi.mock("execa", () => ({
  execa: vi.fn().mockResolvedValue({
    stdout: "expected output",
    stderr: "",
    exitCode: 0,
  }),
}));

import { execa } from "execa";
const mockedExeca = vi.mocked(execa);

// In test:
mockedExeca.mockResolvedValueOnce({ stdout: "git log output", stderr: "" } as never);
```

## Testing Zod Schemas

```typescript
import { ConfigSchema } from "./schema.js";

describe("ConfigSchema", () => {
  it("accepts valid config", () => {
    const result = ConfigSchema.safeParse({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid provider", () => {
    const result = ConfigSchema.safeParse({ provider: "invalid" });
    expect(result.success).toBe(false);
    expect(result.error?.errors[0]?.message).toMatch(/Invalid enum value/);
  });

  it("applies defaults", () => {
    const result = ConfigSchema.parse({});
    expect(result.provider).toBe("anthropic");
  });
});
```

## Running Tests

```bash
pnpm test                          # run all tests
pnpm test src/tools/               # run tests in directory
pnpm test src/tools/foo.test.ts    # run single file
pnpm test:coverage                 # run with coverage report
pnpm test -- --watch               # watch mode
pnpm test -- --reporter=verbose    # detailed output
```

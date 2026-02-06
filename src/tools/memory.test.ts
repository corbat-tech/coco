/**
 * Tests for memory tools
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock logger
vi.mock("../utils/logger.js", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("memory tools", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await mkdtemp(join(tmpdir(), "coco-memory-test-"));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("createMemoryTool", () => {
    it("should have correct metadata", async () => {
      const { createMemoryTool } = await import("./memory.js");
      expect(createMemoryTool.name).toBe("create_memory");
      expect(createMemoryTool.category).toBe("memory");
    });

    it("should validate parameters", async () => {
      const { createMemoryTool } = await import("./memory.js");

      const valid = createMemoryTool.parameters.safeParse({
        key: "test-key",
        value: "test value",
      });
      expect(valid.success).toBe(true);

      const invalid = createMemoryTool.parameters.safeParse({
        key: "",
        value: "",
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("recallMemoryTool", () => {
    it("should have correct metadata", async () => {
      const { recallMemoryTool } = await import("./memory.js");
      expect(recallMemoryTool.name).toBe("recall_memory");
      expect(recallMemoryTool.category).toBe("memory");
    });

    it("should validate parameters", async () => {
      const { recallMemoryTool } = await import("./memory.js");

      const valid = recallMemoryTool.parameters.safeParse({});
      expect(valid.success).toBe(true);

      const withQuery = recallMemoryTool.parameters.safeParse({
        query: "test",
        tags: ["tag1"],
      });
      expect(withQuery.success).toBe(true);
    });
  });

  describe("listMemoriesTool", () => {
    it("should have correct metadata", async () => {
      const { listMemoriesTool } = await import("./memory.js");
      expect(listMemoriesTool.name).toBe("list_memories");
      expect(listMemoriesTool.category).toBe("memory");
    });

    it("should return empty list when no memories exist", async () => {
      const { listMemoriesTool } = await import("./memory.js");

      const result = await listMemoriesTool.execute({
        scope: "project",
      });

      expect(result.memories).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });
});

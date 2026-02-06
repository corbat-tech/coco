/**
 * Tests for checkpoint tools
 */

import { describe, it, expect, vi } from "vitest";

// Mock logger
vi.mock("../utils/logger.js", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("checkpoint tools", () => {
  describe("createCheckpointTool", () => {
    it("should have correct metadata", async () => {
      const { createCheckpointTool } = await import("./checkpoint.js");
      expect(createCheckpointTool.name).toBe("create_checkpoint");
      expect(createCheckpointTool.category).toBe("memory");
    });

    it("should validate parameters", async () => {
      const { createCheckpointTool } = await import("./checkpoint.js");

      const valid = createCheckpointTool.parameters.safeParse({
        description: "before refactor",
      });
      expect(valid.success).toBe(true);

      const invalid = createCheckpointTool.parameters.safeParse({
        description: "",
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("restoreCheckpointTool", () => {
    it("should have correct metadata", async () => {
      const { restoreCheckpointTool } = await import("./checkpoint.js");
      expect(restoreCheckpointTool.name).toBe("restore_checkpoint");
      expect(restoreCheckpointTool.category).toBe("memory");
    });

    it("should validate parameters", async () => {
      const { restoreCheckpointTool } = await import("./checkpoint.js");

      const valid = restoreCheckpointTool.parameters.safeParse({
        id: "abc123",
      });
      expect(valid.success).toBe(true);

      const invalid = restoreCheckpointTool.parameters.safeParse({
        id: "",
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("listCheckpointsTool", () => {
    it("should have correct metadata", async () => {
      const { listCheckpointsTool } = await import("./checkpoint.js");
      expect(listCheckpointsTool.name).toBe("list_checkpoints");
      expect(listCheckpointsTool.category).toBe("memory");
    });

    it("should validate parameters", async () => {
      const { listCheckpointsTool } = await import("./checkpoint.js");

      const valid = listCheckpointsTool.parameters.safeParse({});
      expect(valid.success).toBe(true);

      const withLimit = listCheckpointsTool.parameters.safeParse({
        limit: 5,
      });
      expect(withLimit.success).toBe(true);
    });
  });
});

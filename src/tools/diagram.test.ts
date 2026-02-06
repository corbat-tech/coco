/**
 * Tests for diagram generation tool
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

describe("diagram", () => {
  describe("generateDiagramTool", () => {
    it("should have correct metadata", async () => {
      const { generateDiagramTool } = await import("./diagram.js");
      expect(generateDiagramTool.name).toBe("generate_diagram");
      expect(generateDiagramTool.category).toBe("document");
    });

    it("should validate parameters", async () => {
      const { generateDiagramTool } = await import("./diagram.js");

      const valid = generateDiagramTool.parameters.safeParse({
        type: "flowchart",
        description: "Step 1. Step 2. Step 3.",
      });
      expect(valid.success).toBe(true);

      const invalidType = generateDiagramTool.parameters.safeParse({
        type: "invalid",
      });
      expect(invalidType.success).toBe(false);
    });

    it("should generate a flowchart from description", async () => {
      const { generateDiagramTool } = await import("./diagram.js");

      const result = await generateDiagramTool.execute({
        type: "flowchart",
        description: "User logs in. System validates. If valid, redirect to dashboard.",
        format: "mermaid",
      });

      expect(result.diagram).toContain("graph TD");
      expect(result.format).toBe("mermaid");
      expect(result.type).toBe("flowchart");
      expect(result.nodeCount).toBeGreaterThan(0);
    });

    it("should generate a sequence diagram from description", async () => {
      const { generateDiagramTool } = await import("./diagram.js");

      const result = await generateDiagramTool.execute({
        type: "sequence",
        description:
          "Client sends request to Server. Server queries Database. Database returns results.",
        format: "mermaid",
      });

      expect(result.diagram).toContain("sequenceDiagram");
      expect(result.format).toBe("mermaid");
      expect(result.type).toBe("sequence");
    });

    it("should generate a mindmap from description", async () => {
      const { generateDiagramTool } = await import("./diagram.js");

      const result = await generateDiagramTool.execute({
        type: "mindmap",
        description: "Architecture, Frontend, Backend, Database, API",
        format: "mermaid",
      });

      expect(result.diagram).toContain("mindmap");
      expect(result.diagram).toContain("root");
      expect(result.nodeCount).toBeGreaterThan(0);
    });

    it("should throw for flowchart without description", async () => {
      const { generateDiagramTool } = await import("./diagram.js");

      await expect(
        generateDiagramTool.execute({
          type: "flowchart",
          format: "mermaid",
        }),
      ).rejects.toThrow("description");
    });

    it("should throw for plantuml format", async () => {
      const { generateDiagramTool } = await import("./diagram.js");

      await expect(
        generateDiagramTool.execute({
          type: "flowchart",
          description: "test",
          format: "plantuml",
        }),
      ).rejects.toThrow("PlantUML");
    });
  });
});

/**
 * Tests for orchestrator module exports
 */

import { describe, it, expect } from "vitest";
import * as OrchestratorExports from "./index.js";

describe("Orchestrator module exports", () => {
  describe("createOrchestrator", () => {
    it("should export createOrchestrator function", () => {
      expect(OrchestratorExports.createOrchestrator).toBeDefined();
      expect(typeof OrchestratorExports.createOrchestrator).toBe("function");
    });
  });

  describe("createProjectStructure", () => {
    it("should export createProjectStructure function", () => {
      expect(OrchestratorExports.createProjectStructure).toBeDefined();
      expect(typeof OrchestratorExports.createProjectStructure).toBe("function");
    });
  });
});

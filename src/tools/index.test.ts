/**
 * Tests for tools module exports
 */

import { describe, it, expect } from "vitest";
import * as ToolExports from "./index.js";

describe("Tools module exports", () => {
  describe("registry", () => {
    it("should export ToolRegistry", () => {
      expect(ToolExports.ToolRegistry).toBeDefined();
    });

    it("should export getToolRegistry", () => {
      expect(ToolExports.getToolRegistry).toBeDefined();
      expect(typeof ToolExports.getToolRegistry).toBe("function");
    });

    it("should export createToolRegistry", () => {
      expect(ToolExports.createToolRegistry).toBeDefined();
      expect(typeof ToolExports.createToolRegistry).toBe("function");
    });

    it("should export defineTool", () => {
      expect(ToolExports.defineTool).toBeDefined();
      expect(typeof ToolExports.defineTool).toBe("function");
    });
  });

  describe("file tools", () => {
    it("should export readFileTool", () => {
      expect(ToolExports.readFileTool).toBeDefined();
      expect(ToolExports.readFileTool.name).toBe("read_file");
    });

    it("should export writeFileTool", () => {
      expect(ToolExports.writeFileTool).toBeDefined();
      expect(ToolExports.writeFileTool.name).toBe("write_file");
    });

    it("should export editFileTool", () => {
      expect(ToolExports.editFileTool).toBeDefined();
      expect(ToolExports.editFileTool.name).toBe("edit_file");
    });

    it("should export globTool", () => {
      expect(ToolExports.globTool).toBeDefined();
      expect(ToolExports.globTool.name).toBe("glob");
    });

    it("should export fileExistsTool", () => {
      expect(ToolExports.fileExistsTool).toBeDefined();
      expect(ToolExports.fileExistsTool.name).toBe("file_exists");
    });

    it("should export listDirTool", () => {
      expect(ToolExports.listDirTool).toBeDefined();
      expect(ToolExports.listDirTool.name).toBe("list_dir");
    });

    it("should export deleteFileTool", () => {
      expect(ToolExports.deleteFileTool).toBeDefined();
      expect(ToolExports.deleteFileTool.name).toBe("delete_file");
    });

    it("should export fileTools array", () => {
      expect(ToolExports.fileTools).toBeDefined();
      expect(Array.isArray(ToolExports.fileTools)).toBe(true);
      expect(ToolExports.fileTools.length).toBeGreaterThan(0);
    });
  });

  describe("bash tools", () => {
    it("should export bashExecTool", () => {
      expect(ToolExports.bashExecTool).toBeDefined();
      expect(ToolExports.bashExecTool.name).toBe("bash_exec");
    });

    it("should export bashBackgroundTool", () => {
      expect(ToolExports.bashBackgroundTool).toBeDefined();
      expect(ToolExports.bashBackgroundTool.name).toBe("bash_background");
    });

    it("should export commandExistsTool", () => {
      expect(ToolExports.commandExistsTool).toBeDefined();
      expect(ToolExports.commandExistsTool.name).toBe("command_exists");
    });

    it("should export getEnvTool", () => {
      expect(ToolExports.getEnvTool).toBeDefined();
      expect(ToolExports.getEnvTool.name).toBe("get_env");
    });

    it("should export bashTools array", () => {
      expect(ToolExports.bashTools).toBeDefined();
      expect(Array.isArray(ToolExports.bashTools)).toBe(true);
      expect(ToolExports.bashTools.length).toBeGreaterThan(0);
    });
  });

  describe("git tools", () => {
    it("should export gitStatusTool", () => {
      expect(ToolExports.gitStatusTool).toBeDefined();
      expect(ToolExports.gitStatusTool.name).toBe("git_status");
    });

    it("should export gitDiffTool", () => {
      expect(ToolExports.gitDiffTool).toBeDefined();
      expect(ToolExports.gitDiffTool.name).toBe("git_diff");
    });

    it("should export gitAddTool", () => {
      expect(ToolExports.gitAddTool).toBeDefined();
      expect(ToolExports.gitAddTool.name).toBe("git_add");
    });

    it("should export gitCommitTool", () => {
      expect(ToolExports.gitCommitTool).toBeDefined();
      expect(ToolExports.gitCommitTool.name).toBe("git_commit");
    });

    it("should export gitLogTool", () => {
      expect(ToolExports.gitLogTool).toBeDefined();
      expect(ToolExports.gitLogTool.name).toBe("git_log");
    });

    it("should export gitBranchTool", () => {
      expect(ToolExports.gitBranchTool).toBeDefined();
      expect(ToolExports.gitBranchTool.name).toBe("git_branch");
    });

    it("should export gitCheckoutTool", () => {
      expect(ToolExports.gitCheckoutTool).toBeDefined();
      expect(ToolExports.gitCheckoutTool.name).toBe("git_checkout");
    });

    it("should export gitPushTool", () => {
      expect(ToolExports.gitPushTool).toBeDefined();
      expect(ToolExports.gitPushTool.name).toBe("git_push");
    });

    it("should export gitPullTool", () => {
      expect(ToolExports.gitPullTool).toBeDefined();
      expect(ToolExports.gitPullTool.name).toBe("git_pull");
    });

    it("should export gitInitTool", () => {
      expect(ToolExports.gitInitTool).toBeDefined();
      expect(ToolExports.gitInitTool.name).toBe("git_init");
    });

    it("should export gitTools array", () => {
      expect(ToolExports.gitTools).toBeDefined();
      expect(Array.isArray(ToolExports.gitTools)).toBe(true);
      expect(ToolExports.gitTools.length).toBeGreaterThan(0);
    });
  });

  describe("test tools", () => {
    it("should export runTestsTool", () => {
      expect(ToolExports.runTestsTool).toBeDefined();
      expect(ToolExports.runTestsTool.name).toBe("run_tests");
    });

    it("should export getCoverageTool", () => {
      expect(ToolExports.getCoverageTool).toBeDefined();
      expect(ToolExports.getCoverageTool.name).toBe("get_coverage");
    });

    it("should export runTestFileTool", () => {
      expect(ToolExports.runTestFileTool).toBeDefined();
      expect(ToolExports.runTestFileTool.name).toBe("run_test_file");
    });

    it("should export testTools array", () => {
      expect(ToolExports.testTools).toBeDefined();
      expect(Array.isArray(ToolExports.testTools)).toBe(true);
      expect(ToolExports.testTools.length).toBeGreaterThan(0);
    });
  });

  describe("quality tools", () => {
    it("should export runLinterTool", () => {
      expect(ToolExports.runLinterTool).toBeDefined();
      expect(ToolExports.runLinterTool.name).toBe("run_linter");
    });

    it("should export analyzeComplexityTool", () => {
      expect(ToolExports.analyzeComplexityTool).toBeDefined();
      expect(ToolExports.analyzeComplexityTool.name).toBe("analyze_complexity");
    });

    it("should export calculateQualityTool", () => {
      expect(ToolExports.calculateQualityTool).toBeDefined();
      expect(ToolExports.calculateQualityTool.name).toBe("calculate_quality");
    });

    it("should export qualityTools array", () => {
      expect(ToolExports.qualityTools).toBeDefined();
      expect(Array.isArray(ToolExports.qualityTools)).toBe(true);
      expect(ToolExports.qualityTools.length).toBeGreaterThan(0);
    });
  });

  describe("registerAllTools", () => {
    it("should register all tools to a registry", () => {
      const registry = new ToolExports.ToolRegistry();
      ToolExports.registerAllTools(registry);

      // Check that tools are registered
      expect(registry.getAll().length).toBeGreaterThan(0);

      // Check specific tools
      expect(registry.get("read_file")).toBeDefined();
      expect(registry.get("bash_exec")).toBeDefined();
      expect(registry.get("git_status")).toBeDefined();
      expect(registry.get("run_tests")).toBeDefined();
      expect(registry.get("run_linter")).toBeDefined();
    });
  });

  describe("createFullToolRegistry", () => {
    it("should create a registry with all tools registered", () => {
      const registry = ToolExports.createFullToolRegistry();

      expect(registry).toBeInstanceOf(ToolExports.ToolRegistry);
      expect(registry.getAll().length).toBeGreaterThan(0);

      // Check specific tools
      expect(registry.get("read_file")).toBeDefined();
      expect(registry.get("write_file")).toBeDefined();
      expect(registry.get("bash_exec")).toBeDefined();
      expect(registry.get("git_commit")).toBeDefined();
    });
  });
});

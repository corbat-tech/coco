/**
 * Tests for recommended-permissions.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import {
  shouldShowPermissionSuggestion,
  loadPermissionPreferences,
  savePermissionPreference,
  RECOMMENDED_GLOBAL,
  RECOMMENDED_PROJECT,
} from "./recommended-permissions.js";
import { CONFIG_PATHS } from "../../config/paths.js";

// Mock fs
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

// Mock session.js
vi.mock("./session.js", () => ({
  saveTrustedTool: vi.fn(),
}));

describe("shouldShowPermissionSuggestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return true when permissions not applied and not dismissed", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));

    const result = await shouldShowPermissionSuggestion();

    expect(result).toBe(true);
  });

  it("should return false when user dismissed the suggestion", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ recommendedAllowlistDismissed: true }),
    );

    const result = await shouldShowPermissionSuggestion();

    expect(result).toBe(false);
  });

  it("should return true when applied but trusted-tools.json does not exist", async () => {
    // First call reads config.json, second call reads trusted-tools.json
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(JSON.stringify({ recommendedAllowlistApplied: true }))
      .mockRejectedValueOnce(new Error("File not found"));

    const result = await shouldShowPermissionSuggestion();

    expect(result).toBe(true);
  });

  it("should return true when applied but trusted-tools.json has empty globalTrusted", async () => {
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(JSON.stringify({ recommendedAllowlistApplied: true }))
      .mockResolvedValueOnce(JSON.stringify({ globalTrusted: [], projectTrusted: {} }));

    const result = await shouldShowPermissionSuggestion();

    expect(result).toBe(true);
  });

  it("should return false when applied and trusted-tools.json has tools", async () => {
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(JSON.stringify({ recommendedAllowlistApplied: true }))
      .mockResolvedValueOnce(
        JSON.stringify({
          globalTrusted: ["read_file", "write_file"],
          projectTrusted: {},
        }),
      );

    const result = await shouldShowPermissionSuggestion();

    expect(result).toBe(false);
  });

  it("should return true when applied but trusted-tools.json is invalid JSON", async () => {
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(JSON.stringify({ recommendedAllowlistApplied: true }))
      .mockResolvedValueOnce("invalid json");

    const result = await shouldShowPermissionSuggestion();

    expect(result).toBe(true);
  });
});

describe("loadPermissionPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty object when config file does not exist", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));

    const result = await loadPermissionPreferences();

    expect(result).toEqual({});
  });

  it("should parse config file correctly", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        recommendedAllowlistApplied: true,
        recommendedAllowlistDismissed: false,
        otherSetting: "value",
      }),
    );

    const result = await loadPermissionPreferences();

    expect(result).toEqual({
      recommendedAllowlistApplied: true,
      recommendedAllowlistDismissed: false,
    });
  });
});

describe("savePermissionPreference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create new config file if it does not exist", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await savePermissionPreference("recommendedAllowlistApplied", true);

    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining(".coco"), { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("config.json"),
      JSON.stringify({ recommendedAllowlistApplied: true }, null, 2),
      "utf-8",
    );
  });

  it("should merge with existing config", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ existingKey: "value" }));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await savePermissionPreference("recommendedAllowlistApplied", true);

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("config.json"),
      JSON.stringify({ existingKey: "value", recommendedAllowlistApplied: true }, null, 2),
      "utf-8",
    );
  });
});

describe("RECOMMENDED_GLOBAL and RECOMMENDED_PROJECT", () => {
  it("should have tools in RECOMMENDED_GLOBAL", () => {
    expect(RECOMMENDED_GLOBAL.length).toBeGreaterThan(0);
    expect(RECOMMENDED_GLOBAL).toContain("read_file");
    expect(RECOMMENDED_GLOBAL).toContain("glob");
  });

  it("should have tools in RECOMMENDED_PROJECT", () => {
    expect(RECOMMENDED_PROJECT.length).toBeGreaterThan(0);
    expect(RECOMMENDED_PROJECT).toContain("write_file");
    expect(RECOMMENDED_PROJECT).toContain("edit_file");
  });

  it("should not include git_commit in recommended lists", () => {
    expect(RECOMMENDED_GLOBAL).not.toContain("git_commit");
    expect(RECOMMENDED_PROJECT).not.toContain("git_commit");
  });
});

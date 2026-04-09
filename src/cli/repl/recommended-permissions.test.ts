/**
 * Tests for recommended-permissions.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import {
  shouldShowPermissionSuggestion,
  loadPermissionPreferences,
  savePermissionPreference,
  saveProjectPermissionPreference,
  isRecommendedAllowlistAppliedForProject,
  isRecommendedAllowlistDismissedForProject,
  RECOMMENDED_GLOBAL,
  RECOMMENDED_PROJECT,
} from "./recommended-permissions.js";

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

  it("should return false when user dismissed for this project", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ dismissed: true, applied: false, prompted: true }),
    );

    const result = await shouldShowPermissionSuggestion("/repo/project");

    expect(result).toBe(false);
  });

  it("should return true when prompt was shown but user has not applied/dismissed", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ prompted: true, dismissed: false }));

    const result = await shouldShowPermissionSuggestion();

    expect(result).toBe(true);
  });

  it("should return false when permissions were already applied for this project", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ applied: true, dismissed: false }));

    const result = await shouldShowPermissionSuggestion("/repo/project");

    expect(result).toBe(false);
  });

  it("should return true after 'later' style state (prompted but not applied/dismissed)", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ prompted: true, applied: false }));

    const result = await shouldShowPermissionSuggestion("/repo/project");
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
        recommendedAllowlistPrompted: true,
        recommendedAllowlistPromptedProjects: { "/repo/project": true },
        recommendedAllowlistAppliedProjects: { "/repo/project": true },
        recommendedAllowlistDismissedProjects: { "/repo/project": false },
        otherSetting: "value",
      }),
    );

    const result = await loadPermissionPreferences();

    expect(result).toEqual({});
  });
});

describe("savePermissionPreference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a no-op (project-local flow now)", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await savePermissionPreference("recommendedAllowlistApplied", true);

    expect(fs.mkdir).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("does not merge with global config anymore", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ existingKey: "value" }));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await savePermissionPreference("recommendedAllowlistApplied", true);

    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

describe("saveProjectPermissionPreference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores project-scoped state in project .coco file", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ existingKey: "value" }));
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await saveProjectPermissionPreference(
      "recommendedAllowlistAppliedProjects",
      "/repo/project",
      true,
    );

    expect(fs.writeFile).toHaveBeenCalledWith(
      "/repo/project/.coco/recommended-permissions.json",
      expect.any(String),
      "utf-8",
    );
    const writtenConfig = JSON.parse(vi.mocked(fs.writeFile).mock.calls[0]![1] as string);
    expect(writtenConfig.applied).toBe(true);
  });
});

describe("project preference helpers", () => {
  it("detects applied state per project", () => {
    const prefs = {
      recommendedAllowlistAppliedProjects: {
        "/repo/project": true,
      },
    };
    expect(isRecommendedAllowlistAppliedForProject(prefs, "/repo/project")).toBe(true);
    expect(isRecommendedAllowlistAppliedForProject(prefs, "/repo/other")).toBe(false);
  });

  it("detects dismissed state per project", () => {
    const prefs = {
      recommendedAllowlistDismissedProjects: {
        "/repo/project": true,
      },
    };
    expect(isRecommendedAllowlistDismissedForProject(prefs, "/repo/project")).toBe(true);
    expect(isRecommendedAllowlistDismissedForProject(prefs, "/repo/other")).toBe(false);
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

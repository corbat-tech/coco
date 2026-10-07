import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ReplSession } from "./types.js";
const fixture = vi.hoisted(() => ({
  root: `/tmp/coco-session-trust-${process.pid}-${Math.random().toString(16).slice(2)}`,
}));
vi.mock("../../config/paths.js", async (original) => ({
  ...(await original<typeof import("../../config/paths.js")>()),
  CONFIG_PATHS: {
    ...(await original<typeof import("../../config/paths.js")>()).CONFIG_PATHS,
    trustedTools: `${fixture.root}/global/trusted-tools.json`,
  },
}));
import {
  loadTrustedTools,
  saveTrustedTool,
  removeTrustedTool,
  saveDeniedTool,
  removeDeniedTool,
  getDeniedTools,
  getAllTrustedTools,
  initializeSessionTrust,
} from "./session.js";

describe("session trust persistence with real isolated files", () => {
  const globalFile = join(fixture.root, "global", "trusted-tools.json");
  const project = join(fixture.root, "project-a");
  const other = join(fixture.root, "project-b");
  const projectFile = join(project, ".coco", "trusted-tools.json");
  beforeEach(async () => {
    await mkdir(join(fixture.root, "global"), { recursive: true });
    await mkdir(project, { recursive: true });
    await mkdir(other, { recursive: true });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(fixture.root, { recursive: true, force: true });
  });

  it("project denial overrides global allowance without affecting another project", async () => {
    await saveTrustedTool("read_file", null, true);
    await saveTrustedTool("bash_exec", null, true);
    await saveTrustedTool("edit_file", project);
    await saveDeniedTool("bash_exec", project);
    expect(await loadTrustedTools(project)).toEqual(new Set(["read_file", "edit_file"]));
    expect(await loadTrustedTools(other)).toEqual(new Set(["read_file", "bash_exec"]));
    expect(await getAllTrustedTools(project)).toEqual({
      global: ["read_file", "bash_exec"],
      project: ["edit_file"],
      denied: ["bash_exec"],
    });
  });

  it("explicit retrust clears the project deny entry and repeated grants do not duplicate", async () => {
    await saveDeniedTool("edit_file", project);
    await saveDeniedTool("edit_file", project);
    expect(await getDeniedTools(project)).toEqual(["edit_file"]);
    await saveTrustedTool("edit_file", project);
    await saveTrustedTool("edit_file", project);
    expect(await getAllTrustedTools(project)).toEqual({
      global: [],
      project: ["edit_file"],
      denied: [],
    });
    expect(JSON.parse(await readFile(projectFile, "utf8")).trusted).toEqual(["edit_file"]);
  });

  it("revokes project and global grants independently and restores global permission after removing deny", async () => {
    await saveTrustedTool("read_file", null, true);
    await saveTrustedTool("read_file", null, true);
    await saveTrustedTool("edit_file", project);
    await removeTrustedTool("edit_file", project);
    expect(await loadTrustedTools(project)).toEqual(new Set(["read_file"]));
    await saveDeniedTool("read_file", project);
    expect(await loadTrustedTools(project)).toEqual(new Set());
    await removeDeniedTool("read_file", project);
    expect(await loadTrustedTools(project)).toEqual(new Set(["read_file"]));
    await removeTrustedTool("read_file", project, true);
    expect(await loadTrustedTools(project)).toEqual(new Set());
    expect(await loadTrustedTools(other)).toEqual(new Set());
  });

  it("reads legacy project entries then persists project-local migration without changing other projects", async () => {
    await writeFile(
      globalFile,
      JSON.stringify({
        globalTrusted: ["read_file"],
        projectTrusted: { [project]: ["edit_file"], [other]: ["glob"] },
        projectDenied: { [project]: ["bash_exec"] },
      }),
    );
    const globalBytes = await readFile(globalFile);
    expect(await loadTrustedTools(project)).toEqual(new Set(["read_file", "edit_file"]));
    await saveTrustedTool("search", project);
    expect(await loadTrustedTools(project)).toEqual(new Set(["read_file", "edit_file", "search"]));
    expect(await loadTrustedTools(other)).toEqual(new Set(["read_file", "glob"]));
    expect(await readFile(globalFile)).toEqual(globalBytes);
    expect(JSON.parse(await readFile(projectFile, "utf8")).denied).toEqual(["bash_exec"]);
  });

  it("treats missing and malformed settings as empty instead of inventing permission", async () => {
    expect(await loadTrustedTools(project)).toEqual(new Set());
    await writeFile(globalFile, "invalid JSON");
    await mkdir(join(project, ".coco"));
    await writeFile(projectFile, "invalid JSON");
    expect(await getAllTrustedTools(project)).toEqual({ global: [], project: [], denied: [] });
    const session = {
      projectPath: project,
      trustedTools: new Set(["host-granted"]),
    } as ReplSession;
    await initializeSessionTrust(session);
    expect(session.trustedTools).toEqual(new Set(["host-granted"]));
  });

  it("initializes a fresh session using effective permissions while retaining host grants", async () => {
    await saveTrustedTool("read_file", null, true);
    await saveTrustedTool("edit_file", project);
    await saveDeniedTool("read_file", project);
    const session = {
      projectPath: project,
      trustedTools: new Set(["host-granted"]),
    } as ReplSession;
    await initializeSessionTrust(session);
    expect(session.trustedTools).toEqual(new Set(["host-granted", "edit_file"]));
  });

  it("reports unavailable project storage without modifying global trust", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await saveTrustedTool("read_file", null, true);
    const before = await readFile(globalFile);
    await writeFile(join(project, ".coco"), "user-owned file blocking directory");
    await saveTrustedTool("bash_exec", project);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Failed to save project trust"));
    expect(await loadTrustedTools(project)).toEqual(new Set(["read_file"]));
    expect(await readFile(globalFile)).toEqual(before);
  });
});

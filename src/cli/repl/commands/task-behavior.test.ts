import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReplSession } from "../types.js";

const ui = vi.hoisted(() => ({
  intro: vi.fn(),
  log: { error: vi.fn(), info: vi.fn(), success: vi.fn(), message: vi.fn(), step: vi.fn() },
  can: vi.fn(),
  init: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({ intro: ui.intro, log: ui.log }));
vi.mock("../trust-store.js", () => ({ createTrustStore: () => ({ init: ui.init, can: ui.can }) }));
import { taskCommand } from "./task.js";

describe("task commands against persisted planning data", () => {
  let project: string;
  let planning: string;
  let backlogPath: string;
  let session: ReplSession;
  const initial = () => ({
    version: 3,
    customMetadata: { owner: "consultant", preserve: true },
    backlog: {
      stories: [
        { id: "story-a", title: "Authentication" },
        { id: "story-b", title: "Reporting" },
      ],
      tasks: [
        {
          id: "a",
          title: "Login",
          storyId: "story-a",
          status: "pending",
          type: "feature",
          estimatedComplexity: "simple",
          description: "Add sign-in",
          files: ["src/login.ts"],
          dependencies: ["b", "missing"],
        },
        {
          id: "b",
          title: "Export",
          storyId: "story-b",
          status: "blocked",
          type: "feature",
          estimatedComplexity: "complex",
        },
        {
          id: "c",
          title: "Polish",
          storyId: "story-a",
          status: "completed",
          type: "fix",
          estimatedComplexity: "trivial",
        },
        {
          id: "d",
          title: "Undo",
          storyId: "story-a",
          status: "rolled_back",
          type: "fix",
          estimatedComplexity: "moderate",
        },
      ],
    },
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    ui.can.mockReturnValue(true);
    ui.init.mockResolvedValue(undefined);
    project = await mkdtemp(join(tmpdir(), "coco-task-behavior-"));
    planning = join(project, ".coco", "planning");
    await mkdir(planning, { recursive: true });
    backlogPath = join(planning, "backlog.json");
    await writeFile(backlogPath, JSON.stringify(initial()));
    session = { projectPath: project } as ReplSession;
  });
  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });
  const output = () => [...ui.log.message.mock.calls, ...ui.log.step.mock.calls].flat().join("\n");

  it("starts then completes one task while preserving sibling tasks and document metadata", async () => {
    await taskCommand.execute(["start", "a"], session);
    const started = JSON.parse(await readFile(backlogPath, "utf8"));
    const expected = initial();
    expected.backlog.tasks[0]!.status = "in_progress";
    expect(started).toEqual(expected);
    expect(ui.can).toHaveBeenCalledWith(project, "write");
    await taskCommand.execute(["done", "a"], session);
    expected.backlog.tasks[0]!.status = "completed";
    expect(JSON.parse(await readFile(backlogPath, "utf8"))).toEqual(expected);
    expect(ui.log.success).toHaveBeenCalledTimes(2);
  });

  it.each(["start", "done"])("denies %s without changing any stored bytes", async (command) => {
    ui.can.mockReturnValue(false);
    const before = await readFile(backlogPath);
    await taskCommand.execute([command, "a"], session);
    expect(await readFile(backlogPath)).toEqual(before);
    expect(ui.log.error).toHaveBeenCalledWith("Write access required to update tasks");
    expect(ui.log.success).not.toHaveBeenCalled();
  });

  it("lists tasks across statuses without requiring write authority", async () => {
    ui.can.mockReturnValue(false);
    await taskCommand.execute([], session);
    for (const title of ["Login", "Export", "Polish", "Undo"]) expect(output()).toContain(title);
    expect(output()).toContain("Found 4 tasks");
    expect(ui.can).not.toHaveBeenCalled();
  });

  it("limits the list to the selected sprint while retaining the entire backlog", async () => {
    await mkdir(join(planning, "sprints"));
    await writeFile(
      join(planning, "sprints", "sprint-1.json"),
      JSON.stringify({ name: "First", stories: ["story-a"] }),
    );
    const before = await readFile(backlogPath);
    await taskCommand.execute(["list"], session);
    expect(output()).toContain('Found 3 tasks in sprint "First"');
    expect(output()).toContain("Login");
    expect(output()).not.toContain("Export");
    expect(await readFile(backlogPath)).toEqual(before);
  });

  it("shows dependency identities, descriptions and affected files", async () => {
    await taskCommand.execute(["show", "a"], session);
    expect(output()).toContain("Authentication");
    expect(output()).toContain("Add sign-in");
    expect(output()).toContain("src/login.ts");
    expect(output()).toContain("b (Export)");
    expect(output()).toContain("missing");
    expect(ui.can).not.toHaveBeenCalled();
  });

  it.each(["show", "start", "done"])(
    "rejects %s without an id or with an unknown id without writes",
    async (command) => {
      const before = await readFile(backlogPath);
      await taskCommand.execute([command], session);
      expect(ui.log.error).toHaveBeenCalledWith(`Usage: /task ${command} <task-id>`);
      await taskCommand.execute([command, "unknown"], session);
      expect(ui.log.error).toHaveBeenCalledWith("Task not found: unknown");
      expect(await readFile(backlogPath)).toEqual(before);
      expect(ui.log.success).not.toHaveBeenCalled();
    },
  );

  it.each(["missing", "invalid JSON"])(
    "handles %s planning storage without reporting mutation success",
    async (scenario) => {
      if (scenario === "missing") await rm(backlogPath);
      else await writeFile(backlogPath, "{broken");
      await taskCommand.execute(["done", "a"], session);
      expect(ui.log.error).toHaveBeenCalledWith("No backlog found. Run /plan first.");
      expect(ui.log.success).not.toHaveBeenCalled();
      expect(ui.can).not.toHaveBeenCalled();
    },
  );

  it("reports an empty backlog and an unknown operation without writes", async () => {
    const document = initial();
    document.backlog.tasks = [];
    await writeFile(backlogPath, JSON.stringify(document));
    const before = await readFile(backlogPath);
    await taskCommand.execute(["list"], session);
    expect(output()).toContain("No tasks found.");
    await taskCommand.execute(["delete", "a"], session);
    expect(ui.log.error).toHaveBeenCalledWith("Unknown subcommand: delete");
    expect(await readFile(backlogPath)).toEqual(before);
  });

  it("does not claim success when trust initialization fails", async () => {
    const before = await readFile(backlogPath);
    ui.init.mockRejectedValueOnce(new Error("trust store unavailable"));
    await expect(taskCommand.execute(["done", "a"], session)).rejects.toThrow(
      "trust store unavailable",
    );
    expect(await readFile(backlogPath)).toEqual(before);
    expect(ui.log.success).not.toHaveBeenCalled();
  });
});

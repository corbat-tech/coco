import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhaseContext } from "../types.js";
import type { GeneratedFile } from "./types.js";
import { CompleteExecutor } from "./executor.js";

const iterator = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("./iterator.js", () => ({ createTaskIterator: () => iterator }));

describe("COMPLETE executor generated file boundary", () => {
  let fixture: string;
  let project: string;
  let save: (files: GeneratedFile[]) => Promise<void>;
  beforeEach(async () => {
    fixture = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "coco-complete-boundary-")),
    );
    project = path.join(fixture, "project");
    const planning = path.join(project, ".coco", "planning");
    await fs.mkdir(planning, { recursive: true });
    await fs.writeFile(path.join(project, "keep.txt"), "original");
    await fs.writeFile(path.join(fixture, "outside.txt"), "outside");
    await fs.writeFile(
      path.join(planning, "backlog.json"),
      JSON.stringify({
        backlog: {
          epics: [],
          stories: [{ id: "story" }],
          tasks: [{ id: "task", storyId: "story", title: "Fixture", dependencies: [] }],
          currentSprint: { id: "sprint", name: "Fixture", stories: ["story"] },
          completedSprints: [],
        },
      }),
    );
    iterator.execute.mockImplementation(async (_context, _tests, saveFiles) => {
      save = saveFiles;
      return {
        taskId: "task",
        success: true,
        versions: [],
        finalScore: 90,
        converged: true,
        iterations: 1,
      };
    });
    const result = await new CompleteExecutor().execute({
      projectPath: project,
      llm: {},
      tools: {},
    } as PhaseContext);
    expect(result.success).toBe(true);
    expect(save).toBeTypeOf("function");
  });
  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(fixture, { recursive: true, force: true });
  });
  it.each(["traversal", "symlink", "invalid action"])(
    "rejects %s before the first generated write",
    async (variant) => {
      let target = "../outside.txt";
      if (variant === "symlink") {
        await fs.symlink(fixture, path.join(project, "escape"), "dir");
        target = "escape/outside.txt";
      }
      const second =
        variant === "invalid action"
          ? { path: "new.txt", content: "invalid", action: "unexpected" }
          : { path: target, content: "changed", action: "modify" };
      await expect(
        save([{ path: "keep.txt", content: "changed", action: "modify" }, second as GeneratedFile]),
      ).rejects.toThrow();
      expect(await fs.readFile(path.join(project, "keep.txt"), "utf8")).toBe("original");
      expect(await fs.readFile(path.join(fixture, "outside.txt"), "utf8")).toBe("outside");
    },
  );
  it("writes an accepted batch through the executor callback", async () => {
    await save([{ path: "nested/new.txt", content: "generated", action: "create" }]);
    expect(await fs.readFile(path.join(project, "nested/new.txt"), "utf8")).toBe("generated");
  });
});

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { CheckpointManager } from "./manager.js";
import { withFileCheckpoints } from "./capture.js";

describe("owned file checkpoints", () => {
  it("does not suppress or repeat dispatch when no project snapshot can be captured", async () => {
    const root = await mkdtemp(join(tmpdir(), "coco-capture-missing-"));
    try {
      let calls = 0;
      const manager = new CheckpointManager({ storageDir: join(root, "checkpoints") });
      const dispatch = withFileCheckpoints(
        async () => {
          calls++;
          return { success: false, error: "Rejected by execution policy", duration: 0 };
        },
        "session",
        join(root, "missing"),
        manager,
      );
      const result = await dispatch({ id: "call", name: "write_file", input: { path: "file.ts" } });
      expect(result.success).toBe(false);
      expect(calls).toBe(1);
      expect(await manager.getCheckpoints("session")).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("captures and restores a real edit while preserving staged and untracked work", async () => {
    const root = await mkdtemp(join(tmpdir(), "coco-capture-"));
    const project = join(root, "project");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(project);
    try {
      await execa("git", ["init", "--quiet"], { cwd: project });
      const filePath = join(project, "file.ts");
      await writeFile(filePath, "before");
      await writeFile(join(project, "staged.txt"), "staged user work");
      await execa("git", ["add", "file.ts", "staged.txt"], { cwd: project });
      const index = await readFile(join(project, ".git", "index"));
      await writeFile(join(project, "untracked.txt"), "untracked user work");
      const manager = new CheckpointManager({ storageDir: join(root, "checkpoints") });
      const dispatch = withFileCheckpoints(
        async () => {
          await writeFile(filePath, "after");
          return { success: true, data: {}, duration: 0 };
        },
        "session",
        project,
        manager,
      );
      await dispatch({
        id: "call",
        name: "write_file",
        input: { path: filePath, content: "after" },
      });
      const checkpoints = await manager.getCheckpoints("session");
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0]!.files[0]).toMatchObject({
        originalExists: true,
        newExists: true,
        originalContent: "before",
        newContent: "after",
      });
      const result = await manager.rewind({
        checkpointId: checkpoints[0]!.id,
        sessionId: "session",
        projectPath: project,
        restoreFiles: true,
        restoreConversation: false,
      });
      expect(result.filesFailed).toEqual([]);
      expect(await readFile(filePath, "utf8")).toBe("before");
      expect(await readFile(join(project, ".git", "index"))).toEqual(index);
      expect(await readFile(join(project, "untracked.txt"), "utf8")).toBe("untracked user work");
      expect(await readFile(join(project, "staged.txt"), "utf8")).toBe("staged user work");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("does not bind a relative tool path to the project when host cwd differs", async () => {
    const project = await mkdtemp(join(tmpdir(), "coco-other-project-"));
    try {
      const manager = new CheckpointManager({ storageDir: join(project, ".checkpoints") });
      await writeFile(join(project, "relative.ts"), "unrelated project file");
      const dispatch = withFileCheckpoints(
        async () => ({ success: true, data: {}, duration: 0 }),
        "session",
        project,
        manager,
      );
      await dispatch({
        id: "relative",
        name: "write_file",
        input: { path: "relative.ts", content: "host cwd effect" },
      });
      expect(await manager.getCheckpoints("session")).toEqual([]);
      expect(await readFile(join(project, "relative.ts"), "utf8")).toBe("unrelated project file");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
  it("does not certify binary output as a reversible text edit", async () => {
    const project = await mkdtemp(join(tmpdir(), "coco-binary-project-"));
    try {
      const file = join(project, "file.ts");
      await writeFile(file, "before");
      const manager = new CheckpointManager({ storageDir: join(project, ".checkpoints") });
      const dispatch = withFileCheckpoints(
        async () => {
          await writeFile(file, Buffer.from([0xff]));
          return { success: true, data: {}, duration: 0 };
        },
        "session",
        project,
        manager,
      );
      expect(
        (
          await dispatch({
            id: "binary",
            name: "write_file",
            input: { path: file, content: "effect" },
          })
        ).success,
      ).toBe(true);
      expect(await manager.getCheckpoints("session")).toEqual([]);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
  it("refuses corrupted stored preimages before restoration", async () => {
    const project = await mkdtemp(join(tmpdir(), "coco-corrupt-checkpoint-"));
    try {
      const file = join(project, "file.ts"),
        storageDir = join(project, ".checkpoints");
      await writeFile(file, "before");
      const manager = new CheckpointManager({ storageDir });
      const dispatch = withFileCheckpoints(
        async () => {
          await writeFile(file, "after");
          return { success: true, data: {}, duration: 0 };
        },
        "session",
        project,
        manager,
      );
      await dispatch({
        id: "corrupt",
        name: "write_file",
        input: { path: file, content: "after" },
      });
      const checkpoints = await manager.getCheckpoints("session");
      const stored = JSON.parse(
        await readFile(join(storageDir, "session", checkpoints[0]!.id + ".json"), "utf8"),
      );
      await writeFile(
        join(storageDir, "session", "files", stored.files[0].contentHash + ".txt"),
        "corrupt",
      );
      await expect(new CheckpointManager({ storageDir }).getCheckpoints("session")).rejects.toThrow(
        /missing/,
      );
      expect(await readFile(file, "utf8")).toBe("after");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});

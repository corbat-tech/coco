import { mkdtemp, readFile, rm, writeFile, mkdir, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { restoreCheckpointFiles } from "./safe-restore.js";
import type { FileCheckpoint } from "./types.js";

describe("checkpoint restoration preflight", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "coco-restore-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const file = (
    filePath: string,
    originalContent = "before",
    newContent = "after",
  ): FileCheckpoint => ({
    id: "file_test",
    filePath,
    originalContent,
    newContent,
    originalExists: true,
    newExists: true,
    triggeredBy: "edit_file",
    createdAt: new Date(),
    size: originalContent.length,
  });
  it("preflights every file before writing, preserving external changes", async () => {
    const a = join(root, "a.ts"),
      b = join(root, "b.ts"),
      unrelated = join(root, "untracked.txt");
    await writeFile(a, "after");
    await writeFile(b, "user edit");
    await writeFile(unrelated, "keep");
    const result = await restoreCheckpointFiles([file(a), file(b)], root);
    expect(result.restored).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(await readFile(a, "utf8")).toBe("after");
    expect(await readFile(b, "utf8")).toBe("user edit");
    expect(await readFile(unrelated, "utf8")).toBe("keep");
  });
  it("restores exact content and removes newly created files", async () => {
    const a = join(root, "a.ts"),
      b = join(root, "new.ts");
    await writeFile(a, "longer content");
    await writeFile(b, "new");
    const result = await restoreCheckpointFiles(
      [file(a, "old", "longer content"), { ...file(b, "", "new"), originalExists: false }],
      root,
    );
    expect(result.failed).toEqual([]);
    expect(await readFile(a, "utf8")).toBe("old");
    await expect(readFile(b)).rejects.toThrow();
  });
  it("refuses legacy snapshots and paths outside the project", async () => {
    const a = join(root, "a.ts");
    await writeFile(a, "after");
    const result = await restoreCheckpointFiles(
      [{ ...file(a), newExists: undefined }, file(join(root, "..", "foreign.ts"))],
      root,
    );
    expect(result.failed).toHaveLength(2);
    expect(await readFile(a, "utf8")).toBe("after");
  });
  it("rejects control files, relative paths, hardlinks and non-UTF8 postimages", async () => {
    await mkdir(join(root, ".git"));
    const index = join(root, ".git", "index"),
      source = join(root, "hardlink-source"),
      linked = join(root, "linked.ts"),
      binary = join(root, "binary.ts");
    await writeFile(index, "after");
    await writeFile(source, "after");
    await link(source, linked);
    await writeFile(binary, Buffer.from([0xff]));
    const result = await restoreCheckpointFiles(
      [file(index), file("relative.ts"), file(linked), file(binary, "before", "�")],
      root,
    );
    expect(result.restored).toEqual([]);
    expect(result.failed).toHaveLength(4);
    expect(await readFile(index, "utf8")).toBe("after");
    expect(await readFile(source, "utf8")).toBe("after");
    expect(await readFile(binary)).toEqual(Buffer.from([0xff]));
  });
});

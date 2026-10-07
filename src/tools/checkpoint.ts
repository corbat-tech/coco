/** Git checkpoints preserve staging and refuse to discard subsequent work. */
import { z } from "zod";
import { defineTool, type ToolDefinition } from "./registry.js";
import { ToolError } from "../utils/errors.js";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execa } from "execa";

const METADATA = ".coco/checkpoints.json";
const LOCK = ".coco/checkpoints.lock";
const MAX_BYTES = 1024 * 1024;
const oid = z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
const entrySchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9-]+$/),
    description: z.string(),
    timestamp: z.string(),
    stashRef: z.string().optional(),
    fileCount: z.number().int().nonnegative(),
    files: z.array(z.string()),
    version: z.literal(2).optional(),
    projectRoot: z.string().optional(),
    head: oid.optional(),
    stashOid: oid.optional(),
  })
  .superRefine((entry, context) => {
    if (
      entry.version === 2 &&
      (!entry.projectRoot || !entry.head || (entry.fileCount > 0 && !entry.stashOid))
    )
      context.addIssue({ code: "custom", message: "Incomplete checkpoint binding" });
  });
export type Checkpoint = z.infer<typeof entrySchema>;
function fail(message: string): never {
  throw new ToolError(message, { tool: "checkpoint" });
}

async function git(root: string, args: string[]): Promise<string> {
  try {
    return (
      await execa("git", args, {
        cwd: root,
        timeout: 30000,
        maxBuffer: MAX_BYTES,
        env: { GIT_OPTIONAL_LOCKS: "0" },
      })
    ).stdout;
  } catch (error) {
    throw new ToolError(
      `Git ${args[0]} failed: ${error instanceof Error ? error.message : String(error)}`,
      { tool: "checkpoint" },
    );
  }
}
async function projectRoot(): Promise<string> {
  const root = await fs.realpath(process.cwd());
  const top = await fs.realpath(await git(root, ["rev-parse", "--show-toplevel"]));
  if (root !== top) fail("Checkpoint tools must run at the canonical Git repository root");
  return root;
}
async function metadataDir(root: string, create = false): Promise<boolean> {
  const dir = path.join(root, ".coco");
  try {
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (await fs.realpath(dir)) !== dir)
      fail("Checkpoint metadata directory must be a regular directory inside the project");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!create) return false;
    await fs.mkdir(dir, { mode: 0o700 });
    return metadataDir(root);
  }
}
async function readMetadata(root: string): Promise<Checkpoint[]> {
  if (!(await metadataDir(root))) return [];
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(path.join(root, METADATA), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES)
      fail("Unsafe or oversized checkpoint metadata");
    const parsed = z
      .array(entrySchema)
      .max(10000)
      .safeParse(JSON.parse(await handle.readFile("utf8")));
    if (!parsed.success) fail("Invalid checkpoint metadata; original file retained");
    return parsed.data;
  } finally {
    await handle.close();
  }
}
async function writeMetadata(root: string, entries: Checkpoint[]): Promise<void> {
  await metadataDir(root);
  await readMetadata(root); // Recheck existing target before atomic replacement.
  const temporary = path.join(root, ".coco", `checkpoint-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(entries, null, 2), { flag: "wx", mode: 0o600 });
    await metadataDir(root);
    await readMetadata(root);
    await fs.rename(temporary, path.join(root, METADATA));
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
async function locked<T>(root: string, action: () => Promise<T>): Promise<T> {
  await metadataDir(root, true);
  const lockPath = path.join(root, LOCK);
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(lockPath, "wx", 0o600);
  } catch {
    return fail("Checkpoint metadata is locked or unsafe; no working files were changed");
  }
  const owned = await handle.stat();
  try {
    return await action();
  } finally {
    await handle.close();
    await metadataDir(root);
    const current = await fs.lstat(lockPath).catch(() => undefined);
    if (current?.ino === owned.ino && current.dev === owned.dev) await fs.unlink(lockPath);
  }
}
async function status(root: string): Promise<Array<{ state: string; file: string }>> {
  const entries = (
    await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
  ).split("\0");
  const result: Array<{ state: string; file: string }> = [];
  for (let i = 0; i < entries.length; i++) {
    const value = entries[i];
    if (!value) continue;
    const state = value.slice(0, 2),
      file = value.slice(3);
    if (state === "??" && (file === METADATA || file === LOCK)) continue;
    result.push({ state, file });
    if (state.includes("R") || state.includes("C")) i++;
  }
  return result;
}

export const createCheckpointTool: ToolDefinition<
  { description: string },
  { id: string; description: string; fileCount: number; files: string[]; method: "stash" | "clean" }
> = defineTool({
  name: "create_checkpoint",
  category: "memory",
  description:
    "Snapshot tracked Git changes without changing the working tree or staging. Requires the repository root and an existing HEAD. Untracked files are unsupported and cause refusal. Restore requires a clean tree at the same HEAD.",
  parameters: z.object({ description: z.string().min(1).max(200) }),
  async execute({ description }) {
    const root = await projectRoot();
    return locked(root, async () => {
      const entries = await readMetadata(root);
      const changes = await status(root);
      if (changes.some((change) => change.state === "??"))
        fail(
          "Untracked files cannot be captured safely; checkpoint not created. Files were retained.",
        );
      if (changes.some((change) => change.file === METADATA || change.file === LOCK))
        fail("Tracked checkpoint control files cannot be captured");
      if (await git(root, ["diff", "--name-only", "--diff-filter=U"]))
        fail("Resolve merge conflicts before checkpointing");
      const head = (await git(root, ["rev-parse", "HEAD"])).trim();
      const id = randomUUID();
      const stashOid =
        (await git(root, ["stash", "create", `coco checkpoint ${id}`])).trim() || undefined;
      if (changes.length && !stashOid)
        fail("Git could not snapshot these changes; checkpoint not created");
      if (stashOid) {
        if (!oid.safeParse(stashOid).success) fail("Invalid snapshot object returned by Git");
        await git(root, ["update-ref", `refs/coco/checkpoints/${id}`, stashOid, ""]);
      }
      const files = changes.map((change) => change.file);
      const entry: Checkpoint = {
        id,
        description,
        timestamp: new Date().toISOString(),
        fileCount: files.length,
        files,
        version: 2,
        projectRoot: root,
        head,
        stashOid,
      };
      await writeMetadata(root, [entry, ...entries].slice(0, 50));
      return {
        id,
        description,
        fileCount: files.length,
        files: files.slice(0, 20),
        method: stashOid ? ("stash" as const) : ("clean" as const),
      };
    });
  },
});

export const restoreCheckpointTool: ToolDefinition<
  { id: string },
  { id: string; description: string; restored: boolean; message: string }
> = defineTool({
  name: "restore_checkpoint",
  category: "memory",
  description:
    "Apply a bound checkpoint only to a clean working tree and index at its original HEAD. Refuses dirty/untracked work and legacy unbound snapshots; never discards files or cleans the repository.",
  parameters: z.object({ id: z.string().min(1) }),
  async execute({ id }) {
    const root = await projectRoot();
    return locked(root, async () => {
      const checkpoint = (await readMetadata(root)).find((entry) => entry.id === id);
      if (!checkpoint) fail(`Checkpoint '${id}' not found`);
      if (checkpoint.version !== 2 || checkpoint.projectRoot !== root || !checkpoint.head)
        fail(
          "Legacy or foreign checkpoint is read-only; repository binding is missing or mismatched",
        );
      const head = (await git(root, ["rev-parse", "HEAD"])).trim();
      if (head !== checkpoint.head) fail("HEAD changed since checkpoint creation; restore refused");
      if ((await status(root)).length)
        fail("Working tree or index is not clean; restore refused without discarding changes");
      if (!checkpoint.stashOid)
        return {
          id,
          description: checkpoint.description,
          restored: false,
          message: "Checkpoint records the current clean HEAD; no changes to apply.",
        };
      const parents = (await git(root, ["rev-list", "--parents", "-n", "1", checkpoint.stashOid]))
        .trim()
        .split(/\s+/);
      if (
        parents.length !== 3 ||
        parents[0] !== checkpoint.stashOid ||
        parents[1] !== head ||
        (await git(root, ["rev-parse", `${parents[2]}^`])).trim() !== head
      )
        fail("Checkpoint object is not a snapshot of the bound HEAD");
      // Git may overwrite ignored files when restoring newly added paths. Refuse these too.
      const additions = (
        await git(root, [
          "diff",
          "--no-renames",
          "--name-only",
          "--diff-filter=A",
          "-z",
          head,
          checkpoint.stashOid,
        ])
      )
        .split("\0")
        .filter(Boolean);
      for (const file of additions) {
        const existing = await fs
          .lstat(path.join(root, file))
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return undefined;
            throw error;
          });
        if (existing)
          fail(`Checkpoint would replace an existing untracked or ignored path: ${file}`);
      }
      try {
        await git(root, ["stash", "apply", "--index", checkpoint.stashOid]);
      } catch (error) {
        throw new ToolError(
          `Checkpoint apply failed and may be partial. Inspect Git status; checkpoint retained. No cleanup was performed. ${error instanceof Error ? error.message : String(error)}`,
          { tool: "restore_checkpoint" },
        );
      }
      return {
        id,
        description: checkpoint.description,
        restored: true,
        message: `Restored checkpoint '${checkpoint.description}' (${checkpoint.fileCount} files)`,
      };
    });
  },
});

export const listCheckpointsTool: ToolDefinition<
  { limit?: number },
  { checkpoints: Checkpoint[]; total: number }
> = defineTool({
  name: "list_checkpoints",
  category: "memory",
  description:
    "List checkpoint metadata. Legacy entries remain readable but cannot be restored safely.",
  parameters: z.object({ limit: z.number().int().min(1).max(100).optional().default(20) }),
  async execute({ limit }) {
    const entries = await readMetadata(await projectRoot());
    return { checkpoints: entries.slice(0, limit ?? 20), total: entries.length };
  },
});
export const checkpointTools = [createCheckpointTool, restoreCheckpointTool, listCheckpointsTool];

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore } from "./storage.js";
import type { ReplSession } from "../types.js";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename) };
});

const directories: string[] = [];
afterEach(async () => {
  vi.mocked(rename).mockClear();
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "coco-snapshot-"));
  directories.push(dir);
  const store = createSessionStore({ storageDir: dir });
  const session = {
    id: "snapshot-test",
    projectPath: "/project",
    startedAt: new Date(),
    messages: [{ role: "user", content: "Keep my constraints" }],
    config: { agent: { systemPrompt: "fixture" } },
    trustedTools: new Set(["edit_file"]),
    workLedger: {
      version: 1,
      planRevision: 1,
      mutationRevision: 0,
      items: [{ id: "a", description: "Pending task", status: "pending", evidenceIds: [] }],
      evidence: [],
    },
  } as unknown as ReplSession;
  return { dir, store, session };
}

describe("atomic REPL session snapshots", () => {
  it("preserves messages and work through reopening without persisting consent", async () => {
    const { dir, store, session } = await fixture();
    await store.save(session);
    const loaded = await createSessionStore({ storageDir: dir }).load(session.id);
    expect(loaded?.messages).toEqual(session.messages);
    expect(loaded?.workLedger).toEqual(session.workLedger);
    expect(loaded?.trustedTools.size).toBe(0);
    await writeFile(join(dir, session.id, "metadata.json"), "torn projection");
    expect((await store.listSessions())[0]?.id).toBe(session.id);
  });

  it("retains the previous complete snapshot after a failed commit and removes its temporary file", async () => {
    const { dir, store, session } = await fixture();
    await store.save(session);
    const original = await readFile(join(dir, session.id, "snapshot.json"), "utf8");
    session.messages.push({ role: "assistant", content: "Uncommitted change" });
    vi.mocked(rename).mockRejectedValueOnce(new Error("disk commit failed"));
    await expect(store.save(session)).rejects.toThrow("disk commit failed");
    expect(await readFile(join(dir, session.id, "snapshot.json"), "utf8")).toBe(original);
    expect((await store.load(session.id))?.messages).toHaveLength(1);
    expect((await readdir(join(dir, session.id))).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );
  });

  it("fails closed on a corrupt authoritative snapshot instead of reviving stale legacy state", async () => {
    const { dir, store, session } = await fixture();
    await store.save(session);
    await writeFile(join(dir, session.id, "snapshot.json"), "invalid JSON");
    expect(await store.load(session.id)).toBeNull();
    expect(await store.listSessions()).toEqual([]);
  });

  it("does not create a readable legacy session when the first snapshot commit fails", async () => {
    const { dir, store, session } = await fixture();
    vi.mocked(rename).mockRejectedValueOnce(new Error("first commit failed"));
    await expect(store.save(session)).rejects.toThrow("first commit failed");
    expect(await store.load(session.id)).toBeNull();
    expect(await store.listSessions()).toEqual([]);
    expect(await readdir(join(dir, session.id))).toEqual([]);
  });

  it("captures one coherent state before awaits and serializes concurrent saves", async () => {
    const { store, session } = await fixture();
    const first = store.save(session);
    session.messages.push({ role: "assistant", content: "Later action" });
    session.workLedger!.items[0]!.status = "completed";
    await first;
    const captured = await store.load(session.id);
    expect(captured?.messages).toHaveLength(1);
    expect(captured?.workLedger?.items[0]?.status).toBe("pending");
    const second = store.save(session);
    session.messages.push({ role: "user", content: "Newest request" });
    const third = store.save(session);
    await Promise.all([second, third]);
    expect((await store.load(session.id))?.messages).toHaveLength(3);
  });

  it("rejects session path traversal", async () => {
    const { store } = await fixture();
    expect(() => store.getSessionDir("../escape")).toThrow("Invalid session ID");
  });
});

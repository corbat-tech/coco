import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ReplSession } from "../types.js";
import type { Message } from "../../../providers/types.js";
const io = vi.hoisted(() => ({
  manager: null as unknown,
  store: null as unknown,
  text: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  outro: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({
  text: io.text,
  select: io.select,
  confirm: io.confirm,
  outro: io.outro,
  isCancel: (value: unknown) => typeof value === "symbol",
}));
vi.mock("../checkpoints/manager.js", async (original) => ({
  ...(await original<typeof import("../checkpoints/manager.js")>()),
  getCheckpointManager: () => io.manager,
}));
vi.mock("../sessions/storage.js", async (original) => ({
  ...(await original<typeof import("../sessions/storage.js")>()),
  getSessionStore: () => io.store,
}));
import { CheckpointManager } from "../checkpoints/manager.js";
import { SessionStore } from "../sessions/storage.js";
import { rewindCommand } from "./rewind.js";
import { resumeCommand } from "./resume.js";

describe("recovery commands using persisted histories and snapshots", () => {
  let root: string;
  let project: string;
  let manager: CheckpointManager;
  let store: SessionStore;
  let current: ReplSession;
  const savedMessages: Message[] = [
    { role: "user", content: "Saved work" },
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "pending-call",
          name: "bash_exec",
          input: { command: "must never replay" },
        },
      ],
    },
  ];
  function makeSession(id: string, projectPath = project): ReplSession {
    return {
      id,
      projectPath,
      startedAt: new Date(),
      messages: [{ role: "user", content: "Current work" }],
      trustedTools: new Set(["read_file"]),
      config: {
        provider: { type: "ollama", model: "host-model", maxTokens: 4096 },
      } as ReplSession["config"],
    };
  }
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    root = await mkdtemp(join(tmpdir(), "coco-recovery-command-"));
    project = join(root, "project");
    await mkdir(project);
    manager = new CheckpointManager({ storageDir: join(root, "checkpoints") });
    store = new SessionStore({ storageDir: join(root, "sessions") });
    io.manager = manager;
    io.store = store;
    current = makeSession("current");
    io.confirm.mockResolvedValue(true);
    io.text.mockResolvedValue("1");
    io.select.mockResolvedValue("both");
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });
  async function checkpoint() {
    const file = join(project, "owned.txt");
    await writeFile(file, "before");
    const cp = await manager.createCheckpoint(current.id, "combined", [file], savedMessages);
    cp.files[0]!.newContent = "after";
    cp.files[0]!.newExists = true;
    await manager.storeCheckpoint(cp);
    await writeFile(file, "after");
    return { cp, file };
  }
  async function savedSession(projectPath = project) {
    const saved = makeSession("saved", projectPath);
    saved.messages = savedMessages;
    saved.config.provider.model = "disk-model";
    saved.trustedTools.add("bash_exec");
    await store.save(saved);
    return saved;
  }
  const output = () => vi.mocked(console.log).mock.calls.flat().join("\n");

  it.each(["both", "files", "conversation"])(
    "interactive rewind restores only selected %s state",
    async (choice) => {
      const { file } = await checkpoint();
      io.select.mockResolvedValue(choice);
      await rewindCommand.execute([], current);
      expect(await readFile(file, "utf8")).toBe(choice === "conversation" ? "after" : "before");
      if (choice === "files")
        expect(current.messages).toEqual([{ role: "user", content: "Current work" }]);
      else {
        expect(current.messages[0]).toEqual(savedMessages[0]);
        expect(current.messages.at(-1)?.content).toEqual([
          expect.objectContaining({
            type: "tool_result",
            tool_use_id: "pending-call",
            is_error: true,
            content: expect.stringContaining("unknown"),
          }),
        ]);
      }
    },
  );

  it("direct rewind uses persisted checkpoint bytes after a fresh manager is created", async () => {
    const { cp, file } = await checkpoint();
    io.manager = new CheckpointManager({ storageDir: join(root, "checkpoints") });
    await rewindCommand.execute([cp.id], current);
    expect(await readFile(file, "utf8")).toBe("before");
    expect(output()).toContain("Successfully restored");
  });

  it("refuses modified postimages and reports failure without overwriting subsequent user work", async () => {
    const { cp, file } = await checkpoint();
    await writeFile(file, "user correction");
    await rewindCommand.execute([cp.id], current);
    expect(await readFile(file, "utf8")).toBe("user correction");
    expect(output()).toContain("Failed:");
    expect(output()).not.toContain("Successfully restored");
  });

  it.each(["selection", "scope", "confirmation"])(
    "cancels rewind at %s without restoring anything",
    async (stage) => {
      const { file } = await checkpoint();
      if (stage === "selection") io.text.mockResolvedValue("q");
      if (stage === "scope") io.select.mockResolvedValue(Symbol("cancel"));
      if (stage === "confirmation") io.confirm.mockResolvedValue(false);
      await rewindCommand.execute([], current);
      expect(await readFile(file, "utf8")).toBe("after");
      expect(current.messages[0]?.content).toBe("Current work");
      expect(io.outro).toHaveBeenCalledWith("Cancelled");
    },
  );

  it("does not expose another session's checkpoint and handles empty selection", async () => {
    const { cp, file } = await checkpoint();
    current.id = "other";
    await rewindCommand.execute([cp.id], current);
    await rewindCommand.execute([], current);
    expect(output()).toContain("Checkpoint not found");
    expect(output()).toContain("No checkpoints available");
    expect(io.confirm).not.toHaveBeenCalled();
    expect(await readFile(file, "utf8")).toBe("after");
  });

  it("resumes disk conversation while retaining host configuration, authority and no effect replay", async () => {
    await savedSession();
    const calls: string[] = [];
    const runtime = {
      closeSession: vi.fn(async (id: string) => {
        calls.push(`close:${id}`);
      }),
      getSession: vi.fn(() => undefined),
      createSession: vi.fn((value: { id: string }) => {
        calls.push(`create:${value.id}`);
      }),
      enableBackgroundJobs: vi.fn((id: string) => {
        calls.push(`enable:${id}`);
      }),
    };
    current.runtime = runtime as unknown as NonNullable<ReplSession["runtime"]>;
    await resumeCommand.execute([], current);
    expect(current.id).toBe("saved");
    expect(current.config.provider.model).toBe("host-model");
    expect([...current.trustedTools]).toEqual(["read_file"]);
    expect(current.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ is_error: true, tool_use_id: "pending-call" }),
    ]);
    expect(calls).toEqual(["close:current", "close:saved", "create:saved", "enable:saved"]);
    expect(runtime.enableBackgroundJobs).toHaveBeenCalledWith("saved", await realpath(project));
  });

  it("reuses an existing host runtime session after closing prior job ownership", async () => {
    await savedSession();
    const update = vi.fn();
    current.runtime = {
      closeSession: vi.fn(async () => {}),
      getSession: vi.fn(() => ({ id: "saved", mode: "plan", messages: [] })),
      runtimeSessionStore: { update },
      enableBackgroundJobs: vi.fn(),
    } as unknown as NonNullable<ReplSession["runtime"]>;
    await resumeCommand.execute(["saved"], current);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: "saved", mode: "plan", messages: current.messages }),
    );
    expect(current.id).toBe("saved");
  });

  it.each(["selection", "confirmation"])(
    "cancelled resume at %s leaves current identity and messages unchanged",
    async (stage) => {
      await savedSession();
      if (stage === "selection") io.text.mockResolvedValue(Symbol("cancel"));
      else io.confirm.mockResolvedValue(false);
      await resumeCommand.execute([], current);
      expect(current.id).toBe("current");
      expect(current.messages[0]?.content).toBe("Current work");
    },
  );

  it("rejects persisted cross-project history without changing active state", async () => {
    const foreign = join(root, "foreign");
    await mkdir(foreign);
    await savedSession(foreign);
    await resumeCommand.execute(["saved"], current);
    expect(current.id).toBe("current");
    expect(output()).toContain("another project");
  });

  it("handles missing and corrupted disk histories without claiming restoration", async () => {
    await resumeCommand.execute([], current);
    await resumeCommand.execute(["missing"], current);
    await savedSession();
    await writeFile(join(store.getSessionDir("saved"), "conversation.jsonl"), "invalid JSON");
    await resumeCommand.execute(["saved"], current);
    expect(current.id).toBe("current");
    expect(output()).toContain("Failed to load session");
    expect(output()).not.toContain("Session resumed:");
  });
});

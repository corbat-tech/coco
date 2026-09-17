import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../../../providers/types.js";
const mocks = vi.hoisted(() => ({ listSessions: vi.fn(), load: vi.fn() }));
vi.mock("@clack/prompts", () => ({ confirm: vi.fn(async () => true), isCancel: () => false }));
vi.mock("../sessions/storage.js", () => ({ getSessionStore: () => mocks }));
import type { ReplSession } from "../types.js";
import { markInterruptedToolCalls, resumeCommand } from "./resume.js";

describe("resumed tool outcomes", () => {
  it("marks unfinished effects unknown without replaying them", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "call", name: "bash_exec", input: { command: "irreversible" } },
        ],
      },
    ];
    const restored = markInterruptedToolCalls(messages);
    expect(restored).toHaveLength(2);
    expect(restored[1]!.content).toEqual([
      expect.objectContaining({
        type: "tool_result",
        tool_use_id: "call",
        is_error: true,
        content: expect.stringContaining("unknown"),
      }),
    ]);
    expect(messages).toHaveLength(1);
  });
  it("preserves completed calls and does not invent retries", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call", name: "write_file", input: {} }],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call", content: "done" }] },
    ];
    expect(markInterruptedToolCalls(messages)).toEqual(messages);
  });
});

describe("resume project and authority boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  function session(id: string, projectPath = process.cwd()): ReplSession {
    return {
      id,
      projectPath,
      startedAt: new Date(),
      messages: [],
      trustedTools: new Set(["read_file"]),
      config: { provider: { type: "ollama", model: "host-model" } } as ReplSession["config"],
    };
  }
  function stored(target: ReplSession) {
    return {
      ...target,
      lastSavedAt: new Date(),
      status: "interrupted",
      messageCount: 0,
      totalTokens: { input: 0, output: 0 },
    };
  }
  it("rejects a cross-project session before changing the active conversation", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const current = session("current"),
      target = session("saved", process.cwd() + "/..");
    mocks.listSessions.mockResolvedValue([stored(target)]);
    mocks.load.mockResolvedValue(target);
    await resumeCommand.execute(["saved"], current);
    expect(current.id).toBe("current");
    expect(current.messages).toEqual([]);
  });
  it("restores stable identity but not persisted model or tool consent", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const current = session("current"),
      target = session("saved");
    target.config.provider.model = "persisted-model";
    target.trustedTools.add("bash_exec");
    target.messages.push({ role: "user", content: "saved work" });
    mocks.listSessions.mockResolvedValue([stored(target)]);
    mocks.load.mockResolvedValue(target);
    await resumeCommand.execute(["saved"], current);
    expect(current.id).toBe("saved");
    expect(current.messages).toEqual(target.messages);
    expect(current.config.provider.model).toBe("host-model");
    expect(current.trustedTools.has("bash_exec")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { runReplayFixture } from "./replay-harness.js";

describe("runReplayFixture", () => {
  it("replays a text-only turn", async () => {
    const replay = await runReplayFixture({
      userMessage: "hello",
      stream: [
        { type: "text", text: "Hello from replay" },
        { type: "done", stopReason: "end_turn" },
      ],
    });

    expect(replay.result.aborted).toBe(false);
    expect(replay.result.content).toContain("Hello from replay");
    expect(replay.result.toolCalls).toHaveLength(0);
  });

  it("replays a turn with a tool call and result", async () => {
    const replay = await runReplayFixture({
      userMessage: "read file",
      turns: [
        [
          { type: "tool_use_start", toolCall: { id: "call_1", name: "read_file" } },
          {
            type: "tool_use_end",
            toolCall: { id: "call_1", name: "read_file", input: { path: "README.md" } },
          },
          { type: "done", stopReason: "tool_use" },
        ],
        [
          { type: "text", text: "Done reading." },
          { type: "done", stopReason: "end_turn" },
        ],
      ],
      toolOutputs: {
        read_file: { success: true, output: "README content" },
      },
    });

    expect(replay.result.aborted).toBe(false);
    expect(replay.result.toolCalls).toHaveLength(1);
    expect(replay.result.toolCalls[0]?.name).toBe("read_file");
    expect(replay.result.content).toContain("Done reading.");
  });
});

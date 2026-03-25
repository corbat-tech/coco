import { describe, it, expect } from "vitest";
import {
  ChatToolCallAssembler,
  ResponsesToolCallAssembler,
  parseToolCallArguments,
} from "./tool-call-normalizer.js";

describe("parseToolCallArguments", () => {
  it("parses valid JSON", () => {
    const parsed = parseToolCallArguments('{"path":"src/a.ts"}', "test-provider");
    expect(parsed).toEqual({ path: "src/a.ts" });
  });

  it("repairs truncated JSON when possible", () => {
    const parsed = parseToolCallArguments('{"path":"src/a.ts","content":"hi"', "test-provider");
    expect(parsed).toEqual({ path: "src/a.ts", content: "hi" });
  });
});

describe("ChatToolCallAssembler", () => {
  it("accumulates tool call arguments when follow-up deltas omit index and id", () => {
    const assembler = new ChatToolCallAssembler();

    const first = assembler.consume({
      index: 0,
      id: "call_1",
      function: { name: "write_file", arguments: '{"path":"src/a.ts"' },
    });
    const second = assembler.consume({
      function: { arguments: ',"content":"hello"}' },
    });

    expect(first.started).toEqual({ id: "call_1", name: "write_file" });
    expect(second.argumentDelta?.text).toBe(',"content":"hello"}');

    const finalized = assembler.finalizeAll("test-provider");
    expect(finalized).toEqual([
      {
        id: "call_1",
        name: "write_file",
        input: { path: "src/a.ts", content: "hello" },
      },
    ]);
  });
});

describe("ResponsesToolCallAssembler", () => {
  it("resolves argument deltas by output_index when item_id is missing", () => {
    const assembler = new ResponsesToolCallAssembler();
    const start = assembler.onOutputItemAdded({
      output_index: 0,
      item: {
        type: "function_call",
        id: "item_1",
        call_id: "call_1",
        name: "write_file",
        arguments: '{"path":"src/a.ts"',
      },
    });

    assembler.onArgumentsDelta({
      output_index: 0,
      delta: ',"content":"hello"}',
    });

    const completed = assembler.onArgumentsDone(
      {
        output_index: 0,
      },
      "test-provider",
    );

    expect(start).toEqual({ id: "call_1", name: "write_file" });
    expect(completed).toEqual({
      id: "call_1",
      name: "write_file",
      input: { path: "src/a.ts", content: "hello" },
    });
  });

  it("finalizes remaining calls when done event is missing", () => {
    const assembler = new ResponsesToolCallAssembler();
    assembler.onOutputItemAdded({
      item: {
        type: "function_call",
        id: "item_2",
        call_id: "call_2",
        name: "read_file",
        arguments: '{"path":"README.md"}',
      },
    });

    const finalized = assembler.finalizeAll("test-provider");
    expect(finalized).toEqual([
      {
        id: "call_2",
        name: "read_file",
        input: { path: "README.md" },
      },
    ]);
  });
});

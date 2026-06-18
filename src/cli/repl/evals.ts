import type { ReplayFixture } from "./replay-harness.js";
import { runReplayFixture } from "./replay-harness.js";

export interface EvalFixture {
  id: string;
  description: string;
  fixture: ReplayFixture;
  expectedContent?: string;
  expectedTools?: string[];
}

export interface EvalRunResult {
  id: string;
  description: string;
  passed: boolean;
  duration: number;
  outputTokens: number;
  inputTokens: number;
  error?: string;
}

export const DEFAULT_EVAL_FIXTURES: EvalFixture[] = [
  {
    id: "text-summary",
    description: "Text-only answer completes without tools",
    expectedContent: "summary",
    fixture: {
      userMessage: "summarize provider state",
      stream: [
        { type: "text", text: "Provider compatibility summary complete." },
        { type: "done", stopReason: "end_turn" },
      ],
    },
  },
  {
    id: "tool-read",
    description: "Tool call turn completes and resumes with final text",
    expectedTools: ["read_file"],
    expectedContent: "inspected",
    fixture: {
      userMessage: "inspect package",
      turns: [
        [
          { type: "tool_use_start", toolCall: { id: "call_1", name: "read_file" } },
          {
            type: "tool_use_end",
            toolCall: { id: "call_1", name: "read_file", input: { path: "package.json" } },
          },
          { type: "done", stopReason: "tool_use" },
        ],
        [
          { type: "text", text: "package.json inspected successfully." },
          { type: "done", stopReason: "end_turn" },
        ],
      ],
      toolOutputs: {
        read_file: { success: true, output: '{"name":"fixture"}' },
      },
    },
  },
  {
    id: "tool-failure",
    description: "Tool failure is classified without aborting the session",
    expectedTools: ["read_file"],
    expectedContent: "cannot read",
    fixture: {
      userMessage: "inspect missing file",
      turns: [
        [
          { type: "tool_use_start", toolCall: { id: "call_1", name: "read_file" } },
          {
            type: "tool_use_end",
            toolCall: { id: "call_1", name: "read_file", input: { path: "missing.ts" } },
          },
          { type: "done", stopReason: "tool_use" },
        ],
        [
          { type: "text", text: "I cannot read missing.ts; the tool reported an error." },
          { type: "done", stopReason: "end_turn" },
        ],
      ],
      toolOutputs: {
        read_file: { success: false, output: "file not found" },
      },
    },
  },
];

export async function runEvalFixture(evalFixture: EvalFixture): Promise<EvalRunResult> {
  const start = performance.now();
  try {
    const replay = await runReplayFixture(evalFixture.fixture);
    const contentOk = evalFixture.expectedContent
      ? replay.result.content.toLowerCase().includes(evalFixture.expectedContent.toLowerCase())
      : true;
    const toolsOk = evalFixture.expectedTools
      ? evalFixture.expectedTools.every((tool) =>
          replay.result.toolCalls.some((toolCall) => toolCall.name === tool),
        )
      : true;
    const passed = !replay.result.aborted && contentOk && toolsOk;

    return {
      id: evalFixture.id,
      description: evalFixture.description,
      passed,
      duration: performance.now() - start,
      inputTokens: replay.result.usage.inputTokens,
      outputTokens: replay.result.usage.outputTokens,
      error: passed ? undefined : (replay.result.error ?? "Expectation failed"),
    };
  } catch (error) {
    return {
      id: evalFixture.id,
      description: evalFixture.description,
      passed: false,
      duration: performance.now() - start,
      inputTokens: 0,
      outputTokens: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runDefaultEvals(): Promise<EvalRunResult[]> {
  const results: EvalRunResult[] = [];
  for (const fixture of DEFAULT_EVAL_FIXTURES) {
    results.push(await runEvalFixture(fixture));
  }
  return results;
}

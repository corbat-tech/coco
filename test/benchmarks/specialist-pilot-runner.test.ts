import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatWithToolsResponse, LLMProvider } from "../../src/providers/types.js";
import { runCocoPilotCampaign, type CocoPilotCampaignOptions } from "./specialist-pilot-runner.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const terminal: ChatWithToolsResponse = {
  id: "terminal",
  model: "scripted-fixture",
  content: "Fixed the lower clamp bound and observed public tests.",
  toolCalls: [],
  stopReason: "end_turn",
  usage: { inputTokens: 3, outputTokens: 2 },
};

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "coco-pilot-runner-"));
  temporary.push(directory);
  const initialize = vi.fn();
  const chat = vi.fn<LLMProvider["chatWithTools"]>();
  const stream = vi.fn<LLMProvider["streamWithTools"]>();
  const provider = {
    id: "fixture",
    name: "scripted",
    initialize,
    chatWithTools: chat,
    streamWithTools: stream,
    countTokens: (text: string) => Math.ceil(text.length / 4),
    getContextWindow: () => 200000,
  } as unknown as LLMProvider;
  const options: CocoPilotCampaignOptions = {
    provider,
    model: "scripted-fixture",
    thinking: "high",
    commit: "fixture-only-no-live-score",
    outputDirectory: path.join(directory, "evidence"),
    maxRuns: 1,
    repetitions: 1,
    timeoutMs: 5000,
    maxTurns: 6,
    maxTokens: 1024,
    split: "development",
    approvedConsumption: true,
    caseIds: ["local-clamp"],
    configurations: ["manual"],
  };
  return { options, provider, initialize, chat, stream };
}

describe("approved Coco coding pilot entry point", () => {
  it("requires explicit consumption approval before any provider operation", async () => {
    const f = await fixture();
    await expect(
      runCocoPilotCampaign({ ...f.options, approvedConsumption: false }),
    ).rejects.toThrow("approval");
    expect(f.chat).not.toHaveBeenCalled();
    expect(f.stream).not.toHaveBeenCalled();
    expect(f.initialize).not.toHaveBeenCalled();
  });

  it("runs a real frozen coding case through Coco tools, public Node tests and external acceptance", async () => {
    const f = await fixture();
    const fixed = await readFile(
      fileURLToPath(
        new URL(
          "../fixtures/delegation/projects/_solutions/local-clamp/src/clamp.mjs",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const call = (
      id: string,
      name: string,
      input: Record<string, unknown>,
    ): ChatWithToolsResponse => ({
      ...terminal,
      id,
      content: "",
      stopReason: "tool_use",
      toolCalls: [{ id, name, input }],
    });
    f.chat
      .mockResolvedValueOnce(call("read", "read_file", { path: "src/clamp.mjs" }))
      .mockResolvedValueOnce(call("write", "write_file", { path: "src/clamp.mjs", content: fixed }))
      .mockResolvedValueOnce(call("public-tests", "run_tests", {}))
      .mockImplementationOnce(async (messages) => {
        expect(JSON.stringify(messages)).toContain("TAP version 13");
        return terminal;
      });
    const report = await runCocoPilotCampaign(f.options);
    expect(report.attemptedRuns).toBe(1);
    expect(report.outcomes[0]?.status).toBe("accepted");
    expect(report.outcomes[0]?.checks).toEqual({
      processSucceeded: true,
      externalAndPublicTestsExecuted: true,
      allObservedTestsPassed: true,
    });
    expect(await readFile(path.join(report.outcomes[0]!.workspace, "src/clamp.mjs"), "utf8")).toBe(
      fixed,
    );
    expect(f.chat).toHaveBeenCalledTimes(4);
    expect(f.stream).not.toHaveBeenCalled();
    expect(f.initialize).not.toHaveBeenCalled();
    const manifest = JSON.parse(
      await readFile(path.join(f.options.outputDirectory, "manifest.json"), "utf8"),
    );
    expect(manifest.identity.requestLimits).toEqual({
      maxTurns: 6,
      requestedMaxOutputTokens: 1024,
    });
    expect(manifest.identity.toolPolicySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.identity.promptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.cases).toHaveLength(1);
  });

  it("rejects out-of-split cases and insufficient paired budget before calls", async () => {
    const f = await fixture();
    await expect(runCocoPilotCampaign({ ...f.options, split: "reserved" })).rejects.toThrow(
      "outside",
    );
    await expect(
      runCocoPilotCampaign({ ...f.options, configurations: ["direct", "manual", "auto"] }),
    ).rejects.toThrow("paired campaign");
    expect(f.chat).not.toHaveBeenCalled();
    expect(f.stream).not.toHaveBeenCalled();
  });
});

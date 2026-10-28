import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatWithToolsResponse, LLMProvider, StreamChunk } from "../../src/providers/types.js";
import {
  createCocoEvaluationAdapter,
  COCO_EVALUATION_ARTIFACT_DIRECTORY,
} from "./specialist-coco-adapter.js";
import { hashSpecialistFixture, runSpecialistEvaluation } from "./specialist-evaluation.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

const terminal: ChatWithToolsResponse = {
  id: "terminal",
  model: "fixture-model",
  content: "Changed answer.txt and observed public tests.",
  stopReason: "end_turn",
  toolCalls: [],
  usage: { inputTokens: 3, outputTokens: 2 },
};
function providerFixture() {
  const initialize = vi.fn();
  const chat = vi
    .fn<LLMProvider["chatWithTools"]>()
    .mockResolvedValueOnce({
      ...terminal,
      stopReason: "tool_use",
      content: "",
      toolCalls: [
        { id: "write", name: "write_file", input: { path: "src/answer.txt", content: "42" } },
      ],
    })
    .mockResolvedValueOnce({
      ...terminal,
      stopReason: "tool_use",
      content: "",
      toolCalls: [{ id: "tests", name: "run_tests", input: {} }],
    })
    .mockResolvedValue(terminal);
  const stream = vi.fn<LLMProvider["streamWithTools"]>();
  const provider = {
    id: "fixture",
    name: "fixture",
    initialize,
    chatWithTools: chat,
    streamWithTools: stream,
    countTokens: (text: string) => Math.ceil(text.length / 4),
    getContextWindow: () => 200000,
  } as unknown as LLMProvider;
  return { provider, initialize, chat, stream };
}
async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), "coco-injected-adapter-"));
  temporary.push(root);
  const fixture = path.join(root, "fixture");
  await mkdir(path.join(fixture, "src"), { recursive: true });
  await writeFile(path.join(fixture, "public.test.mjs"), "export const immutable = true;\n");
  await writeFile(path.join(fixture, "src/answer.txt"), "0");
  return { root, fixture };
}

describe("Coco evaluation adapter with an injected provider", () => {
  it("uses actual Coco worker tools and host public tests through the reusable harness", async () => {
    const { root, fixture } = await workspace();
    const f = providerFixture();
    const publicTests = vi.fn(async (directory: string, signal: AbortSignal) => {
      signal.throwIfAborted();
      return {
        success: (await readFile(path.join(directory, "src/answer.txt"), "utf8")) === "42",
        output: "public assertion: answer equals42",
      };
    });
    const adapter = createCocoEvaluationAdapter({
      provider: f.provider,
      model: "fixture-model",
      thinking: "high",
      maxTurns: 6,
      maxTokens: 512,
      executePublicTests: publicTests,
    });
    expect(f.initialize).not.toHaveBeenCalled();
    expect(f.chat).not.toHaveBeenCalled();
    const report = await runSpecialistEvaluation({
      cases: [
        {
          id: "real-coco-path",
          snapshotId: "fixture-v1",
          fixtureDirectory: fixture,
          expectedFixtureSha256: await hashSpecialistFixture(fixture),
          acceptanceId: "answer42-v1",
          task: "Write 42 to answer.txt and run public tests",
        },
      ],
      configurations: ["manual"],
      repetitions: 1,
      maxRuns: 1,
      timeoutMs: 5000,
      outputDirectory: path.join(root, "evidence"),
      identity: {
        commit: "fixture",
        model: "fixture-model",
        effort: "high",
        adapterVersion: "injected-v1",
        toolPolicySha256: "fixture-policy",
        promptSha256: "fixture-prompt",
      },
      runCase: adapter,
      check: async ({ workspace: directory }) => ({
        fileEquals42: (await readFile(path.join(directory, "src/answer.txt"), "utf8")) === "42",
      }),
    });
    expect(report.outcomes[0]?.status).toBe("accepted");
    expect(report.outcomes[0]?.usage).toEqual({ inputTokens: 9, outputTokens: 6 });
    expect(publicTests).toHaveBeenCalledOnce();
    expect(f.chat).toHaveBeenCalledTimes(3);
    expect(f.chat.mock.calls[0]?.[1]).toMatchObject({
      model: "fixture-model",
      thinking: "high",
      maxTokens: 512,
    });
    expect(f.chat.mock.calls[0]?.[1].tools.map((tool) => tool.name)).not.toContain("bash_exec");
    expect(f.initialize).not.toHaveBeenCalled();
    expect(await readFile(path.join(fixture, "src/answer.txt"), "utf8")).toBe("0");
    const artifacts = path.join(report.outcomes[0]!.workspace, COCO_EVALUATION_ARTIFACT_DIRECTORY);
    expect(await readFile(path.join(artifacts, "answer.txt"), "utf8")).toContain(
      "Changed answer.txt",
    );
    expect(await readFile(path.join(artifacts, "trace.json"), "utf8")).toContain(
      "provider.request",
    );
  });

  it("reports streaming usage as unknown and still changes the actual scoped file", async () => {
    const { fixture } = await workspace();
    const f = providerFixture();
    f.stream
      .mockImplementationOnce(async function* (): AsyncIterable<StreamChunk> {
        yield {
          type: "tool_use_end",
          toolCall: {
            id: "write",
            name: "write_file",
            input: { path: "src/answer.txt", content: "42" },
          },
        };
        yield { type: "done", stopReason: "tool_use" };
      })
      .mockImplementation(async function* (): AsyncIterable<StreamChunk> {
        yield { type: "text", text: "Changed the requested file" };
        yield { type: "done", stopReason: "end_turn" };
      });
    const adapter = createCocoEvaluationAdapter({
      provider: f.provider,
      model: "fixture-model",
      maxTurns: 4,
      maxTokens: 512,
      executePublicTests: async () => ({ success: true, output: "No tests requested" }),
    });
    const result = await adapter({
      caseId: "stream",
      configuration: "direct",
      repetition: 0,
      workspace: fixture,
      task: "Write42 to answer.txt",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("completed");
    expect(result.usage).toBeUndefined();
    expect(await readFile(path.join(fixture, "src/answer.txt"), "utf8")).toBe("42");
    expect(f.chat).not.toHaveBeenCalled();
    expect(f.initialize).not.toHaveBeenCalled();
  });

  it("denies paths outside the workspace and host-owned evidence", async () => {
    const { root, fixture } = await workspace();
    await writeFile(path.join(root, "outside.txt"), "unchanged");
    const f = providerFixture();
    f.chat
      .mockReset()
      .mockResolvedValueOnce({
        ...terminal,
        stopReason: "tool_use",
        content: "",
        toolCalls: [
          { id: "outside", name: "write_file", input: { path: "../outside.txt", content: "bad" } },
          {
            id: "evidence",
            name: "write_file",
            input: { path: `${COCO_EVALUATION_ARTIFACT_DIRECTORY}/injected.txt`, content: "bad" },
          },
        ],
      })
      .mockResolvedValue(terminal);
    const adapter = createCocoEvaluationAdapter({
      provider: f.provider,
      model: "fixture-model",
      maxTurns: 4,
      maxTokens: 512,
      executePublicTests: async () => ({ success: true, output: "Unused" }),
    });
    await adapter({
      caseId: "scope",
      configuration: "manual",
      repetition: 0,
      workspace: fixture,
      task: "Test scope restrictions",
      signal: new AbortController().signal,
    });
    expect(await readFile(path.join(root, "outside.txt"), "utf8")).toBe("unchanged");
    await expect(
      readFile(path.join(fixture, COCO_EVALUATION_ARTIFACT_DIRECTORY, "injected.txt")),
    ).rejects.toThrow();
  });

  it("does not dispatch or initialize a provider for a pre-cancelled attempt", async () => {
    const { fixture } = await workspace();
    const f = providerFixture();
    const controller = new AbortController();
    controller.abort(new Error("Host stopped campaign"));
    const adapter = createCocoEvaluationAdapter({
      provider: f.provider,
      model: "fixture-model",
      maxTurns: 2,
      maxTokens: 512,
      executePublicTests: async () => ({ success: true, output: "Unused" }),
    });
    await expect(
      adapter({
        caseId: "cancel",
        configuration: "auto",
        repetition: 0,
        workspace: fixture,
        task: "Do work",
        signal: controller.signal,
      }),
    ).rejects.toThrow("Host stopped campaign");
    expect(f.chat).not.toHaveBeenCalled();
    expect(f.stream).not.toHaveBeenCalled();
    expect(f.initialize).not.toHaveBeenCalled();
  });

  it("does not traverse symlinked directories or list host evidence during glob discovery", async () => {
    const { root, fixture } = await workspace();
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "outside content");
    await symlink(outside, path.join(fixture, "external"));
    const f = providerFixture();
    f.chat
      .mockReset()
      .mockResolvedValueOnce({
        ...terminal,
        content: "",
        stopReason: "tool_use",
        toolCalls: [{ id: "glob", name: "glob", input: { pattern: "**/*.txt" } }],
      })
      .mockResolvedValue(terminal);
    const adapter = createCocoEvaluationAdapter({
      provider: f.provider,
      model: "fixture-model",
      maxTurns: 3,
      maxTokens: 512,
      executePublicTests: async () => ({ success: true, output: "Unused" }),
    });
    await adapter({
      caseId: "glob",
      configuration: "manual",
      repetition: 0,
      workspace: fixture,
      task: "Discover text files in the workspace",
      signal: new AbortController().signal,
    });
    const returnedEvidence = JSON.stringify(f.chat.mock.calls[1]?.[0]);
    expect(returnedEvidence).toContain("answer.txt");
    expect(returnedEvidence).not.toContain("secret.txt");
    expect(returnedEvidence).not.toContain("runtime.json");
  });

  it("keeps public tests, package manifests and non-source files immutable", async () => {
    const { fixture } = await workspace();
    await symlink(path.join(fixture, "public.test.mjs"), path.join(fixture, "src", "alias.mjs"));
    const f = providerFixture();
    f.chat
      .mockReset()
      .mockResolvedValueOnce({
        ...terminal,
        stopReason: "tool_use",
        content: "",
        toolCalls: [
          {
            id: "public-write",
            name: "write_file",
            input: { path: "public.test.mjs", content: "fake tests" },
          },
          {
            id: "public-edit",
            name: "edit_file",
            input: { path: "public.test.mjs", oldText: "true", newText: "false" },
          },
          {
            id: "alias",
            name: "write_file",
            input: { path: "src/alias.mjs", content: "fake tests" },
          },
          { id: "manifest", name: "write_file", input: { path: "package.json", content: "{}" } },
          { id: "docs", name: "write_file", input: { path: "README.md", content: "unassigned" } },
        ],
      })
      .mockResolvedValue(terminal);
    const adapter = createCocoEvaluationAdapter({
      provider: f.provider,
      model: "fixture-model",
      maxTurns: 3,
      maxTokens: 512,
      executePublicTests: async () => ({ success: true, output: "Unused" }),
    });
    await adapter({
      caseId: "immutable",
      configuration: "manual",
      repetition: 0,
      workspace: fixture,
      task: "Exercise immutable fixture boundaries",
      signal: new AbortController().signal,
    });
    expect(await readFile(path.join(fixture, "public.test.mjs"), "utf8")).toBe(
      "export const immutable = true;\n",
    );
    await expect(readFile(path.join(fixture, "package.json"))).rejects.toThrow();
    await expect(readFile(path.join(fixture, "README.md"))).rejects.toThrow();
  });

  it("honors exact solution files selected by the host and rejects other source writes", async () => {
    const { fixture } = await workspace();
    const f = providerFixture();
    f.chat
      .mockReset()
      .mockResolvedValueOnce({
        ...terminal,
        stopReason: "tool_use",
        content: "",
        toolCalls: [
          { id: "assigned", name: "write_file", input: { path: "lib/answer.txt", content: "42" } },
          {
            id: "unassigned",
            name: "write_file",
            input: { path: "src/answer.txt", content: "bad" },
          },
        ],
      })
      .mockResolvedValue(terminal);
    const adapter = createCocoEvaluationAdapter({
      provider: f.provider,
      model: "fixture-model",
      maxTurns: 3,
      maxTokens: 512,
      writablePaths: ["lib/answer.txt"],
      executePublicTests: async () => ({ success: true, output: "Unused" }),
    });
    await adapter({
      caseId: "allowlist",
      configuration: "manual",
      repetition: 0,
      workspace: fixture,
      task: "Exercise host solution scope",
      signal: new AbortController().signal,
    });
    expect(await readFile(path.join(fixture, "lib/answer.txt"), "utf8")).toBe("42");
    expect(await readFile(path.join(fixture, "src/answer.txt"), "utf8")).toBe("0");
  });

  it("bounds public test output before returning it to the model", async () => {
    const { fixture } = await workspace();
    const f = providerFixture();
    const adapter = createCocoEvaluationAdapter({
      provider: f.provider,
      model: "fixture-model",
      maxTurns: 4,
      maxTokens: 512,
      executePublicTests: async () => ({ success: true, output: "x".repeat(20000) }),
    });
    await adapter({
      caseId: "output",
      configuration: "manual",
      repetition: 0,
      workspace: fixture,
      task: "Write source and run tests",
      signal: new AbortController().signal,
    });
    const lastMessages = JSON.stringify(f.chat.mock.calls[2]?.[0]);
    expect(lastMessages).toContain("public test output truncated");
    expect(lastMessages.length).toBeLessThan(12000);
  });
});

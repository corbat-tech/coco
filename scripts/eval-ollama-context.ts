/** Local inference evaluation of source compaction; run in the isolated evaluation mirror. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { ContextCompactor } from "../src/cli/repl/context/compactor.js";
import { createProvider } from "../src/providers/index.js";
import type { Message } from "../src/providers/types.js";

const [model = "qwen3.5:4b", output] = process.argv.slice(2);
if (!output) throw new Error("Usage: eval-ollama-context.ts <installed-local-model> <output.json>");
const tags = await fetch("http://127.0.0.1:11434/api/tags").then((r) => r.json());
const installed = tags.models.find((m: { name: string }) => m.name === model);
assert.ok(installed, "No model download or cloud fallback allowed");
const provider = await createProvider("ollama", {
  apiKey: "ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  model,
  timeout: 120000,
});
const originalChat = provider.chat.bind(provider);
let calls = 0;
const usage = { inputTokens: 0, outputTokens: 0 };
provider.chat = async (messages, options) => {
  calls++;
  const response = await originalChat(messages, { ...options, thinking: "off" });
  usage.inputTokens += response.usage.inputTokens;
  usage.outputTokens += response.usage.outputTokens;
  return response;
};
const constraints = [
  "Preserve the public summarize API and USER_NOTE.txt. No dependencies, network, installs or deployment.",
  "Correction: keep zero values. Negative inputs are supported. Integration tests are still NOT RUN.",
];
const history: Message[] = [{ role: "user", content: constraints[0]! }];
for (let i = 0; i < 24; i++) {
  history.push({
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: `read-${i}`,
        name: "read_file",
        input: { path: `src/module-${i}.ts` },
      },
    ],
  });
  history.push({
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: `read-${i}`,
        content:
          `Inspected module ${i}. ` +
          "The implementation accumulates amount and count; the public export must stay compatible. ".repeat(
            8,
          ),
      },
    ],
  });
  if (i === 8) history.push({ role: "user", content: constraints[1]! });
}
history.push({
  role: "assistant",
  content: "Read-only inspection completed. No integration tests have been executed.",
});
const before = JSON.stringify(history);
const started = performance.now();
const report: Record<string, unknown> = {
  model,
  digest: installed.digest,
  scope:
    "source compactor, 24 synthetic tool pairs, two real summaries and cancellation; not an autonomous long coding task",
};
try {
  const first = await new ContextCompactor({ preserveLastN: 4, summaryMaxTokens: 1400 }).compact(
    history,
    provider,
    { signal: AbortSignal.timeout(180000) },
  );
  assert.equal(JSON.stringify(history), before, "Original history must not mutate");
  assert.equal(first.wasCompacted, true, first.failureReason);
  for (const constraint of constraints)
    assert.ok(JSON.stringify(first.messages).includes(constraint));
  assert.deepEqual(first.messages.slice(-4), history.slice(-4));
  const extended: Message[] = [
    ...first.messages,
    { role: "assistant", content: "Further inspection: ".repeat(1800) },
    { role: "user", content: "Continue respecting all previous constraints." },
    { role: "assistant", content: "Awaiting verification." },
  ];
  const second = await new ContextCompactor({ preserveLastN: 2, summaryMaxTokens: 1400 }).compact(
    extended,
    provider,
    { signal: AbortSignal.timeout(180000) },
  );
  assert.equal(second.wasCompacted, true, second.failureReason);
  for (const constraint of constraints)
    assert.ok(JSON.stringify(second.messages).includes(constraint));
  const abort = new AbortController();
  const timer = setTimeout(
    () => abort.abort(new DOMException("Evaluation cancellation", "AbortError")),
    25,
  );
  try {
    await assert.rejects(new ContextCompactor().compact(history, provider, abort.signal));
  } finally {
    clearTimeout(timer);
  }
  assert.equal(JSON.stringify(history), before);
  Object.assign(report, {
    passed: true,
    first: { before: first.originalTokens, after: first.compactedTokens },
    second: { before: second.originalTokens, after: second.compactedTokens },
    cancellationPreservedHistory: true,
    summaries: [first.messages[0], second.messages[0]],
  });
} catch (error) {
  Object.assign(report, {
    passed: false,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
} finally {
  Object.assign(report, { calls, usage, seconds: (performance.now() - started) / 1000 });
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}

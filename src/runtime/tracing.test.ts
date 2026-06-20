import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  collectRuntimeMetrics,
  eventToSpan,
  exportRuntimeEventsAsSpans,
  FileTraceExporter,
  InMemoryTraceExporter,
  OpenTelemetryTraceExporter,
  redactTraceAttributes,
} from "./tracing.js";
import type { RuntimeEvent } from "./types.js";

function event(
  type: RuntimeEvent["type"],
  data: Record<string, unknown>,
  timestamp = "2026-06-20T12:00:00.000Z",
): RuntimeEvent {
  return {
    id: `evt-${type}`,
    type,
    timestamp,
    data,
  };
}

describe("runtime tracing", () => {
  it("normalizes runtime events into redacted spans with parent-child correlation", async () => {
    const events = [
      event("workflow.started", {
        trace: { traceId: "trace-1", spanId: "workflow", workflowRunId: "wf-1" },
        tenantId: "tenant-a",
      }),
      event("agent.started", {
        trace: {
          traceId: "trace-1",
          spanId: "agent",
          parentSpanId: "workflow",
          workflowRunId: "wf-1",
        },
        prompt: "Bearer abcdefghijklmnopqrstuvwxyz",
        tenantId: "tenant-a",
      }),
    ];
    const exporter = new InMemoryTraceExporter();

    const spans = await exportRuntimeEventsAsSpans(events, exporter);

    expect(spans).toMatchObject([
      { traceId: "trace-1", spanId: "workflow", kind: "workflow", name: "workflow.started" },
      {
        traceId: "trace-1",
        spanId: "agent",
        parentSpanId: "workflow",
        kind: "agent",
        name: "agent.started",
      },
    ]);
    expect(exporter.list()[1]?.attributes["prompt"]).toBe("[REDACTED]");
  });

  it("collects tenant-level usage, policy blocks, gates, tools, tokens, and cost metrics", () => {
    const metrics = collectRuntimeMetrics([
      event("turn.completed", {
        tenantId: "tenant-a",
        inputTokens: 10,
        outputTokens: 5,
        estimatedCostUsd: 0.02,
      }),
      event("tool.blocked", {
        tenantId: "tenant-a",
        tool: "write_file",
        runtimePolicyBlocked: true,
      }),
      event("workflow.gate.failed", { tenantId: "tenant-a", gateId: "security" }),
      event("agent.failed", { tenantId: "tenant-a", error: "capability denied", attempt: 2 }),
    ]);

    expect(metrics).toMatchObject({
      events: 4,
      tokens: { input: 10, output: 5 },
      estimatedCostUsd: 0.02,
      retries: 1,
      policyBlocks: 1,
      gatesFailed: 1,
      toolsUsed: { write_file: 1 },
      errorsByClass: { "capability denied": 1 },
      tenantUsage: {
        "tenant-a": {
          events: 4,
          inputTokens: 10,
          outputTokens: 5,
          estimatedCostUsd: 0.02,
        },
      },
    });
  });

  it("exports spans to file and OpenTelemetry-compatible JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coco-traces-"));
    const filePath = join(dir, "trace.jsonl");
    const fileExporter = new FileTraceExporter(filePath);
    const otelExporter = new OpenTelemetryTraceExporter();
    const span = eventToSpan(
      event("tool.completed", {
        trace: { traceId: "trace-1", spanId: "tool-1", parentSpanId: "agent-1" },
        tool: "read_file",
      }),
    );

    await fileExporter.export(span);
    await otelExporter.export(span);

    expect(JSON.parse((await readFile(filePath, "utf-8")).trim())).toMatchObject({
      traceId: "trace-1",
      spanId: "tool-1",
      parentSpanId: "agent-1",
      kind: "tool",
    });
    expect(otelExporter.toOtlpJson()).toMatchObject({
      resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: "trace-1", spanId: "tool-1" }] }] }],
    });
  });

  it("redacts nested trace attributes before export", () => {
    expect(
      redactTraceAttributes({
        nested: {
          token: "ghp_abcdefghijklmnopqrstuvwxyz123456",
        },
      }),
    ).toEqual({
      nested: {
        token: "[REDACTED]",
      },
    });
  });
});

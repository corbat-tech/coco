import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { redactSecrets } from "./guardrails.js";
import type { RuntimeEvent } from "./types.js";

export type RuntimeSpanKind =
  | "workflow"
  | "agent"
  | "llm"
  | "tool"
  | "rag"
  | "gate"
  | "handoff"
  | "state"
  | "runtime";

export interface RuntimeSpan {
  id: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  kind: RuntimeSpanKind;
  name: string;
  timestamp: string;
  attributes: Record<string, unknown>;
}

export interface RuntimeTraceExporter {
  export(span: RuntimeSpan): Promise<void>;
  flush?(): Promise<void>;
}

export interface RuntimeMetricsSnapshot {
  events: number;
  byKind: Record<RuntimeSpanKind, number>;
  tokens: {
    input: number;
    output: number;
  };
  estimatedCostUsd: number;
  retries: number;
  policyBlocks: number;
  errorsByClass: Record<string, number>;
  toolsUsed: Record<string, number>;
  gatesFailed: number;
  tenantUsage: Record<
    string,
    {
      events: number;
      inputTokens: number;
      outputTokens: number;
      estimatedCostUsd: number;
    }
  >;
}

export class InMemoryTraceExporter implements RuntimeTraceExporter {
  private spans: RuntimeSpan[] = [];

  async export(span: RuntimeSpan): Promise<void> {
    this.spans.push(structuredClone(span));
  }

  list(): RuntimeSpan[] {
    return this.spans.map((span) => structuredClone(span));
  }

  clear(): void {
    this.spans = [];
  }
}

export class FileTraceExporter implements RuntimeTraceExporter {
  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  async export(span: RuntimeSpan): Promise<void> {
    appendFileSync(this.filePath, JSON.stringify(span) + "\n", "utf-8");
  }

  list(): RuntimeSpan[] {
    try {
      return readFileSync(this.filePath, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RuntimeSpan);
    } catch {
      return [];
    }
  }

  clear(): void {
    writeFileSync(this.filePath, "", "utf-8");
  }
}

export class OpenTelemetryTraceExporter implements RuntimeTraceExporter {
  private spans: RuntimeSpan[] = [];

  async export(span: RuntimeSpan): Promise<void> {
    this.spans.push(structuredClone(span));
  }

  toOtlpJson(): Record<string, unknown> {
    return {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: this.spans.map((span) => ({
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
                name: span.name,
                kind: span.kind,
                startTimeUnixNano: Date.parse(span.timestamp) * 1_000_000,
                endTimeUnixNano: Date.parse(span.timestamp) * 1_000_000,
                attributes: Object.entries(span.attributes).map(([key, value]) => ({
                  key,
                  value: { stringValue: JSON.stringify(value) },
                })),
              })),
            },
          ],
        },
      ],
    };
  }
}

export async function exportRuntimeEventsAsSpans(
  events: RuntimeEvent[],
  exporter: RuntimeTraceExporter,
): Promise<RuntimeSpan[]> {
  const spans = events.map(eventToSpan);
  for (const span of spans) {
    await exporter.export(span);
  }
  await exporter.flush?.();
  return spans;
}

export function eventToSpan(event: RuntimeEvent): RuntimeSpan {
  const trace = isRecord(event.data["trace"]) ? event.data["trace"] : {};
  const traceId = stringValue(trace["traceId"]) ?? stringValue(event.data["traceId"]) ?? event.id;
  const spanId = stringValue(trace["spanId"]) ?? stringValue(event.data["spanId"]) ?? event.id;
  return {
    id: event.id,
    traceId,
    spanId,
    parentSpanId: stringValue(trace["parentSpanId"]) ?? stringValue(event.data["parentSpanId"]),
    kind: inferSpanKind(event),
    name: event.type,
    timestamp: event.timestamp,
    attributes: redactTraceAttributes(event.data),
  };
}

export function collectRuntimeMetrics(events: RuntimeEvent[]): RuntimeMetricsSnapshot {
  const snapshot: RuntimeMetricsSnapshot = {
    events: events.length,
    byKind: {
      workflow: 0,
      agent: 0,
      llm: 0,
      tool: 0,
      rag: 0,
      gate: 0,
      handoff: 0,
      state: 0,
      runtime: 0,
    },
    tokens: { input: 0, output: 0 },
    estimatedCostUsd: 0,
    retries: 0,
    policyBlocks: 0,
    errorsByClass: {},
    toolsUsed: {},
    gatesFailed: 0,
    tenantUsage: {},
  };

  for (const event of events) {
    const kind = inferSpanKind(event);
    snapshot.byKind[kind] += 1;
    const inputTokens = numberValue(event.data["inputTokens"]);
    const outputTokens = numberValue(event.data["outputTokens"]);
    const estimatedCostUsd = numberValue(event.data["estimatedCostUsd"]);
    snapshot.tokens.input += inputTokens;
    snapshot.tokens.output += outputTokens;
    snapshot.estimatedCostUsd += estimatedCostUsd;
    if (event.data["attempt"] && numberValue(event.data["attempt"]) > 1) snapshot.retries += 1;
    if (event.type === "tool.blocked" || event.data["runtimePolicyBlocked"] === true) {
      snapshot.policyBlocks += 1;
    }
    if (event.type.endsWith(".failed") || event.type === "error") {
      const key = stringValue(event.data["error"]) ?? event.type;
      snapshot.errorsByClass[key] = (snapshot.errorsByClass[key] ?? 0) + 1;
    }
    const tool = stringValue(event.data["tool"]) ?? stringValue(event.data["toolName"]);
    if (tool) snapshot.toolsUsed[tool] = (snapshot.toolsUsed[tool] ?? 0) + 1;
    if (event.type === "workflow.gate.failed") snapshot.gatesFailed += 1;

    const tenantId = stringValue(event.data["tenantId"]);
    if (tenantId) {
      snapshot.tenantUsage[tenantId] ??= {
        events: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
      };
      snapshot.tenantUsage[tenantId].events += 1;
      snapshot.tenantUsage[tenantId].inputTokens += inputTokens;
      snapshot.tenantUsage[tenantId].outputTokens += outputTokens;
      snapshot.tenantUsage[tenantId].estimatedCostUsd += estimatedCostUsd;
    }
  }

  return snapshot;
}

export function redactTraceAttributes(input: Record<string, unknown>): Record<string, unknown> {
  return redactUnknown(input) as Record<string, unknown>;
}

function inferSpanKind(event: RuntimeEvent): RuntimeSpanKind {
  if (event.type.startsWith("workflow.gate")) return "gate";
  if (event.type.startsWith("workflow.")) return "workflow";
  if (event.type.startsWith("agent.handoff")) return "handoff";
  if (event.type.startsWith("agent.")) return "agent";
  if (event.type.startsWith("tool.") || event.type === "agent.tool.called") return "tool";
  if (event.type.startsWith("shared_state.") || event.type.startsWith("checkpoint.")) {
    return "state";
  }
  if (event.type.startsWith("turn.")) return "llm";
  return "runtime";
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value, { enabled: true }).content;
  }
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, redactUnknown(nested)]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

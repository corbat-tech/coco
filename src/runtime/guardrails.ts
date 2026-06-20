import { z } from "zod";

export type GuardrailSeverity = "info" | "warning" | "blocked";
export type GuardrailStage =
  | "input"
  | "retrieved-document"
  | "tool-input"
  | "tool-output"
  | "final-output"
  | "output"
  | "tool";
export type GuardrailAction = "allow" | "warn" | "block";

export interface GuardrailFinding {
  id: string;
  stage: GuardrailStage;
  severity: GuardrailSeverity;
  message: string;
  redacted?: boolean;
}

export interface GuardrailResult {
  allowed: boolean;
  content: string;
  findings: GuardrailFinding[];
}

export interface SecretRedactionConfig {
  enabled: boolean;
  replacement?: string;
}

export interface TopicBoundaryConfig {
  allowedTopics?: string[];
  blockedTopics?: string[];
}

export interface GuardrailConfig {
  maxInputChars?: number;
  maxOutputChars?: number;
  secretRedaction?: SecretRedactionConfig;
  promptInjectionDetection?: boolean;
  promptInjectionAction?: GuardrailAction;
  topicBoundary?: TopicBoundaryConfig;
  policyProvider?: PolicyAsCodeProvider;
}

export interface PolicyAsCodeProvider {
  evaluate(input: {
    stage: GuardrailStage;
    content: string;
    findings: GuardrailFinding[];
  }): Promise<GuardrailFinding[]> | GuardrailFinding[];
}

export interface GuardrailPipelineStep {
  stage: GuardrailStage;
  content: string;
  config?: GuardrailConfig;
}

export interface GuardrailPipelineResult {
  allowed: boolean;
  outputs: Array<{ stage: GuardrailStage; content: string }>;
  findings: GuardrailFinding[];
}

const DEFAULT_REDACTION = "[REDACTED]";

const SECRET_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "openai-api-key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { id: "anthropic-api-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { id: "generic-bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi },
  {
    id: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
];

const PROMPT_INJECTION_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  {
    id: "ignore-instructions",
    pattern:
      /\b(ignore|forget|override|bypass)\b.{0,60}\b(instructions|system|developer|policy|guardrail)\b/i,
  },
  {
    id: "reveal-prompt",
    pattern:
      /\b(reveal|print|show|dump)\b.{0,40}\b(system prompt|instructions|developer message)\b/i,
  },
  {
    id: "tool-exfiltration",
    pattern:
      /\b(use|call|run)\b.{0,40}\b(tool|shell|filesystem|git)\b.{0,40}\b(secret|token|key)\b/i,
  },
  {
    id: "agent-privilege-escalation",
    pattern:
      /\b(spawn|delegate|handoff)\b.{0,50}\b(agent|sub.?agent)\b.{0,50}\b(admin|root|full access|unrestricted|destructive)\b/i,
  },
  {
    id: "credential-exfiltration",
    pattern:
      /\b(exfiltrate|copy|send|upload)\b.{0,50}\b(secret|token|api key|credential|private key)\b/i,
  },
];

export const defaultPublicGuardrails: GuardrailConfig = {
  maxInputChars: 4000,
  maxOutputChars: 6000,
  secretRedaction: { enabled: true },
  promptInjectionDetection: true,
};

export function redactSecrets(
  content: string,
  config: SecretRedactionConfig = { enabled: true },
): { content: string; findings: GuardrailFinding[] } {
  if (!config.enabled) return { content, findings: [] };

  let redacted = content;
  const findings: GuardrailFinding[] = [];
  const replacement = config.replacement ?? DEFAULT_REDACTION;

  for (const { id, pattern } of SECRET_PATTERNS) {
    const before = redacted;
    redacted = redacted.replace(pattern, replacement);
    if (before !== redacted) {
      findings.push({
        id,
        stage: "input",
        severity: "warning",
        message: `Potential secret redacted: ${id}`,
        redacted: true,
      });
    }
  }

  return { content: redacted, findings };
}

export function runGuardrails(
  stage: GuardrailStage,
  content: string,
  config: GuardrailConfig = {},
): GuardrailResult {
  const findings: GuardrailFinding[] = [];
  const maxChars = stage === "input" ? config.maxInputChars : config.maxOutputChars;
  let checked = content;

  if (typeof maxChars === "number" && checked.length > maxChars) {
    findings.push({
      id: `${stage}-too-long`,
      stage,
      severity: "blocked",
      message: `${stage} exceeds ${maxChars} characters.`,
    });
  }

  const redaction = redactSecrets(checked, config.secretRedaction);
  checked = redaction.content;
  findings.push(...redaction.findings.map((finding) => ({ ...finding, stage })));

  if (config.promptInjectionDetection) {
    for (const { id, pattern } of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(checked)) {
        findings.push({
          id,
          stage,
          severity: actionToSeverity(config.promptInjectionAction ?? "warn"),
          message: `Potential prompt-injection pattern detected: ${id}`,
        });
      }
    }
  }

  const blockedTopics = config.topicBoundary?.blockedTopics ?? [];
  for (const topic of blockedTopics) {
    if (topic && checked.toLowerCase().includes(topic.toLowerCase())) {
      findings.push({
        id: "blocked-topic",
        stage,
        severity: "blocked",
        message: `Content mentions blocked topic: ${topic}`,
      });
    }
  }

  return {
    allowed: !findings.some((finding) => finding.severity === "blocked"),
    content: checked,
    findings,
  };
}

export async function runGuardrailPipeline(
  steps: GuardrailPipelineStep[],
  config: GuardrailConfig = {},
): Promise<GuardrailPipelineResult> {
  const outputs: Array<{ stage: GuardrailStage; content: string }> = [];
  const findings: GuardrailFinding[] = [];

  for (const step of steps) {
    const effectiveConfig = { ...config, ...step.config };
    const result = runGuardrails(step.stage, step.content, effectiveConfig);
    const policyFindings =
      (await effectiveConfig.policyProvider?.evaluate({
        stage: step.stage,
        content: result.content,
        findings: result.findings,
      })) ?? [];
    outputs.push({ stage: step.stage, content: result.content });
    findings.push(...result.findings, ...policyFindings);
  }

  return {
    allowed: !findings.some((finding) => finding.severity === "blocked"),
    outputs,
    findings,
  };
}

export function validateStructuredOutput(
  output: unknown,
  schema: z.ZodTypeAny | undefined,
): GuardrailFinding[] {
  if (!schema) return [];
  const result = schema.safeParse(output);
  if (result.success) return [];
  return [
    {
      id: "invalid-structured-output",
      stage: "output",
      severity: "blocked",
      message: result.error.issues.map((issue) => issue.message).join("; "),
    },
  ];
}

function actionToSeverity(action: GuardrailAction): GuardrailSeverity {
  switch (action) {
    case "allow":
      return "info";
    case "warn":
      return "warning";
    case "block":
      return "blocked";
  }
}

import { resolveAgentProfile } from "./agent-profiles.js";
import type { AgentType } from "./agent-type.js";

export type DelegationMode = "off" | "manual" | "auto";
export type DelegationStrategy = "direct" | "specialist" | "sequential" | "parallel";

export interface DelegationIntent {
  error?: string;
  task: string;
  profile?: AgentType;
  preference?: DelegationMode;
  strategy: DelegationStrategy;
  explicit: boolean;
}

export interface DelegationProposal {
  /** Host-validated decomposition, not a self-reported numerical complexity score. */
  independentTasks: number;
  hasDependencies: boolean;
  resourcesCompatible: boolean;
  acceptanceDefined: boolean;
  budgetAvailable: boolean;
  profile?: AgentType;
}

export interface DelegationDecision {
  strategy: DelegationStrategy;
  profile?: AgentType;
  explicit: boolean;
  reason: string;
}

/** Interpret only the current user message. Never run this on retrieved documents or tool output. */
export function parseDelegationIntent(message: string): DelegationIntent {
  // Quoted/fenced text is data, not an instruction to start workers.
  const text = message
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`|"[^"\n]*"|“[^”\n]*”|(?<![\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gu, "")
    .replace(/^\s*>.*$/gm, "");
  const task = message.trim();
  if (
    /\b(sin (?:(?:sub)?agentes|especialistas)|no (?:uses?|utilices?) (?:sub)?agentes|hazlo (?:tú |tu )?solo|do not (?:use (?:subagents|agents|specialists)|delegate)|don['’]t (?:use (?:subagents|agents|specialists)|delegate)|no (?:subagents|agents|specialists)|without (?:sub)?agents)\b/i.test(
      text,
    )
  ) {
    return { task, preference: "off", strategy: "direct", explicit: true };
  }
  const mention = /(?:^|\s)@([a-z][\w-]*)\b/i.exec(text)?.[1];
  const named =
    /\b(?:agentes?|especialistas?|agents?|specialists?|researchers?|testers?|reviewers?|debuggers?|architects?|implementers?)\b/i.test(
      text,
    );
  const requested =
    /\b(?:usa|utiliza|use|using|con|with|pide|ask|revisi[oó]n independiente|independent review)\b/i.test(
      text,
    );
  const explicit = Boolean(
    mention || (named && requested) || /revisi[oó]n independiente|independent review/i.test(text),
  );
  if (!explicit) return { task, strategy: "direct", explicit: false };
  let profile = mention ? resolveAgentProfile(mention) : undefined;
  if (mention && !profile)
    return { task, explicit: true, strategy: "direct", error: `Unknown specialist: ${mention}` };
  if (!profile) {
    if (/\b(security|seguridad)\b/i.test(text)) profile = "security";
    else if (/\b(review|reviewer|revisa|revisi[oó]n)\b/i.test(text)) profile = "review";
    else if (/\b(architect|arquitecto|arquitectura)\b/i.test(text)) profile = "architect";
    else if (/\b(tester|verificador|pruebas|verify)\b/i.test(text)) profile = "test";
    else if (/\b(implement|implementa|implementer|editor)\b/i.test(text)) profile = "refactor";
    else if (/\b(debug|debugger|corrige|fix)\b/i.test(text)) profile = "debug";
    else profile = "explore";
  }
  const teamRequest =
    !mention &&
    /\b(agentes|agents|especialistas|specialists|(?:two|dos|several|varios|multiple)\s+(?:researchers|reviewers|testers))\b/i.test(
      text,
    );
  const strategy = /\b(parallel|paralelo|concurrently)\b/i.test(text)
    ? "parallel"
    : /\b(sequential(?:ly)?|secuencial(?:mente)?|primero|then|despu[eé]s|before)\b/i.test(text)
      ? "sequential"
      : teamRequest
        ? "direct"
        : "specialist";
  return { task, profile, strategy, explicit: true };
}

/** Conservative admission policy. No extra model request and no implicit permission escalation. */
export function decideDelegation(input: {
  message: string;
  mode?: DelegationMode;
  hostEnabled?: boolean;
  proposal?: DelegationProposal;
}): DelegationDecision {
  const intent = parseDelegationIntent(input.message);
  const direct = (reason: string): DelegationDecision => ({
    strategy: "direct",
    explicit: intent.explicit,
    reason,
  });
  if (intent.error) return direct(intent.error);
  if (input.hostEnabled === false) return direct("Delegation is disabled by the host.");
  if (intent.preference === "off") return direct("The user requested execution without workers.");
  if (input.mode === "off") return direct("Delegation mode is off.");
  if (intent.explicit) {
    // Parallel/sequential requests require an actual validated decomposition, not duplicated prompts.
    if (intent.strategy === "specialist")
      return {
        strategy: "specialist",
        profile: intent.profile,
        explicit: true,
        reason: "The user requested a specialist.",
      };
    if (!input.proposal)
      return direct("A multi-step request needs a validated decomposition before dispatch.");
  } else if ((input.mode ?? "manual") !== "auto")
    return direct("Manual mode requires an explicit request.");
  const proposal = input.proposal;
  if (!proposal) return direct("No validated benefit from delegation has been established.");
  if (
    !Number.isSafeInteger(proposal.independentTasks) ||
    proposal.independentTasks < 1 ||
    !proposal.acceptanceDefined ||
    !proposal.budgetAvailable
  )
    return direct("The proposal lacks bounded tasks, acceptance or budget.");
  if (intent.explicit && intent.strategy === "sequential")
    return {
      strategy: "sequential",
      profile: intent.profile,
      explicit: true,
      reason: "The user explicitly requested sequential execution.",
    };
  if (proposal.hasDependencies)
    return {
      strategy: "sequential",
      profile: proposal.profile,
      explicit: intent.explicit,
      reason: "The validated tasks have ordered dependencies.",
    };
  if (proposal.independentTasks > 1 && proposal.resourcesCompatible)
    return {
      strategy: "parallel",
      profile: proposal.profile,
      explicit: intent.explicit,
      reason: "Independent tasks have compatible resources and a shared budget.",
    };
  return direct("The work does not have independently executable parts.");
}

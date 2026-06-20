import type { AgentRuntime } from "../runtime/agent-runtime.js";
import {
  createBaseBlueprint,
  createSafeToolRegistry,
  type AgentBlueprint,
  type AgentPreset,
  type AgentRuntimeFactoryOptions,
} from "../runtime/blueprints.js";
import { createAgentRuntime, createToolCallingRuntimeTurnRunner } from "../runtime/index.js";
import type { KnowledgeRetriever } from "../runtime/rag.js";
import {
  createCodingToolRegistry,
  createCustomerSupportToolRegistry,
  createNoToolRegistry,
  createRagToolRegistry,
  createInternalOpsToolRegistry,
  createSalesIntakeToolRegistry,
  createSupportRagToolRegistry,
  type HumanEscalationHandler,
  type InternalOpsDraftHandler,
  type SalesLeadSummaryHandler,
  type SupportDraftHandler,
} from "../tools/profiles.js";

export interface BrandPresetConfig {
  brand: string;
  audience?: string;
  extraInstructions?: string;
}

export interface RagPresetConfig extends BrandPresetConfig {
  retriever?: KnowledgeRetriever;
}

export interface SupportRagPresetConfig extends RagPresetConfig {
  supportDraft?: SupportDraftHandler;
  humanEscalation?: HumanEscalationHandler;
}

export interface AppointmentPresetConfig extends BrandPresetConfig {
  businessHours?: string;
}

export interface SalesIntakePresetConfig extends BrandPresetConfig {
  leadSummary?: SalesLeadSummaryHandler;
}

export interface InternalOpsPresetConfig extends BrandPresetConfig {
  opsDraft?: InternalOpsDraftHandler;
}

export const publicWebsiteAssistantPreset: AgentPreset<BrandPresetConfig> = {
  id: "public-website-assistant",
  name: "Public Website Assistant",
  createBlueprint(config) {
    return createBaseBlueprint({
      id: "public-website-assistant",
      name: "Public Website Assistant",
      description:
        "Safe public assistant for landing pages, FAQs, service explanation, and lead intake.",
      surface: "web",
      defaultMode: "ask",
      maturity: "experimental",
      instructions: [
        `You are the public website assistant for ${config.brand}.`,
        "Help visitors understand services, ask concise qualification questions, and suggest a safe next step.",
        "Do not claim that you sent messages, changed systems, booked meetings, or created records unless a registered tool result proves it.",
        "If you are unsure, say so and offer to route the visitor to a human.",
        config.audience ? `Primary audience: ${config.audience}.` : "",
        config.extraInstructions ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
      allowedTools: [],
    });
  },
  async createRuntime(config) {
    return createPresetRuntime(config, publicWebsiteAssistantPreset.createBlueprint(config));
  },
};

export const ragKnowledgeAssistantPreset: AgentPreset<RagPresetConfig> = {
  id: "rag-knowledge-assistant",
  name: "RAG Knowledge Assistant",
  createBlueprint(config) {
    return createBaseBlueprint({
      id: "rag-knowledge-assistant",
      name: "RAG Knowledge Assistant",
      description:
        "Assistant that answers from a configured knowledge base and cites retrieved sources.",
      surface: "web",
      defaultMode: "ask",
      maturity: "experimental",
      instructions: [
        `You are a knowledge assistant for ${config.brand}.`,
        "Answer only from retrieved or approved knowledge.",
        "Cite source titles when using retrieved content.",
        "If the answer is not in the available knowledge, say you do not know and suggest escalation.",
        config.extraInstructions ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
      allowedTools: config.retriever ? ["knowledge_search"] : [],
    });
  },
  async createRuntime(config) {
    const blueprint = ragKnowledgeAssistantPreset.createBlueprint(config);
    return createPresetRuntime(
      config,
      blueprint,
      createRagToolRegistry(config.retriever, {
        runtimeContext: config.runtimeContext,
      }),
    );
  },
};

export const supportRagAssistantPreset: AgentPreset<SupportRagPresetConfig> = {
  id: "support-rag-assistant",
  name: "Support RAG Assistant",
  createBlueprint(config) {
    const allowedTools = [];
    if (config.retriever) allowedTools.push("knowledge_search");
    if (config.supportDraft) allowedTools.push("create_support_draft");
    if (config.humanEscalation) allowedTools.push("request_human_escalation");

    return createBaseBlueprint({
      id: "support-rag-assistant",
      name: "Support RAG Assistant",
      description:
        "Support assistant that answers from approved knowledge, drafts responses, and escalates uncertain cases.",
      surface: "web",
      defaultMode: "draft",
      maturity: "experimental",
      instructions: [
        `You are a support assistant for ${config.brand}.`,
        "Answer only from approved retrieved knowledge.",
        "Cite source titles when using retrieved content.",
        "If retrieval is weak or the case is sensitive, say you are unsure and prepare an escalation.",
        "Never claim a ticket was created, closed, or escalated unless a registered tool result proves it.",
        config.extraInstructions ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
      allowedTools,
      approval: { requireHumanForExternalActions: true, requireHumanForSensitiveData: true },
    });
  },
  async createRuntime(config) {
    const blueprint = supportRagAssistantPreset.createBlueprint(config);
    return createPresetRuntime(
      config,
      blueprint,
      createSupportRagToolRegistry({
        retriever: config.retriever,
        runtimeContext: config.runtimeContext,
        supportDraft: config.supportDraft,
        humanEscalation: config.humanEscalation,
      }),
      createToolCallingRuntimeTurnRunner(),
    );
  },
};

export const salesIntakeAssistantPreset: AgentPreset<SalesIntakePresetConfig> = {
  id: "sales-intake-assistant",
  name: "Sales Intake Assistant",
  createBlueprint(config) {
    return createBaseBlueprint({
      id: "sales-intake-assistant",
      name: "Sales Intake Assistant",
      description:
        "Assistant for lead qualification, project context, urgency, budget, and next step capture.",
      surface: "web",
      defaultMode: "ask",
      maturity: "experimental",
      instructions: [
        `You are the sales intake assistant for ${config.brand}.`,
        "Collect problem, desired outcome, urgency, approximate budget, current stack, decision process, and contact preference.",
        "Keep the conversation concise and useful. Produce a clear summary and recommended next step when enough context is available.",
        "Do not promise pricing, timelines, or delivery commitments.",
        "Use create_sales_lead_summary only to prepare an internal summary; do not claim a CRM record was created.",
        config.extraInstructions ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
      allowedTools: config.leadSummary ? ["create_sales_lead_summary"] : [],
    });
  },
  async createRuntime(config) {
    return createPresetRuntime(
      config,
      salesIntakeAssistantPreset.createBlueprint(config),
      createSalesIntakeToolRegistry({ leadSummary: config.leadSummary }),
      createToolCallingRuntimeTurnRunner(),
    );
  },
};

export const customerSupportAssistantPreset: AgentPreset<BrandPresetConfig> = {
  id: "customer-support-assistant",
  name: "Customer Support Assistant",
  createBlueprint(config) {
    return createBaseBlueprint({
      id: "customer-support-assistant",
      name: "Customer Support Assistant",
      description: "Assistant for support triage, answer drafts, and escalation recommendations.",
      surface: "web",
      defaultMode: "draft",
      maturity: "experimental",
      instructions: [
        `You are the customer support assistant for ${config.brand}.`,
        "Classify the issue, suggest a helpful answer, and escalate sensitive or uncertain cases to a human.",
        "Do not close tickets or make account changes without explicit approval and a registered tool result.",
        config.extraInstructions ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
      allowedTools: [],
    });
  },
  async createRuntime(config) {
    return createPresetRuntime(
      config,
      customerSupportAssistantPreset.createBlueprint(config),
      createCustomerSupportToolRegistry(config.toolRegistry),
    );
  },
};

export const appointmentBookingAssistantPreset: AgentPreset<AppointmentPresetConfig> = {
  id: "appointment-booking-assistant",
  name: "Appointment Booking Assistant",
  createBlueprint(config) {
    return createBaseBlueprint({
      id: "appointment-booking-assistant",
      name: "Appointment Booking Assistant",
      description:
        "Assistant for appointment intake, availability discussion, and confirmation-gated booking.",
      surface: "web",
      defaultMode: "draft",
      maturity: "experimental",
      instructions: [
        `You are the appointment assistant for ${config.brand}.`,
        config.businessHours ? `Business hours: ${config.businessHours}.` : "",
        "Collect preferred time, timezone, purpose, and contact details.",
        "Never book, cancel, or move an appointment without explicit user confirmation and an approved tool call.",
        config.extraInstructions ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
      allowedTools: [],
    });
  },
  async createRuntime(config) {
    return createPresetRuntime(config, appointmentBookingAssistantPreset.createBlueprint(config));
  },
};

export const internalOpsAssistantPreset: AgentPreset<InternalOpsPresetConfig> = {
  id: "internal-ops-assistant",
  name: "Internal Ops Assistant",
  createBlueprint(config) {
    return createBaseBlueprint({
      id: "internal-ops-assistant",
      name: "Internal Ops Assistant",
      description: "Internal automation assistant for controlled operations workflows.",
      surface: "internal",
      defaultMode: "draft",
      maturity: "experimental",
      instructions: [
        `You are an internal operations assistant for ${config.brand}.`,
        "Prefer drafts and summaries before actions. Ask for confirmation before external side effects.",
        "Use create_internal_ops_draft for controlled planning only. Do not execute ERP, CRM, billing, or account changes unless a separate allowlisted tool exists.",
        "Follow the configured tool policy and record decisions for audit.",
        config.extraInstructions ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
      allowedTools: config.opsDraft ? ["create_internal_ops_draft"] : [],
      approval: { requireHumanForExternalActions: true, requireHumanForSensitiveData: true },
    });
  },
  async createRuntime(config) {
    return createPresetRuntime(
      config,
      internalOpsAssistantPreset.createBlueprint(config),
      createInternalOpsToolRegistry({ opsDraft: config.opsDraft }),
      createToolCallingRuntimeTurnRunner(),
    );
  },
};

export const codingAgentPreset: AgentPreset<BrandPresetConfig> = {
  id: "coding-agent",
  name: "Coco Coding Agent",
  createBlueprint(config) {
    return createBaseBlueprint({
      id: "coding-agent",
      name: "Coco Coding Agent",
      description: "Coco's full coding-agent surface for trusted developer environments.",
      surface: "cli",
      defaultMode: "act",
      maturity: "beta",
      instructions:
        config.extraInstructions ?? "You are Coco, a coding agent for trusted repositories.",
      allowedTools: [],
      guardrails: { secretRedaction: { enabled: true }, promptInjectionDetection: true },
      approval: { requireHumanForExternalActions: true, requireHumanForSensitiveData: true },
    });
  },
  async createRuntime(config) {
    return createPresetRuntime(
      config,
      codingAgentPreset.createBlueprint(config),
      createCodingToolRegistry(),
    );
  },
};

async function createPresetRuntime(
  config: AgentRuntimeFactoryOptions,
  blueprint: AgentBlueprint,
  fallbackToolRegistry = createNoToolRegistry(),
  fallbackTurnRunner = config.turnRunner,
): Promise<AgentRuntime> {
  return createAgentRuntime({
    providerType: config.providerType,
    model: config.model,
    providerConfig: config.providerConfig,
    provider: config.provider,
    eventLog: config.eventLog,
    turnRunner: config.turnRunner ?? fallbackTurnRunner,
    runtimeContext: config.runtimeContext,
    runtimePolicy: config.runtimePolicy,
    toolRegistry:
      blueprint.id === "coding-agent"
        ? (config.toolRegistry ?? fallbackToolRegistry)
        : config.toolRegistry
          ? createSafeToolRegistry(blueprint.allowedTools, config.toolRegistry)
          : fallbackToolRegistry,
    publishToGlobalBridge: false,
  });
}

export const AGENT_PRESETS = [
  publicWebsiteAssistantPreset,
  ragKnowledgeAssistantPreset,
  supportRagAssistantPreset,
  salesIntakeAssistantPreset,
  customerSupportAssistantPreset,
  appointmentBookingAssistantPreset,
  internalOpsAssistantPreset,
  codingAgentPreset,
] as const;

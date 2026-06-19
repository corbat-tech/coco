import { ToolRegistry, defineTool } from "./registry.js";
import { createFullToolRegistry } from "./index.js";
import type { KnowledgeRetriever, RetrievedSource } from "../runtime/rag.js";
import { z } from "zod";

const PUBLIC_WEB_TOOLS = new Set(["search_public_docs", "list_public_services"]);
const CUSTOMER_SUPPORT_TOOLS = new Set([
  "search_public_docs",
  "knowledge_search",
  "create_support_draft",
  "request_human_escalation",
]);

export interface SupportDraftInput {
  conversationId: string;
  customerMessage: string;
  retrievedSources?: RetrievedSource[];
}

export interface SupportDraftOutput {
  draft: string;
  citations: string[];
  needsHumanReview: boolean;
}

export interface HumanEscalationInput {
  conversationId: string;
  summary: string;
  priority: "low" | "normal" | "high" | "urgent";
  reason: string;
}

export interface HumanEscalationOutput {
  queued: boolean;
  escalationId: string;
  message: string;
}

export interface SalesLeadSummaryInput {
  conversationId: string;
  company?: string;
  contact?: string;
  problem: string;
  desiredOutcome?: string;
  urgency?: "low" | "normal" | "high";
  budgetRange?: string;
  currentStack?: string;
}

export interface SalesLeadSummaryOutput {
  summary: string;
  qualification: "low" | "medium" | "high";
  recommendedNextStep: string;
}

export interface InternalOpsDraftInput {
  requestId: string;
  requester?: string;
  workflow: string;
  requestedAction: string;
  context?: string;
}

export interface InternalOpsDraftOutput {
  draft: string;
  risk: "low" | "medium" | "high";
  requiresApproval: boolean;
}

export type SupportDraftHandler = (input: SupportDraftInput) => Promise<SupportDraftOutput>;
export type HumanEscalationHandler = (
  input: HumanEscalationInput,
) => Promise<HumanEscalationOutput>;
export type SalesLeadSummaryHandler = (
  input: SalesLeadSummaryInput,
) => Promise<SalesLeadSummaryOutput>;
export type InternalOpsDraftHandler = (
  input: InternalOpsDraftInput,
) => Promise<InternalOpsDraftOutput>;

export interface SupportRagToolRegistryOptions {
  retriever?: KnowledgeRetriever;
  supportDraft?: SupportDraftHandler;
  humanEscalation?: HumanEscalationHandler;
}

export interface SalesIntakeToolRegistryOptions {
  leadSummary?: SalesLeadSummaryHandler;
}

export interface InternalOpsToolRegistryOptions {
  opsDraft?: InternalOpsDraftHandler;
}

export function createNoToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}

export function createCodingToolRegistry(): ToolRegistry {
  return createFullToolRegistry();
}

export function createPublicWebToolRegistry(source?: ToolRegistry): ToolRegistry {
  return copyAllowedTools(PUBLIC_WEB_TOOLS, source);
}

export function createCustomerSupportToolRegistry(source?: ToolRegistry): ToolRegistry {
  return copyAllowedTools(CUSTOMER_SUPPORT_TOOLS, source);
}

export function createSupportRagToolRegistry(
  options: SupportRagToolRegistryOptions = {},
): ToolRegistry {
  const registry = createRagToolRegistry(options.retriever);

  if (options.supportDraft) {
    registry.register(
      defineTool<SupportDraftInput, SupportDraftOutput>({
        name: "create_support_draft",
        description:
          "Create a support response draft from the customer message and approved retrieved sources.",
        category: "document",
        parameters: z.object({
          conversationId: z.string(),
          customerMessage: z.string(),
          retrievedSources: z
            .array(
              z.object({
                id: z.string(),
                title: z.string(),
                content: z.string(),
                url: z.string().optional(),
                score: z.number(),
                metadata: z.record(z.string(), z.unknown()).optional(),
              }),
            )
            .optional(),
        }),
        execute: options.supportDraft,
      }),
    );
  }

  if (options.humanEscalation) {
    registry.register(
      defineTool<HumanEscalationInput, HumanEscalationOutput>({
        name: "request_human_escalation",
        description:
          "Prepare a human escalation request. Runtime consumers must confirmation-gate this external action.",
        category: "config",
        parameters: z.object({
          conversationId: z.string(),
          summary: z.string(),
          priority: z.enum(["low", "normal", "high", "urgent"]),
          reason: z.string(),
        }),
        execute: options.humanEscalation,
      }),
    );
  }

  return registry;
}

export function createSalesIntakeToolRegistry(
  options: SalesIntakeToolRegistryOptions = {},
): ToolRegistry {
  const registry = new ToolRegistry();

  if (options.leadSummary) {
    registry.register(
      defineTool<SalesLeadSummaryInput, SalesLeadSummaryOutput>({
        name: "create_sales_lead_summary",
        description:
          "Create a structured lead intake summary and recommended commercial next step.",
        category: "document",
        parameters: z.object({
          conversationId: z.string(),
          company: z.string().optional(),
          contact: z.string().optional(),
          problem: z.string(),
          desiredOutcome: z.string().optional(),
          urgency: z.enum(["low", "normal", "high"]).optional(),
          budgetRange: z.string().optional(),
          currentStack: z.string().optional(),
        }),
        execute: options.leadSummary,
      }),
    );
  }

  return registry;
}

export function createInternalOpsToolRegistry(
  options: InternalOpsToolRegistryOptions = {},
): ToolRegistry {
  const registry = new ToolRegistry();

  if (options.opsDraft) {
    registry.register(
      defineTool<InternalOpsDraftInput, InternalOpsDraftOutput>({
        name: "create_internal_ops_draft",
        description:
          "Prepare an internal operations action draft. This does not execute the operation.",
        category: "document",
        parameters: z.object({
          requestId: z.string(),
          requester: z.string().optional(),
          workflow: z.string(),
          requestedAction: z.string(),
          context: z.string().optional(),
        }),
        execute: options.opsDraft,
      }),
    );
  }

  return registry;
}

export function createRagToolRegistry(retriever?: KnowledgeRetriever): ToolRegistry {
  const registry = new ToolRegistry();
  if (!retriever) return registry;

  registry.register(
    defineTool<
      { query: string; limit?: number },
      Awaited<ReturnType<KnowledgeRetriever["search"]>>
    >({
      name: "knowledge_search",
      description: "Search the configured knowledge base and return ranked sources.",
      category: "search",
      parameters: z.object({
        query: z.string(),
        limit: z.number().optional(),
      }),
      execute: async ({ query, limit }) => retriever.search(query, { limit }),
    }),
  );

  return registry;
}

function copyAllowedTools(allowed: Set<string>, source?: ToolRegistry): ToolRegistry {
  const registry = new ToolRegistry();
  if (!source) return registry;

  for (const name of allowed) {
    const tool = source.get(name);
    if (tool) registry.register(tool);
  }

  return registry;
}

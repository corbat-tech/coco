import { describe, expect, it } from "vitest";
import {
  createRuntimeRequestContext,
  mergeRuntimePolicy,
  runtimeContextToMetadata,
} from "./context.js";

describe("runtime product context", () => {
  it("normalizes tenant, user, surface, and metadata for embedders", () => {
    const context = createRuntimeRequestContext({
      surface: "whatsapp",
      channel: "whatsapp:+34123456789",
      correlationId: "corr-1",
      tenant: { id: "acme", name: "Acme", metadata: { tier: "enterprise" } },
      user: { id: "user-1", roles: ["support"], groups: ["emea"] },
      policy: {
        allowedTools: ["knowledge_search"],
        dataBoundary: { classification: "confidential", redactSensitiveData: true },
      },
    });

    expect(runtimeContextToMetadata(context)).toMatchObject({
      surface: "whatsapp",
      channel: "whatsapp:+34123456789",
      correlationId: "corr-1",
      tenantId: "acme",
      tenantName: "Acme",
      userId: "user-1",
      userRoles: ["support"],
      dataClassification: "confidential",
    });
  });

  it("merges runtime policies without mutating inputs", () => {
    const base = {
      allowedTools: ["read_file"],
      requireHumanApprovalFor: ["destructive" as const],
      dataBoundary: { classification: "internal" as const },
      costBudget: { maxTurns: 3 },
    };
    const override = {
      allowedTools: ["knowledge_search"],
      dataBoundary: { redactSensitiveData: true },
      costBudget: { maxEstimatedCostUsd: 1 },
    };

    expect(mergeRuntimePolicy(base, override)).toEqual({
      allowedTools: ["knowledge_search"],
      requireHumanApprovalFor: ["destructive"],
      dataBoundary: { classification: "internal", redactSensitiveData: true },
      costBudget: { maxTurns: 3, maxEstimatedCostUsd: 1 },
      retention: {},
      rateLimit: {},
    });
    expect(base.allowedTools).toEqual(["read_file"]);
  });
});

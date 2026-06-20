import { describe, expect, it } from "vitest";
import {
  assertRuntimeTenantBoundary,
  assertRuntimeTurnWithinPolicy,
  assertRuntimeUsageWithinPolicy,
  createRetentionCutoffs,
  createRuntimeRequestContext,
  mergeRuntimePolicy,
  RuntimePolicyViolation,
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

  it("requires tenant context for hosted non-CLI surfaces", () => {
    expect(() =>
      assertRuntimeTenantBoundary({ surface: "web" }, "hosted", "session.create"),
    ).toThrow(RuntimePolicyViolation);

    expect(
      assertRuntimeTenantBoundary({ surface: "web", tenant: { id: "tenant-a" } }, "hosted"),
    ).toMatchObject({
      hostMode: "hosted",
      required: true,
      surface: "web",
      tenantId: "tenant-a",
    });
    expect(assertRuntimeTenantBoundary({ surface: "cli" }, "hosted")).toMatchObject({
      required: false,
      surface: "cli",
    });
  });

  it("throws structured policy violations for turn and cost budgets", () => {
    expect(() =>
      assertRuntimeTurnWithinPolicy(
        { costBudget: { maxTurns: 1 } },
        { subject: "turn.run", currentTurns: 1, tenantId: "tenant-a" },
      ),
    ).toThrow(RuntimePolicyViolation);

    try {
      assertRuntimeUsageWithinPolicy(
        { costBudget: { maxEstimatedCostUsd: 0.001 } },
        { subject: "turn.run", tenantId: "tenant-a", estimatedCostUsd: 0.002 },
      );
      throw new Error("Expected policy violation");
    } catch (error) {
      expect(error).toMatchObject({
        name: "RuntimePolicyViolation",
        code: "estimated_cost_exceeded",
        subject: "turn.run",
        tenantId: "tenant-a",
        policyPath: "runtimePolicy.costBudget.maxEstimatedCostUsd",
        severity: "blocked",
      });
    }
  });

  it("derives retention cutoffs from runtime policy", () => {
    expect(
      createRetentionCutoffs(
        {
          retention: {
            conversationDays: 7,
            eventDays: 30,
            artifactDays: 90,
          },
        },
        new Date("2026-06-20T12:00:00.000Z"),
      ),
    ).toEqual({
      conversationBefore: "2026-06-13T12:00:00.000Z",
      eventBefore: "2026-05-21T12:00:00.000Z",
      artifactBefore: "2026-03-22T12:00:00.000Z",
    });
  });
});

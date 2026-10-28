import { z } from "zod";
import { defineTool } from "./registry.js";
import { deriveWorkOutcome, WorkPlanUpdateSchema } from "../runtime/work-ledger.js";

export const readPlanTool = defineTool({
  name: "read_plan",
  category: "memory",
  description:
    "Read this session's work steps and host-observed check evidence. Completed claims may be unverified or stale after edits. No session ID is accepted.",
  parameters: z.object({}),
  async execute(_input, context) {
    if (!context?.workLedger) throw new Error("This host has not attached a session work plan.");
    const state = context.workLedger.read();
    return { ...state, outcome: deriveWorkOutcome(state) };
  },
});

export const updatePlanTool = defineTool({
  name: "update_plan",
  category: "memory",
  description:
    "Upsert a lightweight session work plan for multi-step tasks. Preserve pending steps when incorporating user corrections. Steps have stable id, description, status (pending/in_progress/completed/blocked), optional blockedReason and evidenceIds from read_plan. Remove steps only with explicit removeIds. Completion is a claim, not proof: link current host-observed check IDs to verify. Do not invent evidence IDs. No files are written by this tool.",
  parameters: WorkPlanUpdateSchema,
  async execute(input, context) {
    if (!context?.workLedger) throw new Error("This host has not attached a session work plan.");
    const state = context.workLedger.update(WorkPlanUpdateSchema.parse(input));
    return { ...state, outcome: deriveWorkOutcome(state) };
  },
});

export const workPlanTools = [readPlanTool, updatePlanTool];

import type { SlashCommand } from "../types.js";
import {
  formatWorkLedger,
  readWorkLedger,
  reconcileWorkEvidence,
} from "../../../runtime/work-ledger.js";

/** Show observed work or record explicit human reconciliation; never replay effects. */
export const workCommand: SlashCommand = {
  name: "work",
  aliases: [],
  description: "Show the session work plan and observed verification evidence",
  usage: "/work [resolve <evidenceId> applied|not-applied <inspection reason>]",
  async execute(args, session) {
    const metadata = session.runtime?.getSession(session.id)?.metadata;
    const state = metadata ? readWorkLedger(metadata) : session.workLedger;
    if (args[0] === "resolve") {
      const [_, evidenceId, outcome, ...reason] = args;
      if (
        !state ||
        !evidenceId ||
        !["applied", "not-applied"].includes(outcome ?? "") ||
        !reason.length
      ) {
        console.log(
          "Inspect the effects first. Usage: /work resolve <evidenceId> applied|not-applied <inspection reason>",
        );
        return false;
      }
      const reconciled = reconcileWorkEvidence(state, {
        evidenceId,
        outcome: outcome as "applied" | "not-applied",
        reason: reason.join(" "),
      });
      const runtimeSession = session.runtime?.getSession(session.id);
      if (runtimeSession)
        session.runtime!.runtimeSessionStore.update({
          ...runtimeSession,
          metadata: { ...runtimeSession.metadata, workLedger: reconciled },
        });
      session.workLedger = reconciled;
      console.log(
        "Observed outcome reconciled. No tool was replayed and no verification check was created.",
      );
      return false;
    }
    console.log(
      formatWorkLedger(state) ||
        "No session work recorded. Ask Coco to create a plan for a multi-step task.",
    );
    return false;
  },
};

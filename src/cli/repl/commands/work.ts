import type { SlashCommand } from "../types.js";
import { formatWorkLedger, readWorkLedger } from "../../../runtime/work-ledger.js";

/** Read-only view of session work claims and host-observed verification. */
export const workCommand: SlashCommand = {
  name: "work",
  aliases: [],
  description: "Show the session work plan and observed verification evidence",
  usage: "/work",
  async execute(_args, session) {
    const metadata = session.runtime?.getSession(session.id)?.metadata;
    const state = metadata ? readWorkLedger(metadata) : session.workLedger;
    console.log(
      formatWorkLedger(state) ||
        "No session work recorded. Ask Coco to create a plan for a multi-step task.",
    );
    return false;
  },
};

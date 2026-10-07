import * as p from "@clack/prompts";
import type { SlashCommand } from "../types.js";

export const buildCommand: SlashCommand = {
  name: "build",
  aliases: ["b"],
  description: "Legacy Complete phase (not implemented)",
  usage: "/build [--sprint=N] [--task=N]",
  execute: async (): Promise<boolean> => {
    p.log.warning("/build is not implemented. No files or deployment state were changed.");
    p.log.info(
      "Describe the change in the chat to work interactively; legacy phases are not executed automatically.",
    );
    return false;
  },
};

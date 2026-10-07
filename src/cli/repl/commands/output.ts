import * as p from "@clack/prompts";
import type { SlashCommand } from "../types.js";

export const outputCommand: SlashCommand = {
  name: "output",
  aliases: ["o", "deploy"],
  description: "Legacy Output phase (not implemented)",
  usage: "/output [--ci] [--docs] [--docker]",
  execute: async (): Promise<boolean> => {
    p.log.warning("/output is not implemented. No files or deployment state were changed.");
    p.log.info(
      "Describe the change in the chat to work interactively; legacy phases are not executed automatically.",
    );
    return false;
  },
};

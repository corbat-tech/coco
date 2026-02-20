/**
 * /intent command — toggle intent recognition on/off for the session
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";

/**
 * Module-level flag: true = intent recognition enabled (default), false = disabled.
 * Stored here so the REPL main loop can query it without threading state through
 * the full call chain.
 */
let intentRecognitionEnabled = true;

/**
 * Returns true if intent recognition is currently enabled.
 * Used by the REPL main loop to short-circuit the recognize() call.
 */
export function isIntentRecognitionEnabled(): boolean {
  return intentRecognitionEnabled;
}

export const intentCommand: SlashCommand = {
  name: "intent",
  aliases: [],
  description: "Toggle intent recognition on/off",
  usage: "/intent [on|off|status]",

  async execute(args: string[], _session: ReplSession): Promise<boolean> {
    const sub = args[0]?.toLowerCase();

    if (!sub || sub === "status") {
      const state = intentRecognitionEnabled
        ? chalk.green("on")
        : chalk.red("off");
      console.log(
        chalk.bold("Intent recognition: ") +
          state +
          chalk.dim(
            " — when on, natural-language inputs that look like commands trigger a confirmation dialog.",
          ),
      );
      console.log(
        chalk.dim("  Use ") +
          chalk.yellow("/intent off") +
          chalk.dim(" to disable, ") +
          chalk.yellow("/intent on") +
          chalk.dim(" to re-enable."),
      );
      return false;
    }

    if (sub === "off") {
      intentRecognitionEnabled = false;
      console.log(
        chalk.yellow("Intent recognition disabled") +
          chalk.dim(
            " — natural-language inputs will go directly to the agent as chat.",
          ),
      );
      return false;
    }

    if (sub === "on") {
      intentRecognitionEnabled = true;
      console.log(
        chalk.green("Intent recognition enabled") +
          chalk.dim(
            " — natural-language inputs that look like commands will trigger a confirmation dialog.",
          ),
      );
      return false;
    }

    console.log(
      chalk.red(`Unknown argument: ${args[0]}`) +
        chalk.dim("  Usage: /intent [on|off|status]"),
    );
    return false;
  },
};

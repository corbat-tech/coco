/**
 * /quality command - Toggle quality loop mode
 *
 * Quality loop mode enables automatic quality iteration:
 * requests tests and iterative self-review; reports remain unverified
 */

import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import { isQualityLoop, setQualityLoop, saveQualityLoopPreference } from "../quality-loop.js";

export const qualityCommand: SlashCommand = {
  name: "quality",
  aliases: ["coco"],
  description: "Toggle tests and iterative self-review (model reports are unverified)",
  usage: "/quality [on|off]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const arg = args[0]?.toLowerCase();

    let newState: boolean;

    if (arg === "on") {
      newState = true;
    } else if (arg === "off") {
      newState = false;
    } else if (arg === "status") {
      const state = isQualityLoop();
      const skillAvailable = session.skillRegistry?.has("coco-fix-iterate");
      const modeType =
        state && skillAvailable
          ? chalk.cyan(" (skill-based)")
          : state
            ? chalk.dim(" (prompt-based)")
            : "";
      console.log();
      console.log(
        chalk.magenta("  Quality loop: ") +
          (state ? chalk.green.bold("ON") : chalk.dim("OFF")) +
          modeType,
      );
      console.log();
      if (state) {
        if (skillAvailable) {
          console.log(
            chalk.dim("  Using: ") +
              chalk.cyan("coco-fix-iterate") +
              chalk.dim(" skill (Reviewer+Fixer+Verifier pipeline)"),
          );
        } else {
          console.log(chalk.dim("  Using: text protocol injection (skill not found)"));
        }
        console.log(chalk.dim("  1. Implement code + tests"));
        console.log(chalk.dim("  2. Request tests through tools and inspect their results"));
        console.log(chalk.dim("  3. Self-review against 12 quality dimensions"));
        console.log(chalk.dim("  4. Iterate on findings; model scores do not certify acceptance"));
      } else {
        console.log(chalk.dim("  Enable with /quality on for quality-driven development"));
      }
      console.log();
      return false;
    } else {
      // Toggle
      newState = !isQualityLoop();
    }

    setQualityLoop(newState);
    saveQualityLoopPreference(newState).catch(() => {});

    console.log();
    if (newState) {
      console.log(chalk.magenta("  Quality loop: ") + chalk.green.bold("ON"));
      console.log(chalk.dim("  Requests tests and self-review; model reports are unverified"));
    } else {
      console.log(chalk.magenta("  Quality loop: ") + chalk.dim("OFF"));
      console.log(chalk.dim("  Fast mode — agent responds without quality iteration"));
    }
    console.log();

    return false;
  },
};

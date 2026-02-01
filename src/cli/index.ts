#!/usr/bin/env node

/**
 * Corbat-Coco CLI Entry Point
 */

import { Command } from "commander";
import { VERSION } from "../version.js";
import { registerInitCommand } from "./commands/init.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerBuildCommand } from "./commands/build.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerResumeCommand } from "./commands/resume.js";
import { registerConfigCommand } from "./commands/config.js";

const program = new Command();

program
  .name("coco")
  .description("Corbat-Coco: Autonomous Coding Agent with Self-Review and Quality Convergence")
  .version(VERSION, "-v, --version", "Output the current version");

// Register commands
registerInitCommand(program);
registerPlanCommand(program);
registerBuildCommand(program);
registerStatusCommand(program);
registerResumeCommand(program);
registerConfigCommand(program);

// Parse and execute
program.parseAsync(process.argv).catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

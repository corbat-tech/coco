import { Command } from "commander";

/** Legacy phase checkpoints are not interchangeable with REPL sessions. */
export function registerResumeCommand(program: Command): void {
  program
    .command("resume")
    .description("Legacy phase checkpoint recovery (not implemented)")
    .option("-c, --checkpoint <id>", "Legacy checkpoint ID (unavailable)")
    .option("--list", "Legacy checkpoint listing (unavailable)")
    .option("--force", "Legacy force option (unavailable)")
    .action(() => {
      console.error(
        "coco resume is not implemented. No checkpoint was listed or restored. This legacy command does not resume REPL sessions.",
      );
      process.exitCode = 1;
    });
}

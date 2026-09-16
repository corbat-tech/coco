import { Command } from "commander";

/** Keep the legacy command discoverable without claiming simulated work is real. */
export function registerBuildCommand(program: Command): void {
  program
    .command("build")
    .description("Legacy backlog execution (not implemented; use interactive coco)")
    .option("-t, --task <task-id>", "Legacy task filter (unavailable)")
    .option("-s, --sprint <sprint-id>", "Legacy sprint filter (unavailable)")
    .option("--no-review", "Legacy review option (unavailable)")
    .option("--max-iterations <n>", "Legacy iteration limit (unavailable)", "10")
    .option("--min-quality <n>", "Legacy quality threshold (unavailable)", "85")
    .action(() => {
      console.error(
        "coco build is not implemented. No tasks were executed. Run 'coco' to work interactively; it does not automatically execute this legacy backlog.",
      );
      process.exitCode = 1;
    });
}

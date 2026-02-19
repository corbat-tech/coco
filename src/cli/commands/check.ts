/**
 * `coco check` — Run quality analysis on the current project
 *
 * Evaluates code quality across 12 dimensions and outputs results in the
 * requested format. Exits with code 1 if the project does not meet the
 * minimum quality threshold.
 *
 * Usage:
 *   coco check
 *   coco check --path ./my-project
 *   coco check --output json --output-file .coco/reports/quality.json
 *   coco check --no-fail
 */

import { Command, Option } from "commander";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import * as p from "@clack/prompts";
import { createQualityEvaluatorWithRegistry } from "../../quality/evaluator.js";
import { QualityFormatter } from "../../quality/quality-formatter.js";
import { QualityReportExporter } from "../../quality/report-exporter.js";

export interface CheckCommandOptions {
  path: string;
  output: "text" | "json" | "markdown" | "html";
  outputFile?: string;
  fail: boolean;
}

export function registerCheckCommand(program: Command): void {
  program
    .command("check")
    .description("Run quality analysis and report scores across 12 dimensions")
    .option("-p, --path <path>", "Project path to analyse", process.cwd())
    .option(
      "--output <format>",
      "Output format: text, json, markdown, html (default: text)",
      "text",
    )
    .option("--output-file <file>", "Write report to this file (in addition to stdout)")
    .addOption(new Option("--no-fail", "Exit 0 even if quality is below minimum threshold").default(true, "exit 1 on failure"))
    .action(async (opts: CheckCommandOptions) => {
      const spinner = p.spinner();
      try {
        spinner.start("Running quality analysis…");
        const evaluator = createQualityEvaluatorWithRegistry(opts.path);
        const evaluation = await evaluator.evaluate();
        spinner.stop("Quality analysis complete");

        const exporter = new QualityReportExporter();
        const formatter = new QualityFormatter();

        let output: string;
        switch (opts.output) {
          case "json":
            output = exporter.toJson(evaluation);
            break;
          case "markdown":
            output = exporter.toMarkdown(evaluation);
            break;
          case "html":
            output = exporter.toHtml(evaluation);
            break;
          default:
            output = formatter.formatFull(evaluation);
        }

        // Write to file if requested
        if (opts.outputFile) {
          await mkdir(dirname(opts.outputFile), { recursive: true });
          await writeFile(opts.outputFile, output, "utf-8");
        }

        // Output to stdout:
        // - text (or no --output): print summary + full text report
        // - json/markdown/html WITH --output-file: print summary + file path
        // - json/markdown/html WITHOUT --output-file: print ONLY the raw formatted output
        if (opts.output === "text") {
          console.log(formatter.formatSummary(evaluation));
          console.log(output);
        } else if (opts.outputFile) {
          console.log(formatter.formatSummary(evaluation));
          console.log(`Report written to: ${opts.outputFile}`);
        } else {
          console.log(output);
        }

        // Exit 1 if below minimum and --fail is not disabled
        if (!evaluation.meetsMinimum && opts.fail === true) {
          process.exit(1);
        }
      } catch (error) {
        spinner.stop("Quality analysis failed");
        p.log.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

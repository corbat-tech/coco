import * as p from "@clack/prompts";
import chalk from "chalk";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import type { ReplSession, SlashCommand } from "../types.js";
import { CONFIG_PATHS } from "../../../config/paths.js";
import { findAllConfigPaths, loadConfig } from "../../../config/loader.js";
import { createFullToolRegistry } from "../../../tools/index.js";
import { createHookRegistry } from "../hooks/index.js";
import { isADCConfigured, isOAuthConfigured } from "../../../auth/index.js";

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

function statusIcon(status: DoctorCheck["status"]): string {
  if (status === "pass") return "PASS";
  if (status === "warn") return "WARN";
  return "FAIL";
}

async function checkProjectAccess(projectPath: string): Promise<DoctorCheck> {
  try {
    await access(projectPath, constants.R_OK | constants.W_OK);
    return {
      name: "Project access",
      status: "pass",
      detail: `Readable and writable: ${projectPath}`,
    };
  } catch (error) {
    return {
      name: "Project access",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkConfig(projectPath: string): Promise<DoctorCheck> {
  try {
    const paths = await findAllConfigPaths(projectPath);
    await loadConfig(path.join(projectPath, ".coco", "config.json"));
    const found = [paths.project, paths.global].filter(Boolean).length;
    return {
      name: "Configuration",
      status: "pass",
      detail: found > 0 ? `${found} config file(s) parsed successfully` : "Using built-in defaults",
    };
  } catch (error) {
    return {
      name: "Configuration",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkAuth(session: ReplSession): Promise<DoctorCheck> {
  const provider = session.config.provider.type;

  if (provider === "anthropic") {
    return process.env["ANTHROPIC_API_KEY"]
      ? {
          name: "Provider auth",
          status: "pass",
          detail: "ANTHROPIC_API_KEY detected",
        }
      : {
          name: "Provider auth",
          status: "warn",
          detail: "Missing ANTHROPIC_API_KEY for current provider",
        };
  }

  if (provider === "openai" || provider === "codex") {
    const hasApiKey = !!process.env["OPENAI_API_KEY"];
    const hasOauth = await isOAuthConfigured("openai").catch(() => false);
    return hasApiKey || hasOauth
      ? {
          name: "Provider auth",
          status: "pass",
          detail: hasApiKey ? "OPENAI_API_KEY detected" : "OpenAI OAuth is configured",
        }
      : {
          name: "Provider auth",
          status: "warn",
          detail: "Missing OPENAI_API_KEY and no OpenAI OAuth configuration found",
        };
  }

  if (provider === "gemini") {
    const hasApiKey = !!process.env["GEMINI_API_KEY"] || !!process.env["GOOGLE_API_KEY"];
    const hasOauth = await isOAuthConfigured("gemini").catch(() => false);
    const hasAdc = await isADCConfigured().catch(() => false);
    return hasApiKey || hasOauth || hasAdc
      ? {
          name: "Provider auth",
          status: "pass",
          detail: hasApiKey
            ? "Gemini API key detected"
            : hasAdc
              ? "Google ADC is configured"
              : "Gemini OAuth is configured",
        }
      : {
          name: "Provider auth",
          status: "warn",
          detail: "Missing Gemini auth (API key, OAuth, or ADC)",
        };
  }

  if (provider === "copilot") {
    const hasOauth = await isOAuthConfigured("copilot").catch(() => false);
    return hasOauth
      ? {
          name: "Provider auth",
          status: "pass",
          detail: "Copilot auth is configured",
        }
      : {
          name: "Provider auth",
          status: "warn",
          detail: "Copilot auth not configured",
        };
  }

  return {
    name: "Provider auth",
    status: "warn",
    detail: `No doctor auth rule for provider '${provider}'`,
  };
}

async function checkHooks(projectPath: string): Promise<DoctorCheck> {
  const hooksPath = path.join(projectPath, ".coco", "hooks.json");

  try {
    await access(hooksPath, constants.R_OK);
  } catch {
    return {
      name: "Hooks",
      status: "pass",
      detail: "No project hooks configured",
    };
  }

  try {
    const registry = createHookRegistry();
    await registry.loadFromFile(hooksPath);
    return {
      name: "Hooks",
      status: "pass",
      detail: `${registry.size} hook(s) loaded from .coco/hooks.json`,
    };
  } catch (error) {
    return {
      name: "Hooks",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkTooling(): Promise<DoctorCheck> {
  try {
    const registry = createFullToolRegistry();
    const defs = registry.getToolDefinitionsForLLM();
    return {
      name: "Tool registry",
      status: defs.length > 0 ? "pass" : "fail",
      detail: `${defs.length} tool(s) available to the agent`,
    };
  } catch (error) {
    return {
      name: "Tool registry",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runDoctorChecks(session: ReplSession): Promise<DoctorCheck[]> {
  return Promise.all([
    checkProjectAccess(session.projectPath),
    checkConfig(session.projectPath),
    checkAuth(session),
    checkHooks(session.projectPath),
    checkTooling(),
  ]);
}

export const doctorCommand: SlashCommand = {
  name: "doctor",
  aliases: ["dr"],
  description: "Run read-only diagnostics for config, auth, hooks, and tools",
  usage: "/doctor",
  async execute(_args: string[], session: ReplSession): Promise<boolean> {
    if (!session.config.agent.doctorV2) {
      p.log.warn("Doctor v2 is disabled. Set agent.doctorV2=true to enable it.");
      return false;
    }

    p.intro(chalk.cyan("Coco Doctor"));

    const checks = await runDoctorChecks(session);
    const failures = checks.filter((check) => check.status === "fail").length;
    const warnings = checks.filter((check) => check.status === "warn").length;

    for (const check of checks) {
      p.log.message(`${statusIcon(check.status)}  ${check.name}: ${check.detail}`);
    }

    p.log.message("");
    p.log.info(
      `Summary: ${checks.length - failures - warnings} pass, ${warnings} warn, ${failures} fail`,
    );
    p.log.message(`Config home: ${CONFIG_PATHS.home}`);
    p.outro(failures > 0 ? "Doctor finished with failures" : "Doctor finished");
    return false;
  },
};

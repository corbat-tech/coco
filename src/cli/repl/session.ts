/**
 * REPL session management
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Message } from "../../providers/types.js";
import type { ReplSession, ReplConfig } from "./types.js";
import { getDefaultProvider, getDefaultModel } from "../../config/env.js";

/**
 * Trust settings file location
 */
const TRUST_SETTINGS_DIR = path.join(os.homedir(), ".config", "corbat-coco");
const TRUST_SETTINGS_FILE = path.join(TRUST_SETTINGS_DIR, "trusted-tools.json");

/**
 * Trust settings interface
 */
interface TrustSettings {
  /** Globally trusted tools (for all projects) */
  globalTrusted: string[];
  /** Per-project trusted tools */
  projectTrusted: Record<string, string[]>;
  /** Last updated timestamp */
  updatedAt: string;
}

/**
 * System prompt for the coding agent
 */
const COCO_SYSTEM_PROMPT = `You are Corbat-Coco, an autonomous coding assistant.

You have access to tools for:
- Reading and writing files (read_file, write_file, edit_file, glob, list_dir)
- Executing bash commands (bash_exec, command_exists)
- Git operations (git_status, git_diff, git_add, git_commit, git_log, git_branch, git_checkout, git_push, git_pull)
- Running tests (run_tests, get_coverage, run_test_file)
- Analyzing code quality (run_linter, analyze_complexity, calculate_quality)

When the user asks you to do something:
1. Understand their intent
2. Use the appropriate tools to accomplish the task
3. Explain what you did concisely

Be helpful and direct. If a task requires multiple steps, execute them one by one.
Always verify your work by reading files after editing or running tests after changes.`;

/**
 * Default REPL configuration
 */
export function createDefaultReplConfig(): ReplConfig {
  const providerType = getDefaultProvider();
  return {
    provider: {
      type: providerType,
      model: getDefaultModel(providerType),
      maxTokens: 8192,
    },
    ui: {
      theme: "auto",
      showTimestamps: false,
      maxHistorySize: 100,
    },
    agent: {
      systemPrompt: COCO_SYSTEM_PROMPT,
      maxToolIterations: 25,
      confirmDestructive: true,
    },
  };
}

/**
 * Create a new REPL session
 */
export function createSession(
  projectPath: string,
  config?: Partial<ReplConfig>
): ReplSession {
  const defaultConfig = createDefaultReplConfig();
  return {
    id: randomUUID(),
    startedAt: new Date(),
    messages: [],
    projectPath,
    config: {
      provider: { ...defaultConfig.provider, ...config?.provider },
      ui: { ...defaultConfig.ui, ...config?.ui },
      agent: { ...defaultConfig.agent, ...config?.agent },
    },
    trustedTools: new Set<string>(),
  };
}

/**
 * Add a message to the session
 */
export function addMessage(session: ReplSession, message: Message): void {
  session.messages.push(message);

  // Trim history if needed (keep last N messages, but always keep system)
  const maxMessages = session.config.ui.maxHistorySize * 2;
  if (session.messages.length > maxMessages) {
    // Keep recent messages
    session.messages = session.messages.slice(-session.config.ui.maxHistorySize);
  }
}

/**
 * Get conversation context for LLM (with system prompt)
 */
export function getConversationContext(session: ReplSession): Message[] {
  return [
    { role: "system", content: session.config.agent.systemPrompt },
    ...session.messages,
  ];
}

/**
 * Clear session messages
 */
export function clearSession(session: ReplSession): void {
  session.messages = [];
}

/**
 * Load trust settings from disk
 */
async function loadTrustSettings(): Promise<TrustSettings> {
  try {
    const content = await fs.readFile(TRUST_SETTINGS_FILE, "utf-8");
    return JSON.parse(content) as TrustSettings;
  } catch {
    return {
      globalTrusted: [],
      projectTrusted: {},
      updatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Save trust settings to disk
 */
async function saveTrustSettings(settings: TrustSettings): Promise<void> {
  try {
    await fs.mkdir(TRUST_SETTINGS_DIR, { recursive: true });
    settings.updatedAt = new Date().toISOString();
    await fs.writeFile(TRUST_SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch {
    // Silently fail if we can't save trust settings
  }
}

/**
 * Load trusted tools for a session from persistent storage
 */
export async function loadTrustedTools(projectPath: string): Promise<Set<string>> {
  const settings = await loadTrustSettings();
  const trusted = new Set<string>();

  // Add globally trusted tools
  for (const tool of settings.globalTrusted) {
    trusted.add(tool);
  }

  // Add project-specific trusted tools
  const projectTrusted = settings.projectTrusted[projectPath] ?? [];
  for (const tool of projectTrusted) {
    trusted.add(tool);
  }

  return trusted;
}

/**
 * Save a trusted tool to persistent storage
 * @param toolName - The tool name to trust
 * @param projectPath - The project path (for project-specific trust)
 * @param global - If true, trust globally; otherwise trust for this project only
 */
export async function saveTrustedTool(
  toolName: string,
  projectPath: string,
  global: boolean = false
): Promise<void> {
  const settings = await loadTrustSettings();

  if (global) {
    // Add to global trusted
    if (!settings.globalTrusted.includes(toolName)) {
      settings.globalTrusted.push(toolName);
    }
  } else {
    // Add to project-specific trusted
    if (!settings.projectTrusted[projectPath]) {
      settings.projectTrusted[projectPath] = [];
    }
    const projectTrusted = settings.projectTrusted[projectPath];
    if (projectTrusted && !projectTrusted.includes(toolName)) {
      projectTrusted.push(toolName);
    }
  }

  await saveTrustSettings(settings);
}

/**
 * Remove a trusted tool from persistent storage
 */
export async function removeTrustedTool(
  toolName: string,
  projectPath: string,
  global: boolean = false
): Promise<void> {
  const settings = await loadTrustSettings();

  if (global) {
    settings.globalTrusted = settings.globalTrusted.filter(t => t !== toolName);
  } else {
    const projectTrusted = settings.projectTrusted[projectPath];
    if (projectTrusted) {
      settings.projectTrusted[projectPath] = projectTrusted.filter(t => t !== toolName);
    }
  }

  await saveTrustSettings(settings);
}

/**
 * Get all trusted tools (global and project-specific)
 */
export async function getAllTrustedTools(projectPath: string): Promise<{
  global: string[];
  project: string[];
}> {
  const settings = await loadTrustSettings();
  return {
    global: settings.globalTrusted,
    project: settings.projectTrusted[projectPath] ?? [],
  };
}

/**
 * Initialize session with persisted trust settings
 */
export async function initializeSessionTrust(session: ReplSession): Promise<void> {
  const trusted = await loadTrustedTools(session.projectPath);
  for (const tool of trusted) {
    session.trustedTools.add(tool);
  }
}

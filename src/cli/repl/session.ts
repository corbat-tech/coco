/**
 * REPL session management
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Message, LLMProvider } from "../../providers/types.js";
import type { ReplSession, ReplConfig } from "./types.js";
import { getDefaultModel, getLastUsedProvider, getLastUsedModel } from "../../config/env.js";
import { createContextManager } from "./context/manager.js";
import { createContextCompactor, type CompactionResult } from "./context/compactor.js";
import { createMemoryLoader, type MemoryContext } from "./memory/index.js";
import { CONFIG_PATHS } from "../../config/paths.js";

/**
 * Trust settings file location
 */
const TRUST_SETTINGS_DIR = path.dirname(CONFIG_PATHS.trustedTools);
const TRUST_SETTINGS_FILE = CONFIG_PATHS.trustedTools;

/**
 * Trust settings interface
 */
interface TrustSettings {
  /** Globally trusted tools (for all projects) */
  globalTrusted: string[];
  /** Per-project trusted tools (additive to global) */
  projectTrusted: Record<string, string[]>;
  /** Per-project denied tools (overrides global allow) */
  projectDenied: Record<string, string[]>;
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
Always verify your work by reading files after editing or running tests after changes.

## File Access
File operations are restricted to the project directory by default.
If a tool fails with "outside project directory", tell the user to run \`/allow-path <directory>\` to grant access to that directory. Do NOT retry the operation until the user has granted access.

## Output Formatting Rules

**For normal conversation**: Just respond naturally without any special formatting. Short answers, questions, confirmations, and casual chat should be plain text.

**For structured content** (documentation, tutorials, summaries, explanations with multiple sections, or when the user asks for "markdown"):

1. Wrap your entire response in a single markdown code block:
   \`\`\`markdown
   Your content here...
   \`\`\`

2. **CRITICAL: Never close the markdown block prematurely** - The closing \`\`\` must ONLY appear at the very end.

3. **For code examples inside markdown**, use TILDES (~~~) instead of backticks:
   ~~~javascript
   function example() { return "hello"; }
   ~~~

4. **Include all content in ONE block**: headers, lists, tables, quotes, code examples.

**When to use markdown block:**
- User asks for documentation, summary, tutorial, guide
- Response has multiple sections with headers
- Response includes tables or complex formatting
- User explicitly requests markdown

**When NOT to use markdown block:**
- Simple answers ("Yes", "The file is at /path/to/file")
- Short explanations (1-2 sentences)
- Questions back to the user
- Confirmation messages
- Error messages`;

/**
 * Default REPL configuration
 * Uses last used provider/model from preferences if available
 */
export function createDefaultReplConfig(): ReplConfig {
  // Get last used provider from preferences (falls back to env/anthropic)
  const providerType = getLastUsedProvider();

  // Get last used model for this provider, or fall back to default
  const model = getLastUsedModel(providerType) ?? getDefaultModel(providerType);

  return {
    provider: {
      type: providerType,
      model,
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
export function createSession(projectPath: string, config?: Partial<ReplConfig>): ReplSession {
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
 * Get conversation context for LLM (with system prompt and memory)
 */
export function getConversationContext(session: ReplSession): Message[] {
  // Build system prompt with memory if available
  let systemPrompt = session.config.agent.systemPrompt;

  if (session.memoryContext?.combinedContent) {
    systemPrompt = `${systemPrompt}\n\n# Project Instructions (from COCO.md/CLAUDE.md)\n\n${session.memoryContext.combinedContent}`;
  }

  return [{ role: "system", content: systemPrompt }, ...session.messages];
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
    const raw = JSON.parse(content) as Partial<TrustSettings>;
    // Backward compat: older files may not have projectDenied
    return {
      globalTrusted: raw.globalTrusted ?? [],
      projectTrusted: raw.projectTrusted ?? {},
      projectDenied: raw.projectDenied ?? {},
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return {
      globalTrusted: [],
      projectTrusted: {},
      projectDenied: {},
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

  // Add project-specific trusted tools (additive)
  const projectTrusted = settings.projectTrusted[projectPath] ?? [];
  for (const tool of projectTrusted) {
    trusted.add(tool);
  }

  // Remove project-denied tools (subtractive override — project > global)
  const projectDenied = settings.projectDenied[projectPath] ?? [];
  for (const tool of projectDenied) {
    trusted.delete(tool);
  }

  return trusted;
}

/**
 * Save a trusted tool to persistent storage
 * @param toolName - The tool name to trust
 * @param projectPath - The project path (for project-specific trust), can be null for global trust
 * @param global - If true, trust globally; otherwise trust for this project only
 */
export async function saveTrustedTool(
  toolName: string,
  projectPath: string | null,
  global: boolean = false,
): Promise<void> {
  const settings = await loadTrustSettings();

  if (global) {
    // Add to global trusted
    if (!settings.globalTrusted.includes(toolName)) {
      settings.globalTrusted.push(toolName);
    }
  } else if (projectPath) {
    // Add to project-specific trusted (only if we have a valid project path)
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
  global: boolean = false,
): Promise<void> {
  const settings = await loadTrustSettings();

  if (global) {
    settings.globalTrusted = settings.globalTrusted.filter((t) => t !== toolName);
  } else {
    const projectTrusted = settings.projectTrusted[projectPath];
    if (projectTrusted) {
      settings.projectTrusted[projectPath] = projectTrusted.filter((t) => t !== toolName);
    }
  }

  await saveTrustSettings(settings);
}

/**
 * Save a tool to the project deny list (overrides global allow).
 * Also removes from projectTrusted for consistency.
 */
export async function saveDeniedTool(
  toolName: string,
  projectPath: string,
): Promise<void> {
  const settings = await loadTrustSettings();

  if (!settings.projectDenied[projectPath]) {
    settings.projectDenied[projectPath] = [];
  }
  const denied = settings.projectDenied[projectPath];
  if (denied && !denied.includes(toolName)) {
    denied.push(toolName);
  }

  // Remove from projectTrusted for this project if present (consistency)
  const projectTrusted = settings.projectTrusted[projectPath];
  if (projectTrusted) {
    settings.projectTrusted[projectPath] = projectTrusted.filter((t) => t !== toolName);
  }

  await saveTrustSettings(settings);
}

/**
 * Remove a tool from the project deny list
 */
export async function removeDeniedTool(
  toolName: string,
  projectPath: string,
): Promise<void> {
  const settings = await loadTrustSettings();

  const denied = settings.projectDenied[projectPath];
  if (denied) {
    settings.projectDenied[projectPath] = denied.filter((t) => t !== toolName);
  }

  await saveTrustSettings(settings);
}

/**
 * Get denied tools for a project
 */
export async function getDeniedTools(projectPath: string): Promise<string[]> {
  const settings = await loadTrustSettings();
  return settings.projectDenied[projectPath] ?? [];
}

/**
 * Get all trusted tools (global, project-specific, and project-denied)
 */
export async function getAllTrustedTools(projectPath: string): Promise<{
  global: string[];
  project: string[];
  denied: string[];
}> {
  const settings = await loadTrustSettings();
  return {
    global: settings.globalTrusted,
    project: settings.projectTrusted[projectPath] ?? [],
    denied: settings.projectDenied[projectPath] ?? [],
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

/**
 * Initialize context manager for the session
 */
export function initializeContextManager(session: ReplSession, provider: LLMProvider): void {
  const contextWindow = provider.getContextWindow();
  session.contextManager = createContextManager(contextWindow, {
    compactionThreshold: 0.8,
    reservedTokens: 4096,
  });
}

/**
 * Update context token count after a turn
 */
export function updateContextTokens(session: ReplSession, provider: LLMProvider): void {
  if (!session.contextManager) return;

  // Calculate total tokens from all messages
  let totalTokens = 0;

  // Include system prompt
  totalTokens += provider.countTokens(session.config.agent.systemPrompt);

  // Include all messages
  for (const message of session.messages) {
    const content =
      typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    totalTokens += provider.countTokens(content);
  }

  session.contextManager.setUsedTokens(totalTokens);
}

/**
 * Check if context compaction is needed and perform if necessary
 * Returns true if compaction was performed
 */
export async function checkAndCompactContext(
  session: ReplSession,
  provider: LLMProvider,
): Promise<CompactionResult | null> {
  if (!session.contextManager) {
    initializeContextManager(session, provider);
  }

  // Update token count
  updateContextTokens(session, provider);

  // Check if compaction needed
  if (!session.contextManager!.shouldCompact()) {
    return null;
  }

  // Perform compaction
  const compactor = createContextCompactor({
    preserveLastN: 4,
    summaryMaxTokens: 1000,
  });

  const result = await compactor.compact(session.messages, provider);

  if (result.wasCompacted) {
    // Update session messages with compacted version
    // Extract non-system messages from compacted result
    const compactedNonSystem = result.messages.filter((m) => m.role !== "system");
    session.messages = compactedNonSystem;

    // Update token count
    session.contextManager!.setUsedTokens(result.compactedTokens);
  }

  return result;
}

/**
 * Get context usage percentage for display
 */
export function getContextUsagePercent(session: ReplSession): number {
  return session.contextManager?.getUsagePercent() ?? 0;
}

/**
 * Get formatted context usage string
 */
export function getContextUsageFormatted(session: ReplSession): string {
  return session.contextManager?.formatUsage() ?? "N/A";
}

/**
 * Initialize session memory from COCO.md/CLAUDE.md files
 *
 * Loads memory from:
 * - User level: ~/.config/corbat-coco/COCO.md
 * - Project level: ./COCO.md or ./CLAUDE.md
 * - Local level: ./COCO.local.md or ./CLAUDE.local.md
 */
export async function initializeSessionMemory(session: ReplSession): Promise<void> {
  const loader = createMemoryLoader();
  try {
    session.memoryContext = await loader.loadMemory(session.projectPath);
  } catch (error) {
    // Log error but don't fail session initialization
    console.error("Warning: Failed to load memory files:", error);
    session.memoryContext = {
      files: [],
      combinedContent: "",
      totalSize: 0,
      errors: [
        {
          file: session.projectPath,
          level: "project",
          error: error instanceof Error ? error.message : String(error),
          recoverable: true,
        },
      ],
    };
  }
}

/**
 * Get the memory context for a session
 */
export function getSessionMemory(session: ReplSession): MemoryContext | undefined {
  return session.memoryContext;
}

/**
 * Reload memory for a session (useful after editing memory files)
 */
export async function reloadSessionMemory(session: ReplSession): Promise<void> {
  await initializeSessionMemory(session);
}

/**
 * Export context manager for direct access if needed
 */
export { ContextManager, createContextManager } from "./context/manager.js";
export { ContextCompactor, createContextCompactor } from "./context/compactor.js";
export type { CompactionResult } from "./context/compactor.js";

/**
 * Export memory types
 */
export type { MemoryContext } from "./memory/index.js";

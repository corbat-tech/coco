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
import type { ToolRegistry } from "../../tools/registry.js";

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
 * Category labels for tool catalog display
 */
const CATEGORY_LABELS: Record<string, string> = {
  file: "File Operations",
  bash: "Shell Commands",
  git: "Git & Version Control",
  test: "Testing",
  quality: "Code Quality",
  build: "Build & Deploy",
  deploy: "Deployment",
  config: "Configuration & Permissions",
  web: "Web (Search & Fetch)",
  search: "Code & Semantic Search",
  memory: "Memory, Checkpoints & Persistence",
  document: "Documents (PDF, Images, Diagrams)",
};

/**
 * Generate a tool catalog from the registry for inclusion in the system prompt.
 * Groups tools by category and lists name + short description.
 */
export function generateToolCatalog(registry: ToolRegistry): string {
  const tools = registry.getAll();
  const byCategory = new Map<string, Array<{ name: string; description: string }>>();

  for (const tool of tools) {
    const cat = tool.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push({ name: tool.name, description: tool.description });
  }

  let catalog = "";
  for (const [category, toolList] of byCategory) {
    const label = CATEGORY_LABELS[category] ?? category;
    catalog += `\n### ${label}\n`;
    for (const t of toolList) {
      // Take only the first sentence of description for brevity
      const shortDesc = t.description.split(".")[0] || t.description;
      catalog += `- **${t.name}**: ${shortDesc}\n`;
    }
  }
  return catalog;
}

/**
 * System prompt template for the coding agent.
 * Contains a {TOOL_CATALOG} placeholder that gets replaced dynamically
 * with the actual registered tools from the ToolRegistry.
 */
const COCO_SYSTEM_PROMPT = `You are Corbat-Coco, an autonomous coding assistant with an extensive toolkit.

## YOUR PRIMARY DIRECTIVE: EXECUTE, DON'T TALK ABOUT EXECUTING

🚨 **CRITICAL - READ THIS FIRST** 🚨
YOU ARE AN EXECUTION AGENT, NOT A CONVERSATIONAL ASSISTANT.

**WRONG BEHAVIOR (Never do this):**
❌ "I'll create a file called hello.js with a function..."
❌ "I created hello.js with the following code..."
❌ "Here's what the file would look like..."
❌ Showing code blocks without calling write_file tool

**CORRECT BEHAVIOR (Always do this):**
✅ Immediately call write_file tool with the code
✅ Then say "Created hello.js with greeting function"
✅ TOOLS FIRST, then brief confirmation

**Core Principle: USE TOOLS, DON'T DESCRIBE**
⚠️ CRITICAL: You MUST use your tools to perform actions. NEVER just describe what you would do or claim you did something without actually calling a tool.

**Tool Calling is MANDATORY:**
- User says "create a file" → CALL write_file tool FIRST (don't show code, don't explain, just CALL THE TOOL)
- User says "search the web" → CALL web_search tool FIRST (don't describe what you would search for)
- User says "run tests" → CALL bash_exec tool FIRST (don't say you ran them, actually run them)
- EVERY action requires a TOOL CALL. Text responses are ONLY for brief confirmations AFTER tools execute.

**Execution Process:**
1. **Analyze**: Understand what the user wants (in your head, don't output this)
2. **Execute**: IMMEDIATELY CALL THE APPROPRIATE TOOLS (this is mandatory, not optional)
3. **Respond**: Brief confirmation of what was done (AFTER tools executed)

**Critical Rules:**
- User says "create X with Y" → Immediately call write_file/edit_file tool, no discussion
- If a task needs data you don't have, fetch it with web_search/web_fetch FIRST, THEN complete the task with other tools
- Never ask "should I do this?" or "do you want me to...?" - JUST DO IT (with tools)
- If you don't call tools, you didn't do the task - showing code is NOT the same as creating files
- NEVER show code blocks as examples - ALWAYS write them to files with tools

**PROACTIVE INFORMATION RETRIEVAL (Critical Rule):**
NEVER say "I don't have access to real-time data" or "I can't search the internet". You HAVE web_search and web_fetch tools. Use them:
- User asks about weather, stocks, news, current events → CALL web_search IMMEDIATELY
- User asks something that requires up-to-date info → CALL web_search FIRST, then respond
- You're not sure if your knowledge is current → CALL web_search to verify
- Unknown library, recent release, API change → CALL web_search before answering
- ANY question about the real world that isn't purely about this codebase → web_search it

If web_search returns no useful results: say "I searched but couldn't find current information about X" (NOT "I don't have access").

**IMPORTANT**: You have many tools beyond basic file/bash/git. Before answering "I can't do that", check if any of your tools can help. For example:
- Need information from the internet? Use **web_search** and **web_fetch**
- Need to understand a codebase structure? Use **codebase_map** or **semantic_search**
- Need to remember something across sessions? Use **create_memory** / **recall_memory**
- Need to generate a diagram? Use **generate_diagram**
- Need to read a PDF or image? Use **read_pdf** or **read_image**
- Need to query a database? Use **sql_query**
- Need to save/restore project state? Use **create_checkpoint** / **restore_checkpoint**
- Need to do a code review? Use **code_review**
- Need to search code semantically? Use **semantic_search**
- Need to show a diff visually? Use **show_diff**

## Available Tools
{TOOL_CATALOG}

## Guidelines
- **Be action-oriented**: Execute tasks immediately without asking for confirmation
- **Multi-step tasks**: Chain tools together to complete the full request
- **Always verify**: Read files after editing, run tests after changes
- **Don't present options**: If the user says "create X", create it with reasonable defaults
- **Don't ask "should I..."**: The user already told you what to do by making the request
- **Combine tools**: Use web_search + write_file, bash + read_file, etc. to complete tasks fully
- **Never** add "Co-Authored-By", "Generated by", or any AI attribution to commits, code comments, documentation, or PR descriptions. All output must read as if written by the developer.

**Example Flows:**
- "Create an HTML with weather data" → web_search for weather → write_file with HTML → DONE
- "Add tests for function X" → read_file to see X → write_file with tests → bash to run tests → DONE
- "Fix the bug in Y" → read_file to understand → edit_file to fix → bash to test → DONE

## File Access
File operations are restricted to the project directory by default.
When you need to access a path outside the project, use the **authorize_path** tool first — it will ask the user for permission interactively. Once authorized, proceed with the file operation.
If a file tool fails with "outside project directory", the system will automatically prompt the user to authorize the path and retry. You do NOT need to tell the user to run any command manually.

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
 * Get conversation context for LLM (with system prompt, tool catalog, and memory)
 *
 * When a toolRegistry is provided and the system prompt contains the {TOOL_CATALOG}
 * placeholder, it will be replaced with a dynamically generated catalog of all
 * registered tools grouped by category. This ensures the LLM always knows about
 * every available tool.
 */
export function getConversationContext(
  session: ReplSession,
  toolRegistry?: ToolRegistry,
): Message[] {
  // Build system prompt with dynamic tool catalog
  let systemPrompt = session.config.agent.systemPrompt;

  // Inject dynamic tool catalog if registry provided
  if (toolRegistry && systemPrompt.includes("{TOOL_CATALOG}")) {
    systemPrompt = systemPrompt.replace("{TOOL_CATALOG}", generateToolCatalog(toolRegistry));
  }

  // Append memory/project instructions if available
  if (session.memoryContext?.combinedContent) {
    systemPrompt = `${systemPrompt}\n\n# Project Instructions (from COCO.md/CLAUDE.md)\n\n${session.memoryContext.combinedContent}`;
  }

  // Append project stack context if available
  if (session.projectContext) {
    const stackInfo = formatStackContext(session.projectContext);
    systemPrompt = `${systemPrompt}\n\n${stackInfo}`;
  }

  return [{ role: "system", content: systemPrompt }, ...session.messages];
}

/**
 * Format project stack context for LLM system prompt
 */
function formatStackContext(
  ctx: import("./context/stack-detector.js").ProjectStackContext,
): string {
  const parts: string[] = [];

  parts.push("# Project Technology Stack");
  parts.push("");
  parts.push(`**Language/Runtime:** ${ctx.stack}`);

  if (ctx.packageManager) {
    parts.push(`**Package Manager:** ${ctx.packageManager}`);
  }

  if (ctx.frameworks.length > 0) {
    parts.push(`**Frameworks:** ${ctx.frameworks.join(", ")}`);
  }

  if (ctx.languages.length > 0) {
    parts.push(`**Languages:** ${ctx.languages.join(", ")}`);
  }

  if (ctx.testingFrameworks.length > 0) {
    parts.push(`**Testing Frameworks:** ${ctx.testingFrameworks.join(", ")}`);
  }

  if (ctx.buildTools.length > 0) {
    parts.push(`**Build Tools:** ${ctx.buildTools.join(", ")}`);
  }

  // Show top 10 dependencies
  const keyDeps = Object.entries(ctx.dependencies)
    .slice(0, 10)
    .map(([name, version]) => `${name}@${version}`)
    .join(", ");

  if (keyDeps) {
    parts.push(`**Key Dependencies:** ${keyDeps}`);
  }

  parts.push("");
  parts.push(
    "**IMPORTANT:** When suggesting libraries, frameworks, or dependencies, ONLY recommend technologies compatible with the stack above. Do not suggest installing Node.js packages in a Java project, or Java libraries in a Python project.",
  );

  return parts.join("\n");
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
  } catch (error) {
    // Log but don't throw — trust save is non-critical
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[Trust] Failed to save trust settings: ${msg}`);
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
export async function saveDeniedTool(toolName: string, projectPath: string): Promise<void> {
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
export async function removeDeniedTool(toolName: string, projectPath: string): Promise<void> {
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
 * - User level: ~/.coco/COCO.md
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

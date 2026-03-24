/**
 * REPL session management
 */

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
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
import { isMarkdownContent, type MarkdownSkillContent } from "../../skills/types.js";
import { PLAN_MODE_SYSTEM_PROMPT } from "./commands/plan.js";

/** Maximum total characters budget for active skill instructions (~4000 tokens, ~2% of typical 200K context) */
const MAX_SKILL_INSTRUCTIONS_CHARS = 16000;

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
const COCO_SYSTEM_PROMPT = `You are Corbat-Coco, an autonomous coding assistant. You execute tasks using tools — you do not describe what you would do.

## Execution Model

YOU ARE AN EXECUTION AGENT. Every action requires a TOOL CALL. Text is ONLY for brief confirmations AFTER tools execute.

Process:
1. Orient — ONE line stating the goal (not the tool). Skip for obvious tasks.
2. Execute — CALL tools immediately.
3. Confirm — Brief summary of what was done.

Rules:
- "Create X" → call write_file. "Fix Y" → call edit_file. "Run tests" → call bash_exec. Always tools first.
- NEVER show code blocks instead of writing files. NEVER describe actions instead of performing them.
- NEVER ask "should I?" or "do you want me to?" — the user already told you. JUST DO IT.
- If you need real-time data, CALL web_search. NEVER say "I don't have access to real-time data."
- Before answering "I can't do that", check your full tool catalog below — you likely have a tool for it.
- NEVER claim you cannot run a command because you lack credentials, access, or connectivity. bash_exec runs in the user's own shell environment and inherits their full PATH, kubeconfig, gcloud auth, AWS profiles, SSH keys, and every other tool installed on their machine. kubectl, gcloud, aws, docker, and any other CLI available to the user are available to you. ALWAYS attempt the command with bash_exec; report failure only if it actually returns a non-zero exit code.

## Available Tools
{TOOL_CATALOG}

## Tool Strategy

### Parallel Execution
ALWAYS execute independent operations concurrently. This is 3-5x faster.
- Reading multiple files → batch all read_file calls together
- Multiple searches → batch all grep/glob calls together
- git_status + read_file → parallel (no dependency)
DEFAULT IS PARALLEL. Only serialize when output of step A is needed as input for step B.

### Codebase Research Before Changes
YOU MUST understand the impact zone before writing or editing ANY code:
1. SEARCH for all usages of the symbol you are modifying (grep across the codebase)
2. SEARCH for similar implementations — avoid duplicating existing code
3. READ related files — not just the target, also its importers and dependents
4. FOLLOW existing patterns — if the codebase does X a certain way, do it that way

NEVER edit a file you have not read in the current conversation.
NEVER modify a function without checking its callers first.

### Error Recovery
When a tool fails, classify the failure and respond accordingly:
- **Invalid input** (file not found, text not matched): re-read or re-search to get correct input. NEVER retry with the same arguments.
- **Transient** (timeout, rate limit): retry once with simplified parameters.
- **Structural** (wrong approach, missing dependency): STOP. Explain to user and suggest an alternative.

Specifics:
- edit_file "text not found" → read_file to see actual content; use closest matching lines.
- web_fetch 404/403 → web_search for alternative URL. Do NOT retry same URL.
- Build/test failure → read stderr, inspect failing file, fix code BEFORE retrying build.
- After 2 failures on same tool: stop, rethink approach or explain the issue.
- After 3+ fix attempts on same bug: this is likely architectural. Explain to user.

## Code Quality

### Verification Protocol
YOU MUST verify before ANY completion claim. No exceptions.
1. IDENTIFY the proving command (test, build, typecheck, lint)
2. RUN it freshly — cached or remembered results are NOT evidence
3. READ the full output including exit codes
4. VERIFY output matches your claim
5. STATE the result with evidence

STOP if you catch yourself using "should work", "probably fixed", or "Done!" before running checks.
- "Should work now" → RUN verification. Belief is not evidence.
- "It's a tiny change" → Tiny changes break systems. Verify.
- "Tests passed before my change" → Re-run. Your change may have broken them.

### Code Style
- Use full, descriptive names. Functions are verbs; variables are nouns. No 1-2 char names.
- Explicitly type function signatures and public APIs. Avoid \`any\`.
- Use guard clauses and early returns. Handle errors first. Avoid nesting beyond 2-3 levels.
- Only add comments for complex logic explaining WHY, not WHAT. Never add TODO comments — implement instead.
- Match the existing code style. Do not reformat unrelated code.
- NEVER add "Co-Authored-By", "Generated by", or AI attribution to commits, code, docs, or PRs.

### Testing Discipline
- NEVER modify existing tests to make them pass unless the user explicitly asks.
- If tests fail after your change, the bug is in YOUR code, not the test.
- Every bugfix MUST include a regression test proving the bug is fixed.
- Test BEHAVIOR, not implementation details — tests should survive refactors.
- One clear assertion per test. Descriptive names: "should [expected] when [condition]".

## Debugging Protocol

When fixing bugs, investigate BEFORE fixing. Guessing wastes time.

Phase 1 — Investigate (complete BEFORE any fix attempt):
1. Read the FULL error message and stack trace
2. Reproduce the issue consistently
3. Check recent changes (git diff, new deps, config)
4. Trace backward — follow the bad value upstream to its origin

Phase 2 — Analyze:
1. Find similar WORKING code in the codebase
2. Identify the specific difference causing the failure

Phase 3 — Fix:
1. State your hypothesis: "The bug is caused by X because Y"
2. Make the SMALLEST possible change to test it
3. Write a failing test reproducing the bug FIRST, then fix, then verify

After 3+ failed attempts: STOP. This is likely architectural. Explain to the user.

## Task Planning

For tasks with 3+ steps:
1. List the concrete changes needed (files to create/modify)
2. Identify dependencies (what must come first)
3. Break into atomic steps with verification after each
4. Implement vertically (one complete slice end-to-end) rather than horizontally

## After Completing Tasks

Suggest 1-2 brief, actionable next steps:
- New function → "Consider adding tests"
- Bug fix → "Run full test suite"
- New endpoint → "Update API docs and add integration tests"
- Added dependency → "Run audit to check for vulnerabilities"

## File Access
File operations are restricted to the project directory by default.
Use **authorize_path** to access paths outside the project — it prompts the user interactively.

## Tone and Brevity

Responses are short and direct by default. Lead with the answer or action, not reasoning.
- Do NOT open with "Great question!" or "Sure, I can help with that."
- Do NOT repeat what the user said back to them.
- If you can say it in one sentence, do not use three.
- Only expand when the user asks for explanation or detail.
- Be professionally honest — disagree when warranted, do not validate incorrect approaches.

## Output Formatting

**Normal conversation**: plain text. Short, direct.

**Structured content** (docs, tutorials, multi-section responses, or when user asks for "markdown"):

1. Wrap entire response in a tilde markdown block:
   ~~~markdown
   Your content here...
   ~~~

2. CRITICAL: Bare ~~~ closes the outer block. Only use it as the VERY LAST line.

3. ALL inner fenced blocks use backtick syntax:
   \`\`\`typescript / \`\`\`bash / \`\`\`text / etc.

4. Include all content in ONE block.

**Use markdown block when**: multiple sections, tables, complex formatting.
**Do NOT use when**: simple answers, short explanations, confirmations.`;

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
    let sliceStart = session.messages.length - session.config.ui.maxHistorySize;
    // Walk backward to avoid splitting tool_call/tool_result pairs.
    // A tool_result message at the boundary would be orphaned from its
    // preceding assistant message with tool_calls, causing Error 400.
    while (sliceStart > 0 && sliceStart < session.messages.length) {
      const msg = session.messages[sliceStart];
      const isToolResult =
        Array.isArray(msg?.content) &&
        msg.content.length > 0 &&
        (msg.content[0] as { type?: string })?.type === "tool_result";
      if (!isToolResult) break;
      sliceStart--;
    }
    session.messages = session.messages.slice(sliceStart);
  }
}

/**
 * Substitute $(!command) patterns in skill instructions with dynamic output.
 * Only supports a strict allowlist of safe, read-only commands.
 * Limited to 500 chars per substitution.
 *
 * Security: Uses execFileSync (no shell) and validates the ENTIRE command
 * against a strict allowlist. Shell metacharacters are rejected outright.
 */
function substituteDynamicContext(body: string, cwd: string): string {
  return body.replace(/\$\(!([^)]+)\)/g, (match, raw: string) => {
    const result = executeSafeCommand(raw.trim(), cwd);
    if (result === null) return match; // Leave unsafe commands as-is
    return result;
  });
}

/** Shell metacharacters that indicate command chaining / injection */
const SHELL_METACHARACTERS = /[;|&`$(){}<>!\n\\'"]/;

/**
 * Allowlist of safe commands with their permitted subcommands and flags.
 * Each entry maps a binary name to a validation function that receives the args array.
 * The validator returns true if the args are safe.
 */
const SAFE_COMMAND_VALIDATORS: Record<string, (args: string[]) => boolean> = {
  git: (args) => {
    const safeSubcommands = new Set([
      "status",
      "log",
      "branch",
      "diff",
      "rev-parse",
      "remote",
      "tag",
      "show",
    ]);
    return args.length > 0 && safeSubcommands.has(args[0]!);
  },
  cat: () => true,
  head: () => true,
  tail: () => true,
  ls: () => true,
  pwd: () => true,
  echo: () => true,
  date: () => true,
  // NOTE: `node` is intentionally NOT in this allowlist because `node -e`
  // allows arbitrary code execution (e.g., require('child_process').execSync(...)),
  // which would undermine the security sandbox.
  wc: () => true,
  whoami: () => true,
  basename: () => true,
  dirname: () => true,
};

/**
 * Execute a safe command and return its output, or null if rejected.
 * Validates the entire command (not just a prefix) and rejects all
 * shell metacharacters to prevent command chaining attacks.
 *
 * @internal Exported for testing only
 */
export function executeSafeCommand(command: string, cwd: string): string | null {
  // Reject any command containing shell metacharacters
  if (SHELL_METACHARACTERS.test(command)) {
    return null;
  }

  // Split into binary + args (simple whitespace split — no shell expansion)
  const parts = command.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;

  const binary = parts[0]!; // safe: length > 0 checked above
  const args = parts.slice(1);

  // Validate against allowlist
  const validator = SAFE_COMMAND_VALIDATORS[binary];
  if (!validator || !validator(args)) {
    return null;
  }

  try {
    // execFileSync bypasses the shell entirely — no metacharacter expansion
    const output = execFileSync(binary, args, {
      cwd,
      timeout: 5000,
      encoding: "utf-8",
      maxBuffer: 1024 * 64, // 64KB max
    });
    const trimmed = output.trim();
    return trimmed.length > 500 ? trimmed.slice(0, 500) + "..." : trimmed;
  } catch {
    return `[error: command failed: ${command}]`;
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

  // Append memory/project instructions if available (from AGENTS.md / COCO.md / CLAUDE.md)
  if (session.memoryContext?.combinedContent) {
    systemPrompt = `${systemPrompt}\n\n# Project Instructions\n\n${session.memoryContext.combinedContent}`;
  }

  // Append project stack context if available
  if (session.projectContext) {
    const stackInfo = formatStackContext(session.projectContext);
    systemPrompt = `${systemPrompt}\n\n${stackInfo}`;
  }

  // Inject skill catalog and active skill instructions
  if (session.skillRegistry) {
    const allSkills = session.skillRegistry.getAllMetadata();
    const markdownSkills = allSkills.filter((s) => s.kind === "markdown");

    // Lightweight catalog of available markdown skills (for LLM awareness)
    if (markdownSkills.length > 0) {
      const skillList = markdownSkills.map((s) => `- **${s.name}**: ${s.description}`).join("\n");
      systemPrompt = `${systemPrompt}\n\n# Available Skills\n\nThe following skills can be activated to guide your work:\n${skillList}`;
    }

    // Inject full instructions of currently active skills
    const activeSkills = session.skillRegistry.getActiveSkills();
    if (activeSkills.length > 0) {
      const instructions = activeSkills
        .filter((s) => isMarkdownContent(s.content))
        .map((s) => {
          const mc = s.content as MarkdownSkillContent;
          let body = mc.instructions;
          // Substitute $ARGUMENTS with empty string for auto-activated skills
          // (actual arguments are provided when user invokes via /skillname args)
          body = body.replace(/\$ARGUMENTS/g, session.lastSkillArguments ?? "");
          // Substitute $(!command) patterns with dynamic output
          body = substituteDynamicContext(body, session.projectPath);

          let header = `## Skill: ${s.metadata.name}`;

          // Include tool restrictions if specified
          if (s.metadata.allowedTools && s.metadata.allowedTools.length > 0) {
            header += `\n\n> ⚠️ TOOL RESTRICTION: When following the instructions of skill "${s.metadata.name}", you are restricted to ONLY these tools: ${s.metadata.allowedTools.join(", ")}.`;
            header += `\n> Do NOT use any other tools. If you need a tool not in this list, ask the user for permission first.`;
          }

          // Include model override if specified
          if (s.metadata.model) {
            header += `\n**Model**: Use ${s.metadata.model} for this skill.`;
          }

          return `${header}\n\n${body}`;
        })
        .join("\n\n");
      if (instructions) {
        // Budget guard: truncate skill instructions if they exceed the budget
        let finalInstructions = instructions;
        if (finalInstructions.length > MAX_SKILL_INSTRUCTIONS_CHARS) {
          // Find last paragraph break before the budget limit to avoid cutting mid-markdown
          const cutPoint = finalInstructions.lastIndexOf("\n\n", MAX_SKILL_INSTRUCTIONS_CHARS);
          const safeCut =
            cutPoint > MAX_SKILL_INSTRUCTIONS_CHARS * 0.5 ? cutPoint : MAX_SKILL_INSTRUCTIONS_CHARS;
          finalInstructions =
            finalInstructions.slice(0, safeCut) +
            "\n\n[... skill instructions truncated for context budget]";
        }
        systemPrompt = `${systemPrompt}\n\n# Active Skill Instructions\n\n${finalInstructions}`;
      }
    }
  }

  // Inject plan mode instructions when active
  if (session.planMode) {
    systemPrompt = `${systemPrompt}\n\n${PLAN_MODE_SYSTEM_PROMPT}`;
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
 * Update context token count after a turn.
 *
 * When a toolRegistry is provided, counts the ACTUAL effective system prompt
 * (base + tool catalog + memory + skills + quality loop + plan mode) instead
 * of just the raw base prompt. This prevents underestimating context usage.
 */
export function updateContextTokens(
  session: ReplSession,
  provider: LLMProvider,
  toolRegistry?: ToolRegistry,
): void {
  if (!session.contextManager) return;

  let totalTokens = 0;

  if (toolRegistry) {
    // Count the full effective conversation including composed system prompt
    const effectiveMessages = getConversationContext(session, toolRegistry);
    for (const message of effectiveMessages) {
      const content =
        typeof message.content === "string" ? message.content : JSON.stringify(message.content);
      totalTokens += provider.countTokens(content);
    }
  } else {
    // Fallback: count raw base prompt + messages (less accurate but works without registry)
    totalTokens += provider.countTokens(session.config.agent.systemPrompt);
    for (const message of session.messages) {
      const content =
        typeof message.content === "string" ? message.content : JSON.stringify(message.content);
      totalTokens += provider.countTokens(content);
    }
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
  signal?: AbortSignal,
  toolRegistry?: ToolRegistry,
): Promise<CompactionResult | null> {
  if (!session.contextManager) {
    initializeContextManager(session, provider);
  }

  // Update token count (pass toolRegistry for accurate effective-prompt counting)
  updateContextTokens(session, provider, toolRegistry);

  // Check if compaction needed
  if (!session.contextManager!.shouldCompact()) {
    return null;
  }

  // Perform compaction
  const compactor = createContextCompactor({
    preserveLastN: 8,
    summaryMaxTokens: 1000,
  });

  const result = await compactor.compact(session.messages, provider, signal);

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
 * Initialize session memory from instruction files.
 *
 * Loads memory in priority order (highest wins at each level):
 * - User level:    ~/.coco/AGENTS.md > ~/.coco/COCO.md > ~/.coco/CLAUDE.md
 * - Project level: ./AGENTS.md > ./COCO.md > ./CLAUDE.md
 * - Directory:     subdirectory AGENTS.md/COCO.md/CLAUDE.md (path-scoped)
 * - Local level:   ./AGENTS.local.md > ./COCO.local.md > ./CLAUDE.local.md
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

/**
 * /resume command - Resume a previous session
 *
 * Allows users to resume previous sessions by selecting from a list
 * or directly specifying a session ID. Supports interactive mode
 * for browsing recent sessions and direct mode for quick resumption.
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import type { PersistedSession } from "../sessions/types.js";
import { getSessionStore } from "../sessions/storage.js";

// =============================================================================
// Formatting Utilities
// =============================================================================

/**
 * Format a timestamp as a relative time string
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return "just now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  }

  if (diffDays === 1) {
    return "Yesterday";
  }

  if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  }

  return date.toLocaleDateString();
}

/**
 * Format token count for display (e.g., "15K tokens")
 */
function formatTokenCount(tokens: { input: number; output: number }): string {
  const total = tokens.input + tokens.output;

  if (total === 0) {
    return "0 tokens";
  }

  if (total < 1000) {
    return `${total} tokens`;
  }

  if (total < 1000000) {
    const k = Math.round(total / 1000);
    return `${k}K tokens`;
  }

  const m = (total / 1000000).toFixed(1);
  return `${m}M tokens`;
}

/**
 * Get status icon for session status
 */
function getStatusIcon(status: PersistedSession["status"]): string {
  switch (status) {
    case "active":
      return chalk.green("*");
    case "completed":
      return chalk.blue("v");
    case "interrupted":
      return chalk.yellow("!");
    case "error":
      return chalk.red("x");
    default:
      return " ";
  }
}

// =============================================================================
// Display Functions
// =============================================================================

/**
 * Display a single session entry
 */
function displaySessionEntry(
  index: number,
  session: PersistedSession,
  isCurrentProject: boolean,
): void {
  const timeAgo = formatRelativeTime(new Date(session.lastSavedAt));
  const tokenStr = formatTokenCount(session.totalTokens);
  const statusIcon = getStatusIcon(session.status);

  console.log();
  console.log(
    `${chalk.yellow(`${index}.`)} ${statusIcon} ${chalk.dim(`[${timeAgo}]`)} ${session.messageCount} messages, ${tokenStr}`,
  );

  if (session.title) {
    console.log(`   ${chalk.cyan(`"${session.title}"`)}`);
  }

  if (!isCurrentProject) {
    console.log(`   ${chalk.dim(session.projectPath)}`);
  }
}

/**
 * Display the list of available sessions
 */
function displaySessionList(
  currentProjectSessions: PersistedSession[],
  otherSessions: PersistedSession[],
  currentProjectPath: string,
): number {
  console.log(chalk.cyan.bold("\n" + String.fromCodePoint(0x1f4c2) + " Recent Sessions\n"));

  let displayIndex = 1;

  // Current project sessions
  if (currentProjectSessions.length > 0) {
    console.log(chalk.bold(`Current Project (${currentProjectPath}):`));

    for (const session of currentProjectSessions) {
      displaySessionEntry(displayIndex, session, true);
      displayIndex++;
    }
  }

  // Other project sessions
  if (otherSessions.length > 0) {
    if (currentProjectSessions.length > 0) {
      console.log();
    }
    console.log(chalk.bold("Other Projects:"));

    for (const session of otherSessions) {
      displaySessionEntry(displayIndex, session, false);
      displayIndex++;
    }
  }

  // No sessions found
  if (displayIndex === 1) {
    console.log(chalk.yellow("  No sessions found."));
    console.log(chalk.dim("  Sessions are saved automatically as you work."));
  }

  return displayIndex - 1;
}

/**
 * Display session details before resuming
 */
function displaySessionDetails(session: PersistedSession): void {
  console.log();
  console.log(chalk.cyan.bold("Session Details"));
  console.log();
  console.log(`${chalk.dim("ID:")} ${session.id}`);
  console.log(`${chalk.dim("Project:")} ${session.projectPath}`);
  console.log(`${chalk.dim("Started:")} ${formatRelativeTime(new Date(session.startedAt))}`);
  console.log(`${chalk.dim("Last saved:")} ${formatRelativeTime(new Date(session.lastSavedAt))}`);
  console.log(`${chalk.dim("Messages:")} ${session.messageCount}`);
  console.log(`${chalk.dim("Tokens:")} ${formatTokenCount(session.totalTokens)}`);
  console.log(`${chalk.dim("Status:")} ${session.status}`);

  if (session.title) {
    console.log(`${chalk.dim("Summary:")} ${session.title}`);
  }

  console.log();
}

// =============================================================================
// Resume Logic
// =============================================================================

/**
 * Resume a session by loading it into the current session
 */
async function resumeSession(
  targetSession: PersistedSession,
  currentSession: ReplSession,
): Promise<boolean> {
  const store = getSessionStore();

  // Load full session data
  const loadedSession = await store.load(targetSession.id);

  if (!loadedSession) {
    console.log(chalk.red(`Failed to load session: ${targetSession.id}`));
    console.log(chalk.dim("The session file may be corrupted or missing."));
    return false;
  }

  // Restore messages to current session
  currentSession.messages = [...loadedSession.messages];

  // Restore config if compatible
  if (loadedSession.config.provider.type === currentSession.config.provider.type) {
    currentSession.config.provider.model = loadedSession.config.provider.model;
  }

  // Restore trusted tools
  if (loadedSession.trustedTools) {
    for (const tool of loadedSession.trustedTools) {
      currentSession.trustedTools.add(tool);
    }
  }

  // Display confirmation
  console.log();
  console.log(
    chalk.green(
      `${String.fromCodePoint(0x2713)} Session resumed: ${loadedSession.messages.length} messages loaded`,
    ),
  );

  if (targetSession.title) {
    console.log(chalk.dim(`   "${targetSession.title}"`));
  }

  console.log();
  console.log(chalk.dim("You can continue where you left off."));
  console.log();

  return false;
}

// =============================================================================
// Interactive Mode
// =============================================================================

/**
 * Run interactive session selection
 */
async function runInteractiveMode(session: ReplSession): Promise<boolean> {
  const store = getSessionStore();
  const currentPath = session.projectPath;

  // Get all sessions
  const allSessions = await store.listSessions();

  // Separate current project sessions from others
  const currentProjectSessions = allSessions.filter(
    (s) => s.projectPath === currentPath && s.id !== session.id,
  );
  const otherSessions = allSessions.filter(
    (s) => s.projectPath !== currentPath && s.id !== session.id,
  );

  // Limit to reasonable number
  const limitedCurrentProject = currentProjectSessions.slice(0, 5);
  const limitedOther = otherSessions.slice(0, 5);

  // Display sessions
  const totalCount = displaySessionList(limitedCurrentProject, limitedOther, currentPath);

  if (totalCount === 0) {
    console.log();
    return false;
  }

  // Combine for selection
  const allDisplayed = [...limitedCurrentProject, ...limitedOther];

  console.log();

  // Select session
  const selection = await p.text({
    message: `Select session (1-${totalCount}) or 'q' to cancel`,
    placeholder: "1",
    validate: (value) => {
      if (!value || value.toLowerCase() === "q") return;
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1 || num > totalCount) {
        return `Enter a number between 1 and ${totalCount}, or 'q' to cancel`;
      }
      return;
    },
  });

  if (p.isCancel(selection) || !selection || selection.toLowerCase() === "q") {
    p.outro("Cancelled");
    return false;
  }

  const selectedIndex = parseInt(selection, 10) - 1;
  const selectedSession = allDisplayed[selectedIndex];

  if (!selectedSession) {
    console.log(chalk.red("Invalid session selection."));
    return false;
  }

  // Show details and confirm
  displaySessionDetails(selectedSession);

  const confirm = await p.confirm({
    message: "Resume this session?",
    initialValue: true,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.outro("Cancelled");
    return false;
  }

  // Resume the session
  return resumeSession(selectedSession, session);
}

// =============================================================================
// Direct Mode
// =============================================================================

/**
 * Run direct session resumption by ID
 */
async function runDirectMode(session: ReplSession, sessionId: string): Promise<boolean> {
  const store = getSessionStore();

  // Get all sessions to find the one with matching ID
  const allSessions = await store.listSessions();
  const targetSession = allSessions.find((s) => s.id === sessionId);

  if (!targetSession) {
    console.log();
    console.log(chalk.red(`Session not found: ${sessionId}`));
    console.log(chalk.dim("Use /resume without arguments to see available sessions."));
    console.log();
    return false;
  }

  // Show session details
  displaySessionDetails(targetSession);

  // Confirm
  const confirm = await p.confirm({
    message: "Resume this session?",
    initialValue: true,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.outro("Cancelled");
    return false;
  }

  // Resume the session
  return resumeSession(targetSession, session);
}

// =============================================================================
// Command Definition
// =============================================================================

/**
 * Resume command - Resume a previous session
 */
export const resumeCommand: SlashCommand = {
  name: "resume",
  aliases: ["continue", "restore-session"],
  description: "Resume a previous session",
  usage: "/resume [session-id]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const sessionId = args[0];

    if (sessionId) {
      // Direct mode: resume specific session
      return runDirectMode(session, sessionId);
    }

    // Interactive mode: list and select session
    return runInteractiveMode(session);
  },
};

/**
 * /rewind command - Restore files and/or conversation from a checkpoint
 *
 * Allows users to restore previous states by selecting from available
 * checkpoints. Supports interactive mode (select from list) and direct
 * mode (specify checkpoint ID).
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import type { SlashCommand, ReplSession } from "../types.js";
import type {
  Checkpoint,
  RewindOptions,
  RewindResult,
} from "../checkpoints/types.js";

// =============================================================================
// Time Formatting Utilities
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

  if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  }

  return date.toLocaleDateString();
}

/**
 * Format checkpoint type for display
 */
function formatCheckpointType(checkpoint: Checkpoint): string {
  if (checkpoint.automatic) {
    return chalk.dim("Auto");
  }
  return chalk.cyan("Manual");
}

/**
 * Get checkpoint label or generate one
 */
function getCheckpointLabel(checkpoint: Checkpoint): string {
  if (checkpoint.label) {
    return checkpoint.label;
  }

  // Generate label based on checkpoint content
  const firstFile = checkpoint.files[0];
  if (firstFile) {
    const fileName = firstFile.filePath.split("/").pop() ?? "file";
    const action = firstFile.triggeredBy === "write_file" ? "Write" : "Edit";
    return `Before ${action} ${fileName}`;
  }

  if (checkpoint.conversation) {
    return `Turn ${checkpoint.conversation.messageCount}`;
  }

  return "Checkpoint";
}

// =============================================================================
// Mock Checkpoint Manager (placeholder until real implementation)
// =============================================================================

/**
 * Placeholder checkpoint storage
 * In production, this would be managed by a proper CheckpointManager
 */
interface CheckpointStore {
  checkpoints: Checkpoint[];
}

/**
 * Get checkpoint store from session or create empty one
 */
function getCheckpointStore(session: ReplSession): CheckpointStore {
  const sessionWithStore = session as ReplSession & { checkpointStore?: CheckpointStore };
  if (!sessionWithStore.checkpointStore) {
    sessionWithStore.checkpointStore = { checkpoints: [] };
  }
  return sessionWithStore.checkpointStore;
}

/**
 * Get a specific checkpoint by ID
 */
async function getCheckpoint(
  session: ReplSession,
  checkpointId: string
): Promise<Checkpoint | null> {
  const store = getCheckpointStore(session);
  return store.checkpoints.find((cp) => cp.id === checkpointId) ?? null;
}

/**
 * Restore files from a checkpoint
 */
async function restoreFiles(
  checkpoint: Checkpoint,
  excludeFiles?: string[]
): Promise<{ restored: string[]; failed: Array<{ path: string; error: string }> }> {
  const fs = await import("node:fs/promises");
  const restored: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];

  for (const fileCheckpoint of checkpoint.files) {
    if (excludeFiles?.includes(fileCheckpoint.filePath)) {
      continue;
    }

    try {
      await fs.writeFile(fileCheckpoint.filePath, fileCheckpoint.originalContent, "utf-8");
      restored.push(fileCheckpoint.filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      failed.push({ path: fileCheckpoint.filePath, error: message });
    }
  }

  return { restored, failed };
}

/**
 * Restore conversation from a checkpoint
 */
function restoreConversation(
  session: ReplSession,
  checkpoint: Checkpoint
): { success: boolean; messageCount: number } {
  if (!checkpoint.conversation) {
    return { success: false, messageCount: session.messages.length };
  }

  // Replace session messages with checkpoint messages
  session.messages = [...checkpoint.conversation.messages];

  return { success: true, messageCount: checkpoint.conversation.messageCount };
}

/**
 * Perform a rewind operation
 */
async function performRewind(
  session: ReplSession,
  options: RewindOptions
): Promise<RewindResult> {
  const checkpoint = await getCheckpoint(session, options.checkpointId);

  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${options.checkpointId}`);
  }

  const result: RewindResult = {
    checkpoint,
    filesRestored: [],
    filesFailed: [],
    conversationRestored: false,
    messagesAfterRestore: session.messages.length,
  };

  // Restore files if requested
  if (options.restoreFiles && checkpoint.files.length > 0) {
    const { restored, failed } = await restoreFiles(checkpoint, options.excludeFiles);
    result.filesRestored = restored;
    result.filesFailed = failed;
  }

  // Restore conversation if requested
  if (options.restoreConversation && checkpoint.conversation) {
    const { success, messageCount } = restoreConversation(session, checkpoint);
    result.conversationRestored = success;
    result.messagesAfterRestore = messageCount;
  }

  return result;
}

// =============================================================================
// Display Functions
// =============================================================================

/**
 * Display a single checkpoint entry
 */
function displayCheckpointEntry(
  index: number,
  checkpoint: Checkpoint
): void {
  const timeAgo = formatRelativeTime(checkpoint.createdAt);
  const typeLabel = formatCheckpointType(checkpoint);
  const label = getCheckpointLabel(checkpoint);

  console.log();
  console.log(
    `${chalk.yellow(`${index}.`)} ${chalk.dim(`[${timeAgo}]`)} ${typeLabel}: ${chalk.bold(label)}`
  );

  const parts: string[] = [];

  if (checkpoint.files.length > 0) {
    parts.push(`Files: ${checkpoint.files.length}`);
  }

  if (checkpoint.conversation) {
    parts.push(`Messages: ${checkpoint.conversation.messageCount}`);
  }

  if (parts.length > 0) {
    console.log(`   ${chalk.dim(parts.join(", "))}`);
  }
}

/**
 * Display the list of available checkpoints
 */
function displayCheckpointList(checkpoints: Checkpoint[]): void {
  console.log(chalk.cyan.bold("\n" + String.fromCodePoint(0x1F4F8) + " Available Checkpoints\n"));

  if (checkpoints.length === 0) {
    console.log(chalk.yellow("  No checkpoints available."));
    console.log(chalk.dim("  Checkpoints are created automatically before file modifications."));
    return;
  }

  for (let i = 0; i < checkpoints.length; i++) {
    const checkpoint = checkpoints[i];
    if (checkpoint) {
      displayCheckpointEntry(i + 1, checkpoint);
    }
  }
}

/**
 * Display restoration results
 */
function displayRewindResult(result: RewindResult): void {
  const timeAgo = formatRelativeTime(result.checkpoint.createdAt);

  console.log();
  console.log(chalk.cyan(`Restoring checkpoint from ${timeAgo}...`));
  console.log();

  // Show restored files
  for (const filePath of result.filesRestored) {
    const fileName = filePath.split("/").pop() ?? filePath;
    console.log(`${chalk.green(String.fromCodePoint(0x2713))} Restored: ${fileName}`);
  }

  // Show failed files
  for (const { path, error } of result.filesFailed) {
    const fileName = path.split("/").pop() ?? path;
    console.log(`${chalk.red(String.fromCodePoint(0x2717))} Failed: ${fileName} (${error})`);
  }

  // Show conversation status
  if (result.conversationRestored) {
    console.log(
      `${chalk.green(String.fromCodePoint(0x2713))} Conversation restored (${result.messagesAfterRestore} messages)`
    );
  }

  console.log();

  if (result.filesFailed.length === 0) {
    console.log(chalk.green("Successfully restored to checkpoint."));
  } else {
    console.log(
      chalk.yellow(
        `Partially restored. ${result.filesFailed.length} file(s) could not be restored.`
      )
    );
  }
}

// =============================================================================
// Interactive Mode
// =============================================================================

/**
 * Run interactive checkpoint selection
 */
async function runInteractiveMode(session: ReplSession): Promise<boolean> {
  const store = getCheckpointStore(session);
  const checkpoints = store.checkpoints.slice().reverse(); // Most recent first

  displayCheckpointList(checkpoints);

  if (checkpoints.length === 0) {
    console.log();
    return false;
  }

  console.log();

  // Select checkpoint
  const selection = await p.text({
    message: `Select checkpoint (1-${checkpoints.length}) or 'q' to cancel`,
    placeholder: "1",
    validate: (value) => {
      if (value.toLowerCase() === "q") return;
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1 || num > checkpoints.length) {
        return `Enter a number between 1 and ${checkpoints.length}, or 'q' to cancel`;
      }
      return;
    },
  });

  if (p.isCancel(selection) || selection.toLowerCase() === "q") {
    p.outro("Cancelled");
    return false;
  }

  const selectedIndex = parseInt(selection, 10) - 1;
  const selectedCheckpoint = checkpoints[selectedIndex];

  if (!selectedCheckpoint) {
    console.log(chalk.red("Invalid checkpoint selection."));
    return false;
  }

  // Determine what can be restored
  const hasFiles = selectedCheckpoint.files.length > 0;
  const hasConversation = !!selectedCheckpoint.conversation;

  let restoreFilesFlag = hasFiles;
  let restoreConversationFlag = hasConversation;

  // Ask what to restore if both are available
  if (hasFiles && hasConversation) {
    const restoreChoice = await p.select({
      message: "What would you like to restore?",
      options: [
        { value: "both", label: "Both files and conversation" },
        { value: "files", label: "Files only" },
        { value: "conversation", label: "Conversation only" },
      ],
    });

    if (p.isCancel(restoreChoice)) {
      p.outro("Cancelled");
      return false;
    }

    restoreFilesFlag = restoreChoice === "both" || restoreChoice === "files";
    restoreConversationFlag = restoreChoice === "both" || restoreChoice === "conversation";
  }

  // Show what will be restored
  console.log();
  console.log(chalk.dim("Will restore:"));
  if (restoreFilesFlag) {
    for (const file of selectedCheckpoint.files) {
      const fileName = file.filePath.split("/").pop() ?? file.filePath;
      console.log(`  ${chalk.dim("-")} ${fileName}`);
    }
  }
  if (restoreConversationFlag && selectedCheckpoint.conversation) {
    console.log(
      `  ${chalk.dim("-")} Conversation (${selectedCheckpoint.conversation.messageCount} messages)`
    );
  }
  console.log();

  // Confirm
  const confirm = await p.confirm({
    message: "Proceed with restoration?",
    initialValue: true,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.outro("Cancelled");
    return false;
  }

  // Perform rewind
  const result = await performRewind(session, {
    checkpointId: selectedCheckpoint.id,
    restoreFiles: restoreFilesFlag,
    restoreConversation: restoreConversationFlag,
  });

  displayRewindResult(result);
  console.log();

  return false;
}

// =============================================================================
// Direct Mode
// =============================================================================

/**
 * Run direct checkpoint restoration by ID
 */
async function runDirectMode(
  session: ReplSession,
  checkpointId: string
): Promise<boolean> {
  const checkpoint = await getCheckpoint(session, checkpointId);

  if (!checkpoint) {
    console.log();
    console.log(chalk.red(`Checkpoint not found: ${checkpointId}`));
    console.log(chalk.dim("Use /rewind without arguments to see available checkpoints."));
    console.log();
    return false;
  }

  const hasFiles = checkpoint.files.length > 0;
  const hasConversation = !!checkpoint.conversation;

  // Show what will be restored
  console.log();
  console.log(chalk.cyan.bold("Checkpoint Details"));
  console.log();
  console.log(`${chalk.dim("ID:")} ${checkpoint.id}`);
  console.log(`${chalk.dim("Created:")} ${formatRelativeTime(checkpoint.createdAt)}`);
  console.log(`${chalk.dim("Type:")} ${formatCheckpointType(checkpoint)}`);
  console.log(`${chalk.dim("Label:")} ${getCheckpointLabel(checkpoint)}`);
  console.log();

  if (hasFiles) {
    console.log(chalk.dim("Files to restore:"));
    for (const file of checkpoint.files) {
      const fileName = file.filePath.split("/").pop() ?? file.filePath;
      console.log(`  ${chalk.dim("-")} ${fileName}`);
    }
  }

  if (hasConversation) {
    console.log(
      `${chalk.dim("Conversation:")} ${checkpoint.conversation?.messageCount} messages`
    );
  }

  console.log();

  // Confirm
  const confirm = await p.confirm({
    message: "Restore this checkpoint?",
    initialValue: true,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.outro("Cancelled");
    return false;
  }

  // Perform rewind
  const result = await performRewind(session, {
    checkpointId: checkpoint.id,
    restoreFiles: hasFiles,
    restoreConversation: hasConversation,
  });

  displayRewindResult(result);
  console.log();

  return false;
}

// =============================================================================
// Command Definition
// =============================================================================

/**
 * Rewind command - Restore files and/or conversation from a checkpoint
 */
export const rewindCommand: SlashCommand = {
  name: "rewind",
  aliases: ["restore", "undo-all"],
  description: "Restore files and/or conversation from a checkpoint",
  usage: "/rewind [checkpoint-id]",

  async execute(args: string[], session: ReplSession): Promise<boolean> {
    const checkpointId = args[0];

    if (checkpointId) {
      // Direct mode: restore specific checkpoint
      return runDirectMode(session, checkpointId);
    }

    // Interactive mode: list and select checkpoint
    return runInteractiveMode(session);
  },
};

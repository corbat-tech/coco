/**
 * Input Handler for REPL
 *
 * Provides readline-based input with the following features:
 * - Command history persistence (~/.coco/history)
 * - Tab auto-completion for slash commands
 * - Multiline input support
 * - Graceful Ctrl+C/Ctrl+D handling
 *
 * @module cli/repl/input/handler
 */

import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ReplSession } from "../types.js";
import { getAllCommands } from "../commands/index.js";

/**
 * Input handler interface for REPL
 *
 * Abstracts input collection from the terminal, enabling
 * history navigation and command completion.
 */
export interface InputHandler {
  /**
   * Prompt user for input
   * @returns The input string, or null on EOF/cancel
   */
  prompt(): Promise<string | null>;
  /**
   * Close the input handler and release resources
   */
  close(): void;
}

/** History file location */
const HISTORY_FILE = path.join(os.homedir(), ".coco", "history");

/**
 * Load history from file
 */
function loadHistory(): string[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const content = fs.readFileSync(HISTORY_FILE, "utf-8");
      return content.split("\n").filter(Boolean).slice(-500);
    }
  } catch {
    // Ignore errors loading history
  }
  return [];
}

/**
 * Save history to file
 */
function saveHistory(history: string[]): void {
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Keep last 500 entries
    const toSave = history.slice(-500);
    fs.writeFileSync(HISTORY_FILE, toSave.join("\n") + "\n");
  } catch {
    // Ignore errors saving history
  }
}

/**
 * Create completer for slash commands
 */
function createCompleter(): readline.Completer {
  return (line: string): [string[], string] => {
    if (line.startsWith("/")) {
      const commands = getAllCommands();
      const allCompletions: string[] = [];

      for (const cmd of commands) {
        allCompletions.push("/" + cmd.name);
        for (const alias of cmd.aliases) {
          allCompletions.push("/" + alias);
        }
      }

      const hits = allCompletions.filter((c) =>
        c.toLowerCase().startsWith(line.toLowerCase())
      );

      // Show completions or all if no hits
      return [hits.length ? hits : allCompletions, line];
    }
    return [[], line];
  };
}

/**
 * Create readline-based input handler
 */
export function createInputHandler(session: ReplSession): InputHandler {
  // Load persistent history
  const savedHistory = loadHistory();
  const sessionHistory: string[] = [...savedHistory];

  const rl = readline.createInterface({
    input,
    output,
    prompt: "coco> ",
    historySize: session.config.ui.maxHistorySize,
    terminal: true,
    completer: createCompleter(),
  });

  // Populate readline history from saved history
  for (const entry of savedHistory) {
    (rl as any).history?.unshift(entry);
  }

  let closed = false;

  // Handle Ctrl+C gracefully
  rl.on("SIGINT", () => {
    console.log("\n(Use /exit or Ctrl+D to quit)");
    rl.prompt();
  });

  return {
    async prompt(): Promise<string | null> {
      if (closed) return null;

      return new Promise((resolve) => {
        rl.prompt();

        const lineHandler = (line: string): void => {
          rl.removeListener("close", closeHandler);
          const trimmed = line.trim();
          if (trimmed) {
            sessionHistory.push(trimmed);
          }
          resolve(trimmed || null);
        };

        const closeHandler = (): void => {
          rl.removeListener("line", lineHandler);
          closed = true;
          resolve(null);
        };

        rl.once("line", lineHandler);
        rl.once("close", closeHandler);
      });
    },

    close(): void {
      if (!closed) {
        closed = true;
        // Save history before closing
        saveHistory(sessionHistory);
        rl.close();
      }
    },
  };
}

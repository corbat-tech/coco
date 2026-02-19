#!/usr/bin/env node
/**
 * Session Start Hook — corbat-coco
 *
 * Runs when a Claude Code session begins (SessionStart hook).
 * Reads .claude/session-state.json to summarize the last session to stderr.
 * Passes stdin data through to stdout unchanged (required by Claude Code hooks).
 *
 * Uses Node.js built-ins only — no npm dependencies.
 * Compatible with Node.js 22+ ESM.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const MAX_STDIN_BYTES = 1024 * 1024; // 1 MB limit
const SESSION_STATE_PATH = join(process.cwd(), '.claude', 'session-state.json');

/** @typedef {{ timestamp: string, toolCalls: string[], filesModified: string[], taskSummary?: string }} SessionEntry */
/** @typedef {{ sessions: SessionEntry[] }} SessionState */

/**
 * Reads all stdin data up to the byte limit.
 * @returns {Promise<string>}
 */
function readStdin() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    let data = '';
    rl.on('line', (line) => {
      if (data.length < MAX_STDIN_BYTES) {
        data += line + '\n';
      }
    });
    rl.on('close', () => resolve(data));
  });
}

/**
 * Loads session state from .claude/session-state.json.
 * Returns null if the file does not exist or is malformed.
 * @returns {Promise<SessionState | null>}
 */
async function loadSessionState() {
  try {
    const content = await readFile(SESSION_STATE_PATH, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.sessions)) {
      return /** @type {SessionState} */ (parsed);
    }
    return null;
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      // First session — no state file yet
      return null;
    }
    // Malformed JSON or other error
    process.stderr.write('[session-start] Warning: could not read session state: ' + String(err) + '\n');
    return null;
  }
}

/**
 * Formats a timestamp string to a human-readable relative time.
 * @param {string} timestamp - ISO 8601 timestamp
 * @returns {string}
 */
function formatRelativeTime(timestamp) {
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return timestamp;

  const diffMs = Date.now() - then;
  const diffMin = Math.round(diffMs / 60_000);
  const diffHours = Math.round(diffMs / 3_600_000);
  const diffDays = Math.round(diffMs / 86_400_000);

  if (diffMin < 2) return 'just now';
  if (diffMin < 60) return `${diffMin} minutes ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

/**
 * Prints a brief summary of the last session to stderr.
 * @param {SessionState} state
 */
function printLastSessionSummary(state) {
  const sessions = state.sessions;
  if (!sessions || sessions.length === 0) {
    process.stderr.write('[session-start] No previous sessions found.\n');
    return;
  }

  const last = sessions[sessions.length - 1];
  if (!last) {
    process.stderr.write('[session-start] No previous sessions found.\n');
    return;
  }

  const when = formatRelativeTime(last.timestamp ?? '');
  const toolCount = Array.isArray(last.toolCalls) ? last.toolCalls.length : 0;
  const fileCount = Array.isArray(last.filesModified) ? last.filesModified.length : 0;

  process.stderr.write('[session-start] ─────────────────────────────────\n');
  process.stderr.write(`[session-start] Last session: ${when}\n`);

  if (last.taskSummary) {
    process.stderr.write(`[session-start] Task: ${last.taskSummary}\n`);
  }

  if (toolCount > 0) {
    const uniqueTools = [...new Set(last.toolCalls)].slice(0, 5).join(', ');
    process.stderr.write(`[session-start] Tools used: ${uniqueTools}${toolCount > 5 ? ` (+${toolCount - 5} more)` : ''}\n`);
  }

  if (fileCount > 0) {
    const files = last.filesModified.slice(0, 3).map(f => f.split('/').pop()).join(', ');
    process.stderr.write(`[session-start] Files modified: ${files}${fileCount > 3 ? ` (+${fileCount - 3} more)` : ''}\n`);
  }

  if (sessions.length > 1) {
    process.stderr.write(`[session-start] Total sessions in history: ${sessions.length}\n`);
  }

  process.stderr.write('[session-start] ─────────────────────────────────\n');
}

async function main() {
  const stdinData = await readStdin();

  // Load and summarize previous session (non-blocking — errors are warnings only)
  try {
    const state = await loadSessionState();
    if (state) {
      printLastSessionSummary(state);
    } else {
      process.stderr.write('[session-start] Starting first session — no previous context.\n');
    }
  } catch (err) {
    // Never block session start due to hook errors
    process.stderr.write('[session-start] Warning: hook error (continuing): ' + String(err) + '\n');
  }

  // Always pass stdin through to stdout unchanged
  process.stdout.write(stdinData);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write('[session-start] Fatal error: ' + String(err) + '\n');
  // Still pass through stdin if we have any — but we don't at this point
  process.exit(0); // Never block the session
});

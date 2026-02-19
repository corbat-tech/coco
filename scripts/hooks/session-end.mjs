#!/usr/bin/env node
/**
 * Session End Hook — corbat-coco
 *
 * Runs when a Claude Code session ends (Stop hook).
 * Extracts session info from the hook input and saves/updates
 * .claude/session-state.json. Keeps the last 5 sessions (rotating log).
 * Passes stdin data through to stdout unchanged (required by Claude Code hooks).
 *
 * Uses Node.js built-ins only — no npm dependencies.
 * Compatible with Node.js 22+ ESM.
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline';

const MAX_STDIN_BYTES = 2 * 1024 * 1024; // 2 MB — session transcripts can be large
const MAX_SESSIONS_HISTORY = 5;           // Keep only the most recent 5 sessions
const SESSION_STATE_PATH = join(process.cwd(), '.claude', 'session-state.json');

/**
 * @typedef {{ timestamp: string, toolCalls: string[], filesModified: string[], taskSummary?: string }} SessionEntry
 * @typedef {{ sessions: SessionEntry[] }} SessionState
 */

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
 * Loads existing session state from disk.
 * Returns empty state if the file does not exist.
 * @returns {Promise<SessionState>}
 */
async function loadSessionState() {
  try {
    const content = await readFile(SESSION_STATE_PATH, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.sessions)) {
      return /** @type {SessionState} */ (parsed);
    }
    return { sessions: [] };
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
      process.stderr.write('[session-end] Warning: could not read existing state: ' + String(err) + '\n');
    }
    return { sessions: [] };
  }
}

/**
 * Saves session state atomically (write to temp then rename).
 * @param {SessionState} state
 */
async function saveSessionState(state) {
  const dir = dirname(SESSION_STATE_PATH);
  await mkdir(dir, { recursive: true });

  const tempPath = SESSION_STATE_PATH + '.tmp';
  await writeFile(tempPath, JSON.stringify(state, null, 2), 'utf-8');
  // Rename is atomic on POSIX — prevents corruption if process is interrupted
  await rename(tempPath, SESSION_STATE_PATH);
}

/**
 * Extracts session summary from Claude Code Stop hook input.
 *
 * The Stop hook payload provides session-level fields only:
 *   - stop_reason: why the session ended (e.g. "end_turn", "max_tokens")
 *   - transcript_path: path to the session transcript file (optional)
 *
 * It does NOT include tool_name or tool_input (those are PreToolUse/PostToolUse fields).
 * toolCalls and filesModified are left empty — pattern detection relies on
 * data aggregated by evaluate-session.mjs from the transcript, not this hook.
 *
 * @param {unknown} hookInput - Parsed JSON from Claude Code Stop hook
 * @returns {SessionEntry}
 */
function extractSessionInfo(hookInput) {
  const now = new Date().toISOString();
  let taskSummary = '';

  if (hookInput && typeof hookInput === 'object') {
    const input = /** @type {Record<string, unknown>} */ (hookInput);

    // Extract transcript path if present
    if (typeof input['transcript_path'] === 'string' && input['transcript_path']) {
      taskSummary = 'Session ended (see transcript at ' +
        input['transcript_path'].split('/').pop() + ')';
    }

    // Extract stop reason if present
    if (typeof input['stop_reason'] === 'string' && input['stop_reason']) {
      taskSummary = taskSummary || 'Stop reason: ' + input['stop_reason'];
    }
  }

  return {
    timestamp: now,
    toolCalls: [],
    filesModified: [],
    ...(taskSummary ? { taskSummary } : {}),
  };
}

/**
 * Merges a new session entry into state, keeping only the last N sessions.
 * @param {SessionState} state
 * @param {SessionEntry} newEntry
 * @returns {SessionState}
 */
function rotateSessionHistory(state, newEntry) {
  const updated = [...state.sessions, newEntry];
  // Keep only the most recent MAX_SESSIONS_HISTORY entries
  const trimmed = updated.slice(-MAX_SESSIONS_HISTORY);
  return { sessions: trimmed };
}

async function main() {
  const stdinData = await readStdin();

  try {
    // Parse hook input
    let hookInput = null;
    try {
      hookInput = JSON.parse(stdinData.trim());
    } catch {
      // Malformed input — skip saving, pass through
      process.stderr.write('[session-end] Warning: malformed JSON input, skipping state save\n');
      process.stdout.write(stdinData);
      process.exit(0);
    }

    // Extract session info from hook input
    const sessionEntry = extractSessionInfo(hookInput);

    // Load existing state, merge new entry, save
    const existingState = await loadSessionState();
    const updatedState = rotateSessionHistory(existingState, sessionEntry);
    await saveSessionState(updatedState);

    process.stderr.write(
      '[session-end] Session state saved (' +
      updatedState.sessions.length + '/' + MAX_SESSIONS_HISTORY +
      ' sessions in history)\n'
    );
  } catch (err) {
    // Never block the session end due to hook errors
    process.stderr.write('[session-end] Warning: could not save session state: ' + String(err) + '\n');
  }

  // Always pass stdin through to stdout unchanged
  process.stdout.write(stdinData);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write('[session-end] Fatal error: ' + String(err) + '\n');
  process.exit(0); // Never block
});

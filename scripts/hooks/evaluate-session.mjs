#!/usr/bin/env node
/**
 * Evaluate Session Hook — corbat-coco
 *
 * Runs on Stop hook to analyze patterns across recent sessions.
 * Reads .claude/session-state.json and detects recurring tool usage.
 * If a tool has been called 5+ times across sessions, prints a workflow tip.
 * Passes stdin data through to stdout unchanged (required by Claude Code hooks).
 *
 * Never blocks — exits 0 on any error.
 * Uses Node.js built-ins only — no npm dependencies.
 * Compatible with Node.js 22+ ESM.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const MAX_STDIN_BYTES = 2 * 1024 * 1024; // 2 MB
const SESSION_STATE_PATH = join(process.cwd(), '.claude', 'session-state.json');
const PATTERN_THRESHOLD = 5;      // Tip fires when a tool appears 5+ times across sessions
const FILE_PATTERN_THRESHOLD = 3; // Hot-file tip fires when a file is modified 3+ times across sessions

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
 * Loads session state from disk. Returns null if unavailable.
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
  } catch {
    return null;
  }
}

/**
 * Counts tool call frequency across all sessions.
 * @param {SessionState} state
 * @returns {Map<string, number>}
 */
function countToolFrequency(state) {
  /** @type {Map<string, number>} */
  const freq = new Map();
  for (const session of state.sessions) {
    if (!Array.isArray(session.toolCalls)) continue;
    for (const tool of session.toolCalls) {
      if (typeof tool === 'string' && tool.length > 0) {
        freq.set(tool, (freq.get(tool) ?? 0) + 1);
      }
    }
  }
  return freq;
}

/**
 * Counts file modification frequency across all sessions.
 * @param {SessionState} state
 * @returns {Map<string, number>}
 */
function countFileFrequency(state) {
  /** @type {Map<string, number>} */
  const freq = new Map();
  for (const session of state.sessions) {
    if (!Array.isArray(session.filesModified)) continue;
    for (const file of session.filesModified) {
      if (typeof file === 'string' && file.length > 0) {
        freq.set(file, (freq.get(file) ?? 0) + 1);
      }
    }
  }
  return freq;
}

/**
 * Returns workflow tips for recurring tool patterns.
 * @param {string} tool
 * @param {number} count
 * @returns {string | null}
 */
function getTipForTool(tool, count) {
  const tips = /** @type {Record<string, string>} */ ({
    Bash: `You've run Bash ${count} times across sessions. Consider adding common commands to pnpm scripts in package.json for discoverability.`,
    Edit: `You've used Edit ${count} times across sessions. If editing the same files repeatedly, consider whether a refactoring would reduce future churn.`,
    Write: `You've used Write ${count} times across sessions. If creating similar files repeatedly, consider a template or generator script.`,
    Read: `You've used Read ${count} times across sessions. If reading the same files often, consider whether they should be cached or their content moved closer to where they're needed.`,
    Grep: `You've run Grep ${count} times across sessions. Common search patterns could be documented in CLAUDE.md for quick reference.`,
  });

  return tips[tool] ?? `[evaluate-session] Pattern: "${tool}" used ${count} times across sessions.`;
}

/**
 * Detects and prints patterns. Never throws.
 * @param {SessionState} state
 */
function analyzeAndReport(state) {
  if (state.sessions.length < 2) {
    // Need at least 2 sessions to identify cross-session patterns
    return;
  }

  const toolFreq = countToolFrequency(state);
  const fileFreq = countFileFrequency(state);

  let tipsEmitted = 0;

  // Tool pattern tips
  for (const [tool, count] of toolFreq) {
    if (count >= PATTERN_THRESHOLD) {
      const tip = getTipForTool(tool, count);
      if (tip) {
        process.stderr.write('[evaluate-session] Tip: ' + tip + '\n');
        tipsEmitted++;
      }
    }
  }

  // File pattern tips (files modified FILE_PATTERN_THRESHOLD+ times)
  const hotFiles = [...fileFreq.entries()]
    .filter(([, count]) => count >= FILE_PATTERN_THRESHOLD)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  if (hotFiles.length > 0) {
    const fileList = hotFiles.map(([f, c]) => `${f.split('/').pop()} (${c}x)`).join(', ');
    process.stderr.write(
      `[evaluate-session] Hot files (modified ${FILE_PATTERN_THRESHOLD}+ times): ${fileList}\n`
    );
    tipsEmitted++;
  }

  if (tipsEmitted === 0 && state.sessions.length >= 3) {
    process.stderr.write('[evaluate-session] No strong patterns detected across last ' +
      state.sessions.length + ' sessions.\n');
  }
}

async function main() {
  const stdinData = await readStdin();

  try {
    const state = await loadSessionState();
    if (state) {
      analyzeAndReport(state);
    }
  } catch (err) {
    // Never block on errors — evaluation is purely informational
    process.stderr.write('[evaluate-session] Warning: ' + String(err) + '\n');
  }

  // Always pass stdin through to stdout unchanged
  process.stdout.write(stdinData);
  process.exit(0);
}

main().catch(() => {
  // On any fatal error, exit cleanly without blocking
  process.exit(0);
});

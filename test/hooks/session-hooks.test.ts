/**
 * Tests for session lifecycle hook scripts.
 *
 * Tests each of the three hook scripts by spawning them as child processes:
 *   - scripts/hooks/session-start.mjs
 *   - scripts/hooks/session-end.mjs
 *   - scripts/hooks/evaluate-session.mjs
 *
 * All tests verify the critical invariant: stdin data is always passed
 * through to stdout unchanged, regardless of errors or missing files.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { writeFile, rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Paths to the hook scripts under test
const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
const SESSION_START_SCRIPT = join(PROJECT_ROOT, "scripts", "hooks", "session-start.mjs");
const SESSION_END_SCRIPT = join(PROJECT_ROOT, "scripts", "hooks", "session-end.mjs");
const EVALUATE_SESSION_SCRIPT = join(
  PROJECT_ROOT,
  "scripts",
  "hooks",
  "evaluate-session.mjs"
);

/** Temporary directory used as the working directory for each test */
let tempDir: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `coco-hook-test-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });
  // Create .claude subdirectory expected by hook scripts
  await mkdir(join(tempDir, ".claude"), { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/**
 * Runs a hook script as a child process with the given stdin input.
 * @returns stdout (string), stderr (string), and exit code (number)
 */
function runHookScript(
  scriptPath: string,
  stdinData: string,
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    // Write stdin data and close the stream
    child.stdin?.write(stdinData);
    child.stdin?.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// session-start.mjs tests
// ─────────────────────────────────────────────────────────────────────────────

describe("session-start.mjs", () => {
  it("passes stdin through to stdout unchanged when no session state exists", async () => {
    const input = JSON.stringify({ event: "SessionStart", session_id: "test-123" });

    const { stdout, exitCode } = await runHookScript(SESSION_START_SCRIPT, input, tempDir);

    expect(exitCode).toBe(0);
    // stdout must contain the original input (the passthrough invariant)
    expect(stdout).toContain('"SessionStart"');
    expect(stdout).toContain("test-123");
  });

  it("exits 0 and prints first-session message when session state does not exist", async () => {
    const input = JSON.stringify({ event: "SessionStart" });

    const { stderr, exitCode } = await runHookScript(SESSION_START_SCRIPT, input, tempDir);

    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/first session|no previous/i);
  });

  it("prints last session summary when session state exists", async () => {
    const stateFile = join(tempDir, ".claude", "session-state.json");
    const state = {
      sessions: [
        {
          timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
          toolCalls: ["Bash", "Edit", "Read"],
          filesModified: ["src/providers/openai.ts", "src/cli/repl/manager.ts"],
          taskSummary: "Added retry logic to OpenAI provider",
        },
      ],
    };
    await writeFile(stateFile, JSON.stringify(state), "utf-8");

    const input = JSON.stringify({ event: "SessionStart" });

    const { stderr, exitCode } = await runHookScript(SESSION_START_SCRIPT, input, tempDir);

    expect(exitCode).toBe(0);
    // Should print the task summary or tool list from the last session
    expect(stderr).toMatch(/last session|Added retry logic|Bash|openai/i);
  });

  it("handles malformed session-state.json gracefully (does not crash)", async () => {
    const stateFile = join(tempDir, ".claude", "session-state.json");
    await writeFile(stateFile, "this is not valid json }{", "utf-8");

    const input = JSON.stringify({ event: "SessionStart" });

    const { stdout, exitCode } = await runHookScript(SESSION_START_SCRIPT, input, tempDir);

    expect(exitCode).toBe(0);
    // Stdin must still be passed through despite the error
    expect(stdout).toContain("SessionStart");
  });

  it("handles empty stdin gracefully", async () => {
    const { exitCode } = await runHookScript(SESSION_START_SCRIPT, "", tempDir);
    expect(exitCode).toBe(0);
  });

  it("handles malformed JSON stdin gracefully", async () => {
    const { stdout, exitCode } = await runHookScript(
      SESSION_START_SCRIPT,
      "not-json{{{",
      tempDir
    );
    expect(exitCode).toBe(0);
    // The malformed data should be passed through as-is
    expect(stdout).toContain("not-json");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// session-end.mjs tests
// ─────────────────────────────────────────────────────────────────────────────

describe("session-end.mjs", () => {
  it("saves session state on first run (no existing file)", async () => {
    // Stop hook payload only contains stop_reason and transcript_path — no tool_name/tool_input
    const input = JSON.stringify({
      stop_reason: "end_turn",
      transcript_path: "/tmp/sessions/session-abc123.jsonl",
    });

    const { stdout, exitCode } = await runHookScript(SESSION_END_SCRIPT, input, tempDir);

    expect(exitCode).toBe(0);

    // Session state file should now exist
    const stateFile = join(tempDir, ".claude", "session-state.json");
    const savedContent = await readFile(stateFile, "utf-8");
    const state = JSON.parse(savedContent);

    expect(state.sessions).toBeInstanceOf(Array);
    expect(state.sessions.length).toBe(1);
    // toolCalls and filesModified are empty for Stop hook — tool data is not available at session end
    expect(state.sessions[0].toolCalls).toEqual([]);
    expect(state.sessions[0].filesModified).toEqual([]);
    expect(state.sessions[0].timestamp).toBeDefined();
    expect(state.sessions[0].taskSummary).toMatch(/session-abc123/);

    // Stdin passthrough
    expect(stdout).toContain("end_turn");
  });

  it("appends to existing session history", async () => {
    const stateFile = join(tempDir, ".claude", "session-state.json");
    const existingState = {
      sessions: [
        {
          timestamp: new Date(Date.now() - 86_400_000).toISOString(),
          toolCalls: ["Read"],
          filesModified: [],
        },
      ],
    };
    await writeFile(stateFile, JSON.stringify(existingState), "utf-8");

    // Stop hook payload: only stop_reason and transcript_path are available
    const input = JSON.stringify({
      stop_reason: "end_turn",
    });

    const { exitCode } = await runHookScript(SESSION_END_SCRIPT, input, tempDir);

    expect(exitCode).toBe(0);

    const savedContent = await readFile(stateFile, "utf-8");
    const state = JSON.parse(savedContent);

    // Both sessions should be in history
    expect(state.sessions.length).toBe(2);
    // The new session has empty toolCalls/filesModified (Stop hook doesn't provide tool data)
    expect(state.sessions[1].toolCalls).toEqual([]);
    expect(state.sessions[1].filesModified).toEqual([]);
    expect(state.sessions[1].timestamp).toBeDefined();
  });

  it("keeps only the last 5 sessions (rotating log)", async () => {
    const stateFile = join(tempDir, ".claude", "session-state.json");

    // Create 5 existing sessions
    const existingSessions = Array.from({ length: 5 }, (_, i) => ({
      timestamp: new Date(Date.now() - (5 - i) * 86_400_000).toISOString(),
      toolCalls: [`Tool${i}`],
      filesModified: [],
    }));
    await writeFile(
      stateFile,
      JSON.stringify({ sessions: existingSessions }),
      "utf-8"
    );

    // Stop hook payload: only session-level fields
    const input = JSON.stringify({ stop_reason: "end_turn" });

    const { exitCode } = await runHookScript(SESSION_END_SCRIPT, input, tempDir);

    expect(exitCode).toBe(0);

    const savedContent = await readFile(stateFile, "utf-8");
    const state = JSON.parse(savedContent);

    // Must not exceed 5 sessions
    expect(state.sessions.length).toBe(5);
    // The oldest session (Tool0) should have been evicted
    const allTools = state.sessions.flatMap((s: { toolCalls: string[] }) => s.toolCalls);
    expect(allTools).not.toContain("Tool0");
    // The new session has empty toolCalls (Stop hook doesn't provide tool data)
    expect(state.sessions[4].toolCalls).toEqual([]);
  });

  it("passes stdin through to stdout unchanged", async () => {
    const input = JSON.stringify({ stop_reason: "end_turn", custom_field: "preserved-value" });

    const { stdout, exitCode } = await runHookScript(SESSION_END_SCRIPT, input, tempDir);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("preserved-value");
  });

  it("handles malformed JSON stdin gracefully (exits 0, does not save)", async () => {
    const { stdout, exitCode } = await runHookScript(
      SESSION_END_SCRIPT,
      "not valid json }{",
      tempDir
    );

    expect(exitCode).toBe(0);
    // Malformed input should be passed through as-is
    expect(stdout).toContain("not valid json");
  });

  it("handles empty stdin gracefully", async () => {
    const { exitCode } = await runHookScript(SESSION_END_SCRIPT, "", tempDir);
    expect(exitCode).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluate-session.mjs tests
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluate-session.mjs", () => {
  it("passes stdin through to stdout unchanged when no session state exists", async () => {
    const input = JSON.stringify({ stop_reason: "end_turn" });

    const { stdout, exitCode } = await runHookScript(
      EVALUATE_SESSION_SCRIPT,
      input,
      tempDir
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("end_turn");
  });

  it("exits 0 when session state file does not exist", async () => {
    const { exitCode } = await runHookScript(
      EVALUATE_SESSION_SCRIPT,
      JSON.stringify({ stop_reason: "end_turn" }),
      tempDir
    );
    expect(exitCode).toBe(0);
  });

  it("detects recurring tool pattern (5+ calls) and prints a tip", async () => {
    const stateFile = join(tempDir, ".claude", "session-state.json");

    // Create sessions where Bash is used repeatedly
    const sessions = Array.from({ length: 5 }, (_, i) => ({
      timestamp: new Date(Date.now() - i * 86_400_000).toISOString(),
      toolCalls: ["Bash", "Bash"], // 2 Bash calls per session = 10 total
      filesModified: [],
    }));
    await writeFile(stateFile, JSON.stringify({ sessions }), "utf-8");

    const input = JSON.stringify({ stop_reason: "end_turn" });

    const { stderr, exitCode } = await runHookScript(
      EVALUATE_SESSION_SCRIPT,
      input,
      tempDir
    );

    expect(exitCode).toBe(0);
    // Should print a tip about the Bash pattern
    expect(stderr).toMatch(/Bash|pnpm scripts|pattern/i);
  });

  it("does not print a pattern tip when tool frequency is below threshold", async () => {
    const stateFile = join(tempDir, ".claude", "session-state.json");

    // Only 2 Bash calls — below the threshold of 5
    const sessions = [
      {
        timestamp: new Date().toISOString(),
        toolCalls: ["Bash"],
        filesModified: [],
      },
      {
        timestamp: new Date().toISOString(),
        toolCalls: ["Bash"],
        filesModified: [],
      },
    ];
    await writeFile(stateFile, JSON.stringify({ sessions }), "utf-8");

    const input = JSON.stringify({ stop_reason: "end_turn" });

    const { stderr, exitCode } = await runHookScript(
      EVALUATE_SESSION_SCRIPT,
      input,
      tempDir
    );

    expect(exitCode).toBe(0);
    // Should NOT fire a tip for only 2 occurrences
    expect(stderr).not.toMatch(/Tip: You've run Bash/);
  });

  it("handles malformed session-state.json gracefully", async () => {
    const stateFile = join(tempDir, ".claude", "session-state.json");
    await writeFile(stateFile, "{ broken json", "utf-8");

    const input = JSON.stringify({ stop_reason: "end_turn" });

    const { stdout, exitCode } = await runHookScript(
      EVALUATE_SESSION_SCRIPT,
      input,
      tempDir
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("end_turn");
  });

  it("passes stdin through to stdout unchanged in all cases", async () => {
    // Test with valid state
    const stateFile = join(tempDir, ".claude", "session-state.json");
    await writeFile(
      stateFile,
      JSON.stringify({ sessions: [{ timestamp: new Date().toISOString(), toolCalls: [], filesModified: [] }] }),
      "utf-8"
    );

    const input = JSON.stringify({ unique_marker: "test-passthrough-abc123" });

    const { stdout, exitCode } = await runHookScript(
      EVALUATE_SESSION_SCRIPT,
      input,
      tempDir
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("test-passthrough-abc123");
  });

  it("does not print any tip or warning when only one session exists (< 2 needed for pattern detection)", async () => {
    // Fix #7: single-session boundary — no cross-session patterns can be detected
    const stateFile = join(tempDir, ".claude", "session-state.json");
    const singleSession = {
      sessions: [
        {
          timestamp: new Date().toISOString(),
          toolCalls: ["Bash", "Bash", "Bash", "Bash", "Bash"], // 5 calls, but only 1 session
          filesModified: ["src/foo.ts"],
        },
      ],
    };
    await writeFile(stateFile, JSON.stringify(singleSession), "utf-8");

    const input = JSON.stringify({ stop_reason: "end_turn" });

    const { stdout, stderr, exitCode } = await runHookScript(
      EVALUATE_SESSION_SCRIPT,
      input,
      tempDir
    );

    expect(exitCode).toBe(0);
    // No tip should be emitted — need 2+ sessions for pattern detection
    expect(stderr).not.toMatch(/Tip:/);
    expect(stderr).not.toMatch(/Hot files/);
    // stdin must still be passed through unchanged
    expect(stdout).toContain("end_turn");
  });

  it("prints a hot-file tip when the same file appears in filesModified 3+ times across sessions", async () => {
    // Fix #8: hot-files pattern detection
    const stateFile = join(tempDir, ".claude", "session-state.json");
    const sessions = Array.from({ length: 4 }, (_, i) => ({
      timestamp: new Date(Date.now() - i * 86_400_000).toISOString(),
      toolCalls: [],
      filesModified: ["src/providers/openai.ts", "src/cli/repl/manager.ts"],
    }));
    // openai.ts and manager.ts both appear 4 times — above the threshold of 3
    await writeFile(stateFile, JSON.stringify({ sessions }), "utf-8");

    const input = JSON.stringify({ stop_reason: "end_turn" });

    const { stderr, exitCode } = await runHookScript(
      EVALUATE_SESSION_SCRIPT,
      input,
      tempDir
    );

    expect(exitCode).toBe(0);
    // Should print a hot-file warning mentioning the frequently-modified file
    expect(stderr).toMatch(/Hot files/i);
    expect(stderr).toMatch(/openai\.ts|manager\.ts/i);
  });
});

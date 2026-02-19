# Hook System Rules — Common

## What Are Hooks

Claude Code hooks are shell commands that run automatically at lifecycle events. They intercept tool calls before or after execution to enforce conventions, provide feedback, or persist state. Hooks receive and must emit JSON on stdin/stdout.

Hook types available:
- **PreToolUse** — Before a tool executes (can block with exit code 2)
- **PostToolUse** — After a tool executes (observational, can log/warn)
- **Stop** — When Claude ends a response (final checks, context persistence)
- **SessionStart** — When a Claude Code session begins

## Hook Configuration

Hooks live in `.claude/settings.json` under the `hooks` key:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/hooks/check-something.mjs",
            "description": "What this hook guards"
          }
        ]
      }
    ]
  }
}
```

Hook scripts live in `scripts/hooks/` as `.mjs` files (ESM, Node.js built-ins only).

## The 5 Active Hooks in This Project

### 1. PreToolUse: Block Dev Server Outside tmux (`.claude/settings.json`)

**Matcher**: `Bash`

**Purpose**: Prevents `pnpm dev` (or `npm run dev`, `bun dev`) from running outside a tmux session. Dev servers run indefinitely and would block the Claude Code agent. Without tmux, log access is also lost.

**Behavior**: If the Bash command matches a dev-server pattern AND `TMUX` is not set, exits with code 2 (blocking the command) and prints instructions.

**Guard**: `/(pnpm( run)? dev\b|npm run dev\b|bun( run)? dev\b)/.test(cmd) && !process.env.TMUX`

### 2. PostToolUse: Log PR URL After gh pr create (`.claude/settings.json`)

**Matcher**: `Bash`

**Purpose**: After `gh pr create` succeeds, extracts the PR URL from the output and prints follow-up commands (`gh pr view`, `gh pr checks --watch`) to stderr so they appear in the Claude Code transcript.

**Behavior**: Observational only — never blocks. Parses stdout for a GitHub PR URL pattern.

### 3. PostToolUse: Build Status Summary After pnpm build (`.claude/settings.json`)

**Matcher**: `Bash`

**Purpose**: After `pnpm build` or `tsup`, summarizes whether the build succeeded or failed based on output pattern matching. Provides clear signal in the transcript.

**Guard**: `/pnpm build|tsup/.test(cmd)`

### 4. PostToolUse: Warn About console.log in TypeScript Files (`.claude/settings.json`)

**Matcher**: `Edit`

**Purpose**: When a TypeScript file (not test, not `.d.ts`) is edited and the new content contains `console.log`, warns to use `getLogger()` from `src/utils/logger.ts` instead.

**Why**: `console.log` bypasses the structured logging system and can expose sensitive data in output logs.

### 5. Stop: Final console.log Scan (`.claude/settings.json`)

**Matcher**: `*` (all)

**Purpose**: At session end, scans all TypeScript files modified since last commit for `console.log`. If found, lists the files and suggests replacing with `getLogger()` before committing.

**Why**: Acts as a last-chance guard. The Edit hook catches additions in real time; this Stop hook catches any that slipped through.

## Session Lifecycle Hooks

Two additional hooks manage session state persistence. These run as external scripts:

### SessionStart: `scripts/hooks/session-start.mjs`

Runs when a Claude Code session begins. Loads `.claude/session-state.json` and prints a brief summary of the last session to stderr: what agent was active, what task was in progress, and the timestamp. Enables continuity across sessions.

### Stop (evaluate-session): `scripts/hooks/evaluate-session.mjs`

Runs when Claude ends a response. Reads session state history and detects recurring patterns (e.g., same tool called 5+ times across sessions). If a pattern is found, prints a tip to stderr suggesting workflow improvements.

## How to Add a New Hook Safely

### Step 1: Determine the right type

| Need | Hook Type | Reason |
|------|-----------|--------|
| Prevent a dangerous command | PreToolUse | Can block with exit 2 |
| Log/annotate after tool runs | PostToolUse | Observational |
| Check state at session end | Stop | Runs once at end |
| Restore previous context | SessionStart | Runs once at start |

### Step 2: Write the hook script

All hooks receive JSON on stdin and must pass it to stdout unchanged:

```javascript
// scripts/hooks/my-hook.mjs
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });
let input = '';
rl.on('line', line => { input += line + '\n'; });
rl.on('close', () => {
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    // Malformed JSON — pass through unchanged, never block
    process.stdout.write(input);
    process.exit(0);
  }

  // Your logic here — write observations to stderr
  const cmd = parsed.tool_input?.command ?? '';
  if (/some-pattern/.test(cmd)) {
    process.stderr.write('[Hook] Found something: ' + cmd + '\n');
  }

  // ALWAYS pass input through to stdout
  process.stdout.write(JSON.stringify(parsed));
  process.exit(0); // 0 = allow, 2 = block (PreToolUse only)
});
```

### Step 3: Register in `.claude/settings.json`

Add to the appropriate event key. Use `"matcher": "*"` for all tools or a specific tool name.

### Step 4: Test manually

```bash
# Test with sample hook input
echo '{"tool_name":"Bash","tool_input":{"command":"pnpm dev"}}' | node scripts/hooks/my-hook.mjs
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Blocking Too Aggressively (exit 2 overuse)
```javascript
// ❌ Blocks any Bash command that mentions 'rm'
if (/rm/.test(cmd)) process.exit(2);

// ✅ Only block destructive patterns with explicit flags
if (/rm -rf \//.test(cmd)) process.exit(2);
```
Aggressive blocking frustrates workflows and gets disabled. Be surgical.

### Anti-Pattern 2: Hooks with Side Effects That Can Fail
```javascript
// ❌ Hook modifies a file — if it fails, it blocks the tool
await fs.writeFile('/tmp/log.json', JSON.stringify(data));
process.stdout.write(input); // reached only if write succeeds

// ✅ Side effects wrapped in try/catch, never blocking
try {
  await fs.writeFile('/tmp/log.json', JSON.stringify(data));
} catch {
  // side effect failed — log to stderr, continue
  process.stderr.write('[Hook] Warning: could not write log\n');
}
process.stdout.write(input); // always runs
```

### Anti-Pattern 3: Heavy Processing in PreToolUse
```javascript
// ❌ Running pnpm test in a PreToolUse hook adds 30s to every Bash call
if (/\.ts/.test(file)) {
  execSync('pnpm test'); // 30+ seconds — terrible DX
}

// ✅ Lightweight checks only (pattern matching, file stat)
if (/console\.log/.test(newContent)) {
  process.stderr.write('[Hook] Warning: console.log found\n');
}
```

### Anti-Pattern 4: Hooks That Forget to Pass stdin Through
```javascript
// ❌ stdin consumed but never forwarded — tool call is lost
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  doSomething(data);
  // Forgot: process.stdout.write(data)
});

// ✅ Always echo stdin to stdout
process.stdin.on('end', () => {
  doSomething(data);
  process.stdout.write(data); // required
});
```

### Anti-Pattern 5: Using npm Dependencies in Hook Scripts
Hook scripts run in isolation. Using npm dependencies requires `node_modules` to be installed and the correct working directory. Use Node.js built-ins only:

```javascript
// ❌ Requires npm install
import chalk from 'chalk';

// ✅ Node.js built-in only
import { createInterface } from 'node:readline';
```

## Hook Script Conventions

- Location: `scripts/hooks/*.mjs` (ESM, Node.js 22+)
- Dependencies: Node.js built-ins only (`node:fs`, `node:path`, `node:readline`)
- Exit codes: `0` = allow/continue, `2` = block (PreToolUse only)
- Always write to `stderr` for messages (stdout is reserved for JSON passthrough)
- Always handle malformed JSON gracefully (exit 0, pass input through)
- Never block on `SessionStart`/`Stop` hooks (exit 0 on any error)

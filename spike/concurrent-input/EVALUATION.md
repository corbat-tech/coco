# Spike Evaluation: Concurrent Input Capture During Ora Spinner

## Problem Statement

Corbat-Coco needs to capture user keyboard input (e.g., interruptions, commands) while
an Ora spinner is actively rendering to stdout. The previous implementation using
Node.js `readline` failed because `readline` attempts to manage both `stdin` AND
`stdout`, creating conflicts with Ora's ANSI escape sequence output.

## Evaluation Criteria

| Criterion            | Weight | Description                                        |
| -------------------- | ------ | -------------------------------------------------- |
| Dependency footprint | 25%    | Number and size of new dependencies introduced      |
| ESM compatibility    | 20%    | Native ESM support without CJS shims               |
| Ora coexistence      | 25%    | Ability to run alongside Ora without visual glitches |
| Control granularity  | 15%    | Fine-grained enable/disable of input capture        |
| Maintenance burden   | 15%    | Long-term cost of maintaining the solution           |

---

## Options Evaluated

### Option 1: Ink (React for Terminal)

**Package**: `ink` (+ `react`, `yoga-layout`)

**Approach**: Replace the entire terminal rendering pipeline with Ink's React-based
component model. Input handling would use Ink's built-in `useInput` hook.

**Analysis**:

- Requires adopting React as a runtime dependency for a CLI tool.
- Yoga layout engine adds significant bundle weight (~4 MB).
- Would force a full rewrite of all terminal output, not just input capture.
- Ora would need to be replaced with a custom Ink spinner component.
- Overly broad solution for a narrow problem.

| Criterion            | Score | Notes                                       |
| -------------------- | ----- | ------------------------------------------- |
| Dependency footprint | 2/10  | React + Yoga + Ink = heavy dependency chain |
| ESM compatibility    | 7/10  | Ink v4+ supports ESM                        |
| Ora coexistence      | 3/10  | Cannot coexist; replaces Ora entirely       |
| Control granularity  | 5/10  | Hook-based, tied to React lifecycle         |
| Maintenance burden   | 3/10  | Entire rendering model changes              |

**Score: 45/100**

---

### Option 2: Blessed (TUI Framework)

**Package**: `blessed`

**Approach**: Use Blessed's full terminal UI toolkit which includes built-in input
handling, window management, and event systems.

**Analysis**:

- Full TUI framework designed for complex terminal applications (panels, scrolling, etc.).
- Massively over-scoped for capturing keypresses during a spinner.
- Not ESM compatible -- published as CommonJS only with no migration path.
- Last meaningful update was years ago; effectively unmaintained.
- Would conflict with Ora's direct stdout writes.

| Criterion            | Score | Notes                                          |
| -------------------- | ----- | ---------------------------------------------- |
| Dependency footprint | 2/10  | Heavy TUI framework, many transitive deps      |
| ESM compatibility    | 1/10  | CJS only, no ESM build available               |
| Ora coexistence      | 3/10  | Takes over terminal rendering                  |
| Control granularity  | 4/10  | All-or-nothing terminal control                |
| Maintenance burden   | 2/10  | Unmaintained, would require forking eventually |

**Score: 30/100**

---

### Option 3: terminal-kit

**Package**: `terminal-kit`

**Approach**: Use terminal-kit's input event system (`terminal.grabInput()`) to capture
keypresses while Ora renders independently.

**Analysis**:

- Good input handling API with keypress detection and buffering.
- Conflicts with Ora's ANSI control sequences -- terminal-kit also writes ANSI escapes
  for cursor management, causing visual corruption when both are active.
- Not ESM native; requires interop or a wrapper.
- Large package with many features unused for this use case.

| Criterion            | Score | Notes                                               |
| -------------------- | ----- | --------------------------------------------------- |
| Dependency footprint | 4/10  | Large package, most features unused                 |
| ESM compatibility    | 4/10  | CJS primary, ESM requires interop                   |
| Ora coexistence      | 5/10  | ANSI conflicts with Ora's cursor control            |
| Control granularity  | 7/10  | `grabInput` / `ungrabInput` provides toggle control |
| Maintenance burden   | 5/10  | Active project but large surface area               |

**Score: 50/100**

---

### Option 4: Custom Raw Mode (stdin only)

**Approach**: Use `process.stdin.setRawMode(true)` with manual keypress accumulation.
No new dependencies. Full control over when to enable and disable input capture.

**Analysis**:

- Zero new dependencies -- uses only Node.js built-in APIs.
- Can coexist with Ora because the two operate on separate streams:
  - **Ora** writes to `stdout` (spinner frames, ANSI cursor control).
  - **Custom raw mode** reads from `stdin` (keypress events).
- `stdin` and `stdout` are independent streams in Node.js. Reading `stdin` does not
  interfere with `stdout` writes.
- The previous `readline` approach failed specifically because `readline.createInterface`
  manages **both** `stdin` and `stdout`, injecting cursor movement sequences into the
  same `stdout` stream Ora uses.
- Ora's internal design supports this: it uses `ora.clear()` + write + `ora.render()`
  to update frames, never touching `stdin`.
- Full control over the lifecycle: enable raw mode when spinner starts, disable when
  spinner stops, accumulate keypresses in a buffer for later processing.

**Implementation sketch**:

```typescript
function enableInputCapture(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", handleKeypress);
  }
}

function disableInputCapture(): void {
  if (process.stdin.isTTY) {
    process.stdin.removeListener("data", handleKeypress);
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

function handleKeypress(data: Buffer): void {
  const key = data.toString();
  // Ctrl+C
  if (key === "\x03") {
    process.exit(0);
  }
  // Accumulate input for later processing
  inputBuffer.push(key);
}
```

| Criterion            | Score  | Notes                                           |
| -------------------- | ------ | ----------------------------------------------- |
| Dependency footprint | 10/10  | Zero dependencies, Node.js built-ins only       |
| ESM compatibility    | 10/10  | Native Node.js APIs, no module format concerns  |
| Ora coexistence      | 9/10   | Separate streams, no interference               |
| Control granularity  | 9/10   | Full manual control of enable/disable lifecycle |
| Maintenance burden   | 8/10   | Small surface area, well-understood APIs        |

**Score: 92/100**

---

## Comparison Summary

| Option                 | Score  | Deps Added | ESM  | Ora Compatible |
| ---------------------- | ------ | ---------- | ---- | -------------- |
| Ink (React for CLI)    | 45/100 | 3+         | Yes  | No (replaces)  |
| Blessed (TUI)          | 30/100 | 1+         | No   | No (conflicts) |
| terminal-kit           | 50/100 | 1          | No   | Partial        |
| **Custom raw mode**    | 92/100 | **0**      | Yes  | **Yes**        |

---

## Recommendation: Option 4 -- Custom Raw Mode

### Justification

1. **Zero new dependencies.** Aligns with the project's preference for minimal dependency
   footprint and avoids supply chain risk.

2. **Full control over stdin lifecycle.** Raw mode can be toggled on/off precisely when
   needed -- enabled during long-running operations, disabled when Clack prompts need
   stdin.

3. **Ora handles stdout gracefully.** Ora's internal rendering cycle (`clear -> write ->
   render`) never touches `stdin`. The two systems operate on independent I/O streams.

4. **stdin and stdout are separate streams.** This is the fundamental insight: reading
   from `stdin` in raw mode does not interfere with ANSI escape sequences being written
   to `stdout`. The previous `readline` failure was caused by `readline` managing both
   streams simultaneously.

5. **Previous failure root cause is resolved.** The `readline` module's
   `createInterface({ input: stdin, output: stdout })` binds both streams, injecting its
   own cursor management into `stdout` and conflicting with Ora. Custom raw mode avoids
   this entirely by only touching `stdin`.

### Risks and Mitigations

| Risk                                  | Mitigation                                          |
| ------------------------------------- | --------------------------------------------------- |
| Forgetting to disable raw mode        | Wrap in try/finally; register process exit handler   |
| Ctrl+C not handled in raw mode        | Explicitly check for `\x03` in keypress handler     |
| Interaction with Clack prompts        | Disable raw mode before any Clack prompt; re-enable after |
| Edge cases on Windows terminals       | Test on Windows; `isTTY` guard prevents non-TTY failures |

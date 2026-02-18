# Spike Results: Concurrent Input Capture

**Spike**: Concurrent input capture during Ora spinner rendering
**Status**: Complete
**Recommendation**: Custom raw mode (`process.stdin.setRawMode`)
**Confidence**: High

---

## Summary

The spike investigated four approaches for capturing user input while an Ora spinner is
actively rendering. The core challenge is that Ora continuously writes ANSI escape
sequences to `stdout` for spinner animation, and naive input handling (e.g., `readline`)
interferes with this output.

**Winning approach**: Custom raw mode using `process.stdin.setRawMode(true)` with manual
keypress accumulation. This approach scores 92/100 and requires zero new dependencies.

---

## Key Finding: Stream Separation

The most important finding from this spike is the **stream separation principle**:

- `stdin` (input) and `stdout` (output) are independent streams in Node.js.
- Ora only writes to `stdout`. It never reads from or configures `stdin`.
- Reading from `stdin` in raw mode does not affect `stdout` writes.

The previous implementation using `readline` failed because `readline.createInterface`
binds **both** `stdin` and `stdout`, injecting cursor movement ANSI sequences into the
output stream. This collided with Ora's own ANSI sequences, causing visual corruption.

Custom raw mode avoids this by only managing `stdin`, leaving `stdout` entirely under
Ora's control.

---

## Scores at a Glance

| #   | Option           | Score  | Verdict                                |
| --- | ---------------- | ------ | -------------------------------------- |
| 1   | Ink              | 45/100 | Too heavy; replaces entire render pipe |
| 2   | Blessed          | 30/100 | Unmaintained; CJS only; over-scoped    |
| 3   | terminal-kit     | 50/100 | ANSI conflicts with Ora; CJS primary   |
| 4   | Custom raw mode  | 92/100 | Zero deps; stream separation; full control |

---

## Implementation Path

The recommended implementation involves three components:

### 1. Input Capture Module

A small module (~50 LOC) providing `enableInputCapture()` and `disableInputCapture()`
functions. When enabled, `stdin` is set to raw mode and keypresses are accumulated in a
buffer. When disabled, `stdin` returns to its normal state.

### 2. Integration Points

- **Enable** raw mode when a long-running operation starts (spinner begins).
- **Disable** raw mode before any interactive prompt (Clack) needs `stdin`.
- **Re-enable** after the prompt completes if the operation is still running.
- **Process the buffer** after the operation completes to handle any accumulated input.

### 3. Safety Mechanisms

- `Ctrl+C` (`\x03`) must be explicitly handled in the keypress handler since raw mode
  disables the default SIGINT behavior.
- A `process.on("exit")` handler should restore `stdin` to normal mode to prevent the
  terminal from being left in a broken state.
- `try/finally` blocks around enable/disable to guarantee cleanup.

---

## What Was Ruled Out and Why

| Approach    | Primary Rejection Reason                                               |
| ----------- | ---------------------------------------------------------------------- |
| `readline`  | Manages both stdin and stdout; ANSI conflicts with Ora                 |
| Ink         | Requires React runtime; replaces entire terminal rendering             |
| Blessed     | CJS only; unmaintained; takes over full terminal                       |
| terminal-kit| ANSI cursor control conflicts with Ora; not ESM native                 |

---

## Next Steps

1. Implement the input capture module in `src/tools/` or `src/cli/`.
2. Write tests verifying enable/disable lifecycle and `Ctrl+C` handling.
3. Integrate with the orchestrator's long-running task execution.
4. Validate on macOS, Linux, and Windows terminals.

---

## References

- [Node.js TTY documentation](https://nodejs.org/api/tty.html)
- [Ora source: clear/render cycle](https://github.com/sindresorhus/ora)
- Spike evaluation details: [EVALUATION.md](./EVALUATION.md)

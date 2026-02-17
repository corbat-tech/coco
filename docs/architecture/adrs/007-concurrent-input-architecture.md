# ADR-007: Concurrent Input Architecture

## Status

Accepted

## Date

2026-02-17

## Context

Corbat-Coco is an autonomous coding agent (TypeScript, ESM, Node.js 22+) that executes multi-step workflows including LLM calls, tool invocations, and quality iterations. During these execution phases, the terminal is occupied by an Ora spinner providing visual feedback, and the custom input handler (`src/cli/repl/input/handler.ts`) is paused via `pause()` which disables raw mode on stdin.

Users need to send messages or instructions while the agent is actively executing. Common scenarios include:

1. **Abort**: Cancelling a long-running operation
2. **Modify**: Changing the direction of an in-progress task
3. **Correct**: Providing additional context or fixing a misunderstanding
4. **Inform**: Supplying information the agent needs to continue

The previous implementation (v1.5/v1.6) attempted to use Node.js `readline` to capture input during agent execution. This approach failed because:

- `readline` and Ora both write to stdout, causing visual corruption (duplicated lines, garbled spinner text)
- `readline`'s stdout management conflicts with Ora's ANSI cursor manipulation
- Attempts to coordinate the two through `logUpdate` and debouncing introduced further complexity without resolving the fundamental conflict (see commits `8d480f9`, `7bff5a6`, `3b335b5`)

The existing input handler already uses raw mode for full keystroke control during prompt input, with `pause()`/`resume()` methods that disable raw mode during agent execution. This pause window is the target for concurrent input capture.

## Decision

We will use **custom raw mode stdin capture** with zero new dependencies to enable concurrent user input during agent execution.

The architecture separates concerns into three subsystems:

### 1. Raw Mode Stdin Capture

During agent execution (when the input handler is paused), enable raw mode on stdin independently to capture keystrokes. Keystrokes are accumulated in a silent buffer without echoing to stdout, preventing any interference with Ora's spinner output.

On Enter keypress, the completed line is moved from the keystroke buffer to a message queue.

### 2. Message Queue

A simple FIFO queue stores captured messages with timestamps. The queue is consumed by the agent loop, which checks for pending messages at natural breakpoints (between tool calls, between iterations).

### 3. Interruption Classification and Processing

Captured messages are classified by type using keyword matching:

- **abort**: Keywords like "stop", "cancel", "abort" trigger execution cancellation
- **modify**: Keywords like "change", "instead", "actually" signal a direction change
- **correct**: Keywords like "no", "wrong", "fix" indicate a correction
- **info**: Everything else is treated as supplementary information

### 4. Visual Feedback via Ora

After capturing a message, the Ora spinner text is briefly updated to show a confirmation (e.g., "Message queued: ..."), then the original spinner text is restored. This provides feedback without disrupting the spinner animation or requiring stdout writes that could collide with Ora.

### Directory Structure

```
src/cli/repl/input/
  concurrent-capture-v2.ts    # Raw mode stdin capture during agent execution
  message-queue.ts            # FIFO message queue with timestamps
  types.ts                    # Shared interfaces

src/cli/repl/interruptions/
  classifier.ts               # Classify interruption type from message text
  processor.ts                # Process classified interruptions
  types.ts                    # InterruptionType enum and interfaces

src/cli/repl/feedback/
  feedback-system.ts          # Visual feedback for captured messages
  types.ts                    # Feedback interfaces
```

### Data Flow

```
User types during agent execution
  -> stdin (raw mode, no echo)
  -> keystroke buffer (silent accumulation)
  -> Enter keypress detected
  -> message-queue (FIFO with timestamp)
  -> Ora spinner briefly shows confirmation
  -> agent loop checks queue at breakpoints
  -> classifier determines interruption type
  -> processor executes appropriate action
```

## Rationale

### Why Raw Mode?

The existing input handler already proves that raw mode works reliably in this codebase. The handler uses `process.stdin.setRawMode(true)` during prompt input and captures all keystrokes via `process.stdin.on('data', ...)`. Reusing this same mechanism for concurrent capture means:

- No new abstractions or dependencies
- Proven compatibility with the terminal environment
- Full control over which bytes are processed and which are ignored

### Why Silent (No Echo)?

Echoing keystrokes to stdout while Ora is animating would cause visual corruption. Ora uses ANSI escape sequences to overwrite its own line on each frame. Any stdout write from another source inserts content at the cursor position, breaking Ora's line tracking. Silent capture eliminates this class of bugs entirely.

### Why Keyword-Based Classification?

LLM-based classification would add latency and cost for every captured message. Keyword matching is instantaneous, deterministic, and sufficient for the four categories needed. The classifier can be upgraded to LLM-based classification later if more nuanced understanding is required.

### Why a Separate Queue?

Decoupling capture from processing allows the agent loop to consume messages at safe points. Processing an interruption mid-tool-call could leave the system in an inconsistent state. The queue ensures messages are held until the agent is ready to handle them.

## Alternatives Considered

### Alternative 1: Ink (React for Terminal)

**Description:** Replace the entire terminal UI with Ink, a React-based renderer for the terminal that handles concurrent input and output natively.

**Pros:**
- Mature library with built-in input/output separation
- Component-based UI model
- Active community and maintenance

**Cons:**
- Replaces the entire rendering stack (Ora, Clack, custom input handler)
- Heavy dependency (React runtime in a CLI tool)
- Would require rewriting all existing terminal output code
- Fundamentally different programming model from the current imperative approach

**Why rejected:** Too invasive. The scope of change is disproportionate to the problem. The existing rendering stack works well for everything except concurrent input.

### Alternative 2: Blessed

**Description:** Use Blessed, a curses-like terminal library for Node.js, to create separate input and output regions.

**Pros:**
- Full terminal window management
- Separate panels for input and output
- Mature and feature-rich

**Cons:**
- Not ESM compatible (CommonJS only), violating ADR-001
- Overkill for a single input capture feature
- Would conflict with Ora and Clack
- Large dependency surface

**Why rejected:** ESM incompatibility is a hard blocker per ADR-001. The library is also far more than what is needed.

### Alternative 3: terminal-kit

**Description:** Use terminal-kit for advanced terminal I/O with built-in input handling.

**Pros:**
- Rich input handling capabilities
- Screen buffer management
- Good documentation

**Cons:**
- Conflicts with Ora's ANSI control sequences
- Large dependency with many features unused
- Would need careful coordination to avoid double-writing to stdout

**Why rejected:** The ANSI control sequence conflict with Ora is the same fundamental problem as readline, just with a different library.

### Alternative 4: readline (Previous Approach)

**Description:** Use Node.js built-in `readline` module to create an interface during agent execution, as attempted in v1.5/v1.6.

**Pros:**
- No external dependencies
- Built into Node.js
- Well-documented API

**Cons:**
- `readline` manages its own stdout writes, conflicting with Ora
- Caused visual corruption: duplicated lines, garbled spinner text
- Multiple fix attempts (debouncing, `logUpdate` state resets, spinner visibility preservation) failed to resolve the fundamental conflict
- The stdout management model is incompatible with Ora's ANSI cursor manipulation

**Why rejected:** Proven failure through multiple implementation attempts. The architectural incompatibility between readline's stdout management and Ora's ANSI rendering cannot be resolved without abandoning one or the other.

## Consequences

### Positive

- Zero new dependencies added to the project
- Full control over stdin handling, matching the existing input handler pattern
- Proven coexistence with Ora (no stdout interference by design)
- The previous interruption handler pattern (`concurrent-capture-v2.ts`) can be reused and evolved
- Message queue decouples input capture from processing, enabling safe interruption handling
- Keyword-based classification is instantaneous with no LLM cost

### Negative

- Must handle raw mode edge cases: Ctrl+C (should still exit), special key sequences, multi-byte Unicode, bracketed paste
- No visual echo of typing during agent execution (by design, but may confuse users who expect to see what they type)
- Two raw mode lifecycle paths to maintain: one in the input handler for prompt input, one in the concurrent capture for agent execution
- Keyword-based classification may misclassify ambiguous messages

### Neutral

- The silent capture approach is similar to how background terminal multiplexers (tmux, screen) handle input to backgrounded processes
- The architecture can be extended to support multi-line input capture if needed in the future
- The message queue provides a natural audit trail for debugging user interactions during execution

## Implementation Notes

### Raw Mode Lifecycle

The concurrent capture must coordinate with the existing input handler:

```
Prompt Phase:     InputHandler.prompt()  -> raw mode ON  (handler owns stdin)
Agent Execution:  InputHandler.pause()   -> raw mode OFF (handler releases stdin)
                  ConcurrentCapture.start() -> raw mode ON  (capture owns stdin)
Agent Done:       ConcurrentCapture.stop()  -> raw mode OFF (capture releases stdin)
                  InputHandler.resume()  -> (ready for next prompt() call)
```

### Ctrl+C Handling

During concurrent capture, Ctrl+C (`\x03`) must still trigger process exit. The raw mode capture handler must check for this byte before any other processing.

### Ora Feedback Pattern

```typescript
function showMessageCaptured(ora: Ora, message: string): void {
  const originalText = ora.text;
  ora.text = `Message queued: "${message.slice(0, 40)}..."`;
  setTimeout(() => {
    ora.text = originalText;
  }, 2000);
}
```

### Queue Consumption

The agent loop checks the queue at safe breakpoints:

```typescript
async function agentLoop(queue: MessageQueue): Promise<void> {
  while (hasMoreWork()) {
    // Check for interruptions at natural breakpoints
    const message = queue.dequeue();
    if (message) {
      const type = classify(message);
      await processInterruption(type, message);
    }

    await executeNextStep();
  }
}
```

## Related Decisions

- ADR-001: TypeScript with ESM Modules (ESM compatibility requirement)
- ADR-002: Phase-Based Architecture (agent execution phases where concurrent input applies)

## References

- Node.js TTY documentation: `process.stdin.setRawMode()`
- Ora spinner library: ANSI escape sequence rendering model
- Git history: commits `ef675e6`, `d882ecb`, `94a8ebb` (concurrent input implementation and removal)
- Git history: commits `8d480f9`, `7bff5a6`, `3b335b5` (readline-based approach failures)

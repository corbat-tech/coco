---
name: provider-timeout-abort-classification
description: Fix for stream activity timeout being misclassified as user cancellation in corbat-coco providers
---

# Provider Stream Timeout Misclassified as User Cancellation

## Problem

When an activity-based stream timeout fires in a provider (anthropic.ts, openai.ts, codex.ts),
the code calls `stream.controller.abort()` to break the `for await` loop. The SDK then throws
an `AbortError` (or `APIUserAbortError`). In `agent-loop.ts`, `isAbortError()` catches this and
returns `abortReturn()` — treating it as a **user cancellation** instead of a retryable error.

Symptom: REPL shows `"Completed X tools before cancellation: [tool_name]"` and silently
returns to the prompt, without retrying. The user didn't press Ctrl+C — the LLM just took
too long (120s without activity).

## Root Cause

The `if (timeoutController.signal.aborted)` check that would throw the descriptive
`"Stream timeout: No response from LLM for 120s"` error runs AFTER the inner `try/finally`
block — but the `AbortError` from the SDK propagates through the `finally` and jumps directly
to the outer `catch (error)`, bypassing the check entirely.

```typescript
// ❌ BUG: timeoutController check never runs when abort fires
try {
  for await (const chunk of stream) { ... }
  yield { type: "done", ... };
} finally {
  clearInterval(timeoutInterval);
}

// This line is never reached when stream.controller.abort() fires:
if (timeoutController.signal.aborted) {
  throw new Error(`Stream timeout: ...`);  // ← dead code on timeout
}
} catch (error) {
  throw this.handleError(error);  // ← AbortError reaches here instead
}
```

## Solution

Declare `let timeoutTriggered = false` BEFORE the outer `try` block (so it's accessible in
`catch`). Set it to `true` in the `setInterval` callback. Check it in the `catch` block to
throw the descriptive timeout error instead of delegating to `handleError`.

```typescript
// ✅ FIX: timeoutTriggered flag accessible in catch scope
let timeoutTriggered = false;
try {
  // ...setup...
  const timeoutInterval = setInterval(() => {
    if (Date.now() - lastActivityTime > streamTimeout) {
      clearInterval(timeoutInterval);
      timeoutTriggered = true;          // ← set before abort
      timeoutController.abort();
    }
  }, 5000);

  try {
    for await (const chunk of stream) { ... }
    yield { type: "done", ... };
  } finally {
    clearInterval(timeoutInterval);
  }

  if (timeoutController.signal.aborted) {
    throw new Error(`Stream timeout: No response from LLM for ${streamTimeout / 1000}s`);
  }
} catch (error) {
  if (timeoutTriggered) {
    // Throw descriptive error — NOT AbortError — so agent-loop retries instead of aborting
    throw new Error(
      `Stream timeout: No response from LLM for ${(this.config.timeout ?? 120000) / 1000}s`,
    );
  }
  throw this.handleError(error);
}
```

## Why It Works

- `timeoutTriggered` is declared in the outer function scope, so it IS accessible in `catch`
  even though `timeoutController` (declared inside `try`) is not.
- A plain `Error("Stream timeout: ...")` does NOT match `isAbortError()` in agent-loop, so it
  goes through the retryable error path instead of `abortReturn()`.
- The REPL then retries automatically (up to `MAX_CONSECUTIVE_ERRORS` times) and shows the
  timeout message instead of silently cancelling.

## Affected Files

Apply to ALL streaming methods in each provider:
- `src/providers/anthropic.ts`: `stream()`, `streamWithTools()`
- `src/providers/openai.ts`: `streamWithTools()`, `streamViaResponses()`, `streamWithToolsViaResponses()`
- `src/providers/codex.ts`: uses `while(true)` + `if (timeoutController.signal.aborted) break`
  pattern instead — timeout check at top of loop works correctly, no fix needed there.

## Activation

Use this skill when you see:
- `"Completed X tools before cancellation"` without the user pressing Ctrl+C
- A new streaming method added to a provider that uses `stream.controller.abort()` for timeout
- Any provider timeout that shows abort/cancellation UX instead of retry UX
- Investigating why stream timeouts don't trigger retries

# ADR-008: Concurrent Input Feedback Mechanism

## Status

Accepted

## Date

2026-02-17

## Context

When users type messages during agent execution (concurrent input), they need visual confirmation that their message was captured. The challenge is providing feedback without interfering with the Ora spinner that's actively rendering on stdout.

Previous implementation (v1.5/v1.6) used `console.log()` for feedback, which caused visual corruption and spinner duplication.

## Decision

Use **spinner text substitution** as the primary feedback mechanism:

1. When a message is captured, temporarily replace the spinner text with a capture confirmation
2. Show the captured message preview (truncated to 50 chars) with a queue counter
3. After a configurable delay (default 2000ms), restore the original spinner text
4. Optionally emit a terminal bell character for audio feedback

### Implementation

```
src/cli/repl/feedback/
├── feedback-system.ts   # Spinner-based feedback
└── types.ts             # Configuration types
```

The `FeedbackSystem` takes a getter function `() => Spinner | null` to access the current active spinner without tight coupling.

### Visual Output

```
🥥 ↳ Queued (2): add tests please...  (instead of "Thinking...")
     ↑ restored to original after 2 seconds
```

## Consequences

### Positive

- Zero visual corruption (uses Ora's own update mechanism)
- No stdout writes outside Ora's control
- Configurable display duration and bell
- Clean separation from capture system via callback pattern

### Negative

- User cannot see characters as they type (by design — prevents corruption)
- Feedback is brief (2 seconds) and might be missed
- Only works when spinner is active (no-op otherwise)

## Alternatives Considered

1. **File logging** — requires separate terminal window, poor UX
2. **stderr logging** — interferes with error streams, unreliable across terminals
3. **OS notifications** — platform-dependent, too intrusive for frequent messages
4. **Terminal bell only** — no visual confirmation, insufficient feedback
5. **Status bar below spinner** — complex ANSI manipulation, fragile with varying terminal sizes

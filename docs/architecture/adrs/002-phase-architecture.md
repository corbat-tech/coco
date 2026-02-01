# ADR-002: Phase-Based Architecture (COCO Methodology)

## Status

Accepted

## Date

2024-01-15

## Context

We need to define how the agent processes a project from initial requirements to production-ready code. Key challenges:

1. Projects can be interrupted at any point (power loss, network issues)
2. Different stages require different types of reasoning
3. Progress needs to be trackable and resumable
4. Quality gates need to be enforced at boundaries

## Decision

We will implement a **four-phase architecture** called the COCO Methodology:

```
CONVERGE → ORCHESTRATE → COMPLETE → OUTPUT
```

Each phase is:
- **Distinct**: Clear boundaries and responsibilities
- **Checkpointed**: State saved at transitions
- **Resumable**: Can restart from any phase
- **Gate-controlled**: Must pass criteria to proceed

### Phase Definitions

| Phase | Purpose | Entry Criteria | Exit Criteria |
|-------|---------|----------------|---------------|
| **Converge** | Understand requirements | User input | Approved specification |
| **Orchestrate** | Plan architecture | Valid spec | Approved plan + backlog |
| **Complete** | Build with iteration | Valid backlog | All tasks pass quality |
| **Output** | Prepare deployment | Quality code | CI/CD + docs generated |

## Rationale

### Why Four Phases?

1. **Converge** separates understanding from building - avoids premature coding
2. **Orchestrate** ensures we plan before executing - reduces rework
3. **Complete** is where iteration happens - isolated complexity
4. **Output** handles deployment concerns - clean separation

### Why Not Continuous Flow?

A continuous, unbounded flow would make:
- Checkpointing harder (where do you save?)
- Recovery ambiguous (where do you resume?)
- Progress unclear (how far along are we?)

### Inspiration from OpenClaw

OpenClaw uses a similar phase-based approach for message handling:
1. Receive → Route → Process → Respond

Our phases map conceptually:
1. Receive requirements → Converge
2. Plan approach → Orchestrate
3. Execute with tools → Complete
4. Deliver result → Output

## Alternatives Considered

### Alternative 1: Single Loop

**Description:** One continuous loop that does everything.

```typescript
while (!done) {
  understand();
  code();
  test();
  improve();
}
```

**Pros:**
- Simpler implementation
- More flexible

**Cons:**
- Hard to checkpoint
- No clear progress indication
- Difficult to debug

**Why rejected:** Doesn't support reliable recovery.

### Alternative 2: Many Fine-Grained Phases

**Description:** 10+ phases for each distinct activity.

**Pros:**
- Very precise control
- Detailed progress

**Cons:**
- Overhead of phase transitions
- Complexity in state machine
- Over-engineering

**Why rejected:** Four phases provides enough granularity without complexity.

### Alternative 3: Event-Driven Without Phases

**Description:** Pure event-driven architecture with no explicit phases.

**Pros:**
- Maximum flexibility
- Natural async handling

**Cons:**
- Hard to reason about state
- Difficult to ensure ordering
- Complex recovery logic

**Why rejected:** Phases provide necessary structure for reliability.

## Consequences

### Positive

- Clear mental model for developers and users
- Natural checkpoint boundaries
- Easy progress reporting ("Phase 2/4: Orchestrate")
- Modular testing (test each phase independently)

### Negative

- Phase transitions add some overhead
- Rigid structure may not suit all workflows
- Need to handle edge cases at boundaries

### Neutral

- Each phase can be developed independently
- Phases can be extended without affecting others

## Implementation Notes

### State Machine

```typescript
type Phase = "converge" | "orchestrate" | "complete" | "output";

interface PhaseTransition {
  from: Phase;
  to: Phase;
  guard: () => Promise<boolean>;
  action: () => Promise<void>;
}
```

### Checkpoint Structure

```typescript
interface Checkpoint {
  phase: Phase;
  phaseState: PhaseSpecificState;
  timestamp: Date;
  canResume: boolean;
}
```

### CLI Mapping

```
coco init      → Starts Converge
coco plan      → Runs Converge + Orchestrate
coco build     → Runs Complete
coco deploy    → Runs Output
coco resume    → Resumes from last checkpoint
```

## Related Decisions

- ADR-003: Checkpoint and Recovery System
- ADR-004: Quality Convergence Algorithm

## References

- OODA Loop (Observe, Orient, Decide, Act)
- Scrum phases (Sprint Planning, Execution, Review)
- OpenClaw's message handling pipeline

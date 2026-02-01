# ADR-003: Quality Convergence Algorithm

## Status

Accepted

## Date

2024-01-15

## Context

The core value proposition of Corbat-Coco is producing **senior-level quality code**. We need an algorithm that:

1. Iterates on code until it meets quality standards
2. Knows when to stop iterating (convergence)
3. Prevents infinite loops
4. Provides measurable, reproducible quality metrics

## Decision

We will implement a **multi-dimensional quality scoring system** with a **convergence-based stopping criterion**.

### Quality Formula

```
STOP when:
  Score >= MIN_QUALITY (85) AND
  |Score[n] - Score[n-1]| < CONVERGENCE_THRESHOLD (2) AND
  n >= MIN_ITERATIONS (2)

OR when:
  n >= MAX_ITERATIONS (10)
```

### Quality Dimensions

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Correctness | 15% | Tests pass, logic correct |
| Completeness | 10% | All requirements met |
| Robustness | 10% | Edge cases handled |
| Readability | 10% | Code clarity |
| Maintainability | 10% | Easy to modify |
| Complexity | 8% | Cyclomatic complexity |
| Duplication | 7% | DRY score |
| Test Coverage | 10% | Line/branch coverage |
| Test Quality | 5% | Test meaningfulness |
| Security | 8% | No vulnerabilities |
| Documentation | 4% | Doc coverage |
| Style | 3% | Linting score |
| **Total** | **100%** | |

### Thresholds

```typescript
const THRESHOLDS = {
  // Minimum acceptable (must achieve)
  minimum: {
    overall: 85,
    testCoverage: 80,
    security: 100,  // No vulnerabilities allowed
  },

  // Target (aim for, not required)
  target: {
    overall: 95,
    testCoverage: 90,
  },

  // Algorithm parameters
  convergenceThreshold: 2,
  minIterations: 2,
  maxIterations: 10,
};
```

## Rationale

### Why 85 as Minimum?

- **Below 80**: Generally indicates missing tests or significant issues
- **80-85**: Acceptable for production, but room for improvement
- **85-90**: Good quality, typical of experienced developers
- **90-95**: Excellent, senior-level code
- **95+**: Exceptional, rare in practice

85 ensures "senior-level" baseline while being achievable.

### Why Convergence Detection?

Without convergence detection, the agent might:
1. Make changes that marginally improve one metric while degrading another
2. Oscillate between two similar solutions
3. Waste iterations on diminishing returns

Convergence (delta < 2) indicates we've reached a local optimum.

### Why Multi-Dimensional?

A single score could be gamed (e.g., high coverage but poor tests). Multiple dimensions ensure balanced quality across all aspects.

### Why Weighted?

Different dimensions have different importance:
- **Correctness** (15%): Wrong code is useless
- **Security** (8%): Vulnerabilities are critical but often binary
- **Style** (3%): Important but not critical

## Alternatives Considered

### Alternative 1: Fixed Iteration Count

**Description:** Always iterate exactly N times.

**Pros:**
- Simple to implement
- Predictable timing

**Cons:**
- May stop before quality achieved
- May continue past optimal solution

**Why rejected:** Doesn't adapt to problem difficulty.

### Alternative 2: Test-Only Quality

**Description:** Only consider test pass/fail and coverage.

**Pros:**
- Simple metric
- Easy to measure

**Cons:**
- Ignores readability, maintainability
- Tests can pass with poor code

**Why rejected:** Too narrow a definition of quality.

### Alternative 3: LLM Self-Assessment Only

**Description:** Ask the LLM "is this code good enough?"

**Pros:**
- Holistic evaluation
- Understands context

**Cons:**
- Subjective, not reproducible
- May have blind spots
- Hard to debug/improve

**Why rejected:** Need objective, measurable metrics.

### Alternative 4: User Approval for Each Iteration

**Description:** Human reviews each iteration.

**Pros:**
- Human quality judgment
- Maximum control

**Cons:**
- Defeats automation purpose
- Slow, requires attention

**Why rejected:** Goal is autonomous operation.

## Consequences

### Positive

- Predictable quality output
- Clear stopping criteria
- Measurable improvement per iteration
- Reproducible results

### Negative

- Quality scoring requires multiple tool invocations (slower)
- Some quality aspects are hard to measure (e.g., "elegance")
- Need to calibrate weights per project type

### Neutral

- Quality history provides debugging insights
- Metrics can be tuned per project

## Implementation Notes

### Scoring Pipeline

```typescript
async function score(files: string[]): Promise<QualityScores> {
  const [tests, lint, complexity, security, docs] = await Promise.all([
    runTests(files),
    runLinter(files),
    analyzeComplexity(files),
    scanSecurity(files),
    analyzeDocs(files),
  ]);

  return calculateScores({ tests, lint, complexity, security, docs });
}
```

### Convergence Check

```typescript
function hasConverged(history: number[]): boolean {
  if (history.length < MIN_ITERATIONS) return false;
  const latest = history[history.length - 1];
  const previous = history[history.length - 2];
  return Math.abs(latest - previous) < CONVERGENCE_THRESHOLD;
}
```

### Quality Report

Each iteration produces a quality report saved to `.coco/versions/task-XXX/vN/scores.json`:

```json
{
  "overall": 91,
  "dimensions": {
    "correctness": 95,
    "testCoverage": 94,
    ...
  },
  "iteration": 2,
  "converged": true,
  "meetsMinimum": true
}
```

## Related Decisions

- ADR-002: Phase-Based Architecture
- ADR-004: Checkpoint and Recovery System

## References

- Code Climate quality metrics
- SonarQube quality gates
- OpenClaw's tool result validation pattern

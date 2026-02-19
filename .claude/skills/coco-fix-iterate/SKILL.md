---
name: coco-fix-iterate
description: Iterative quality convergence loop with multi-agent architecture. Reviews, scores, fixes, and re-scores code until target quality is reached. Use /coco-fix-iterate [--score N] [--max-iterations N] [--single-agent] [focus].
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Task
---

# COCO Fix Iterate

Autonomous iterative quality loop that reviews, scores, plans fixes, applies them, verifies, and re-scores — repeating until the code reaches a target quality score.

Uses a **multi-agent architecture by default**: separate subagents for reviewing, fixing, and verifying. This prevents self-bias (an agent reviewing its own code tends to be lenient) and produces more objective results.

## How it works

This skill is **agent-implemented** — the agent reads the steps below and executes them autonomously. There is no standalone bash script.

```
/coco-fix-iterate
/coco-fix-iterate --score 90
/coco-fix-iterate --max-iterations 5 security
/coco-fix-iterate --single-agent                # disable multi-agent, use one agent for everything
```

## Input

- `$ARGUMENTS` may contain:
  - `--score N` — Target score threshold (default: 85)
  - `--max-iterations N` — Maximum iteration cycles (default: 10)
  - `--single-agent` — Disable multi-agent mode; one agent does everything (faster but less objective)
  - Remaining text = focus area (e.g., "security", "tests", "src/api/")

### Examples

```
/coco-fix-iterate                              # Full project, score >= 85, multi-agent
/coco-fix-iterate --score 90                   # Higher quality bar
/coco-fix-iterate --max-iterations 5 security  # Focus on security, max 5 rounds
/coco-fix-iterate --single-agent               # One agent does everything (faster)
/coco-fix-iterate src/api/                     # Focus on specific directory
```

## Parse Arguments

```bash
# Default values
TARGET_SCORE=85
MAX_ITERATIONS=10
MULTI_AGENT=true          # Multi-agent ON by default
FOCUS=""

# Parse from $ARGUMENTS
# --score N -> TARGET_SCORE=N
# --max-iterations N -> MAX_ITERATIONS=N
# --single-agent -> MULTI_AGENT=false
# remaining text -> FOCUS
```

## Multi-Agent Architecture

By default, each iteration uses **3 specialized subagents** via the `Task` tool, each with a distinct role and restricted scope. This separation forces objectivity: the reviewer never sees the fixer's reasoning, and the verifier has no bias toward the fixes.

```
┌─────────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR (this agent)                                      │
│  Controls the loop, tracks scores, checks convergence           │
│                                                                 │
│  For each iteration:                                            │
│                                                                 │
│    ┌──────────────────┐                                         │
│    │  REVIEWER AGENT   │  Task(subagent_type="general-purpose") │
│    │  Read-only        │  - Reads code, runs checks             │
│    │  No editing       │  - Scores 12 dimensions                │
│    │                   │  - Classifies issues P0-P3             │
│    │  Returns: score,  │  - Returns structured report           │
│    │  issues, plan     │  - Has NO context of previous fixes    │
│    └────────┬─────────┘                                         │
│             │                                                   │
│             ▼                                                   │
│    ┌──────────────────┐                                         │
│    │  FIXER AGENT      │  Task(subagent_type="general-purpose") │
│    │  Can edit files   │  - Receives ONLY the issue list        │
│    │  No reviewing     │  - Applies fixes P0 → P1 → P2         │
│    │                   │  - Max 5-7 fixes per iteration         │
│    │  Returns: list    │  - Returns list of changes made        │
│    │  of changes       │  - Has NO access to scores             │
│    └────────┬─────────┘                                         │
│             │                                                   │
│             ▼                                                   │
│    ┌──────────────────┐                                         │
│    │  VERIFIER AGENT   │  Task(subagent_type="general-purpose") │
│    │  Read-only        │  - Runs full test suite                │
│    │  No editing       │  - Checks nothing is broken            │
│    │                   │  - Reports pass/fail per check         │
│    │  Returns: test    │  - Has NO context of what was fixed    │
│    │  results          │  - Objective "does it work?" answer    │
│    └──────────────────┘                                         │
│                                                                 │
│  Orchestrator evaluates results → convergence check → next iter │
└─────────────────────────────────────────────────────────────────┘
```

### Why multi-agent is better

| Aspect | Single agent | Multi-agent (default) |
|---|---|---|
| **Review objectivity** | Tends to be lenient with own code | Fresh eyes, no self-bias |
| **Fix quality** | May over-engineer based on review context | Focused only on the issue list |
| **Verification** | May skip tests it "knows" pass | Runs everything blindly |
| **Token efficiency** | One large context | Smaller focused contexts |
| **Speed** | Faster (no subagent overhead) | Slightly slower per iteration |

### When to use `--single-agent`

- Quick fixes on small codebases
- When token budget is limited
- When you need speed over objectivity
- Prototypes or spikes

## Algorithm

```
ITERATION = 0
PREVIOUS_SCORE = 0
SCORE_HISTORY = []

while ITERATION < MAX_ITERATIONS:
    ITERATION += 1

    # 1. REVIEW (Reviewer Agent or self)
    score, issues = review(FOCUS)
    SCORE_HISTORY.append(score)

    # 2. CHECK CONVERGENCE
    if score >= TARGET_SCORE and |score - PREVIOUS_SCORE| < 2:
        CONVERGED → STOP
    if is_oscillating(SCORE_HISTORY):
        OSCILLATING → STOP
    if is_diminishing(SCORE_HISTORY):
        DIMINISHING RETURNS → STOP

    # 3. PLAN FIXES (Orchestrator — P0 first, then P1, then P2)
    plan = prioritize(issues)

    # 4. APPLY FIXES (Fixer Agent or self)
    changes = fix(plan)

    # 5. VERIFY (Verifier Agent or self)
    if not verify():
        revert_last_fix()
        continue

    PREVIOUS_SCORE = score

REPORT final results
```

## Phase 1: Review (REVIEWER AGENT)

The orchestrator launches a **Reviewer Agent** via the `Task` tool:

```
Task(
  subagent_type = "general-purpose",
  prompt = """
  You are a CODE REVIEWER. Your job is to review and score this codebase.
  You are READ-ONLY — do NOT modify any files.

  FOCUS: {FOCUS or "entire project"}

  Step 1: Run automated checks
  {auto-detect and run: typecheck, lint, test}

  Step 2: Analyze code across 12 dimensions
  {dimension table with weights}

  Step 3: Score each dimension 0-100, calculate weighted total

  Step 4: Classify every issue found as P0/P1/P2/P3

  Return your results in this EXACT format:
  ---SCORE: XX
  ---ISSUES:
  - P0: [file:line] description
  - P1: [file:line] description
  ...
  ---DIMENSIONS:
  Correctness: XX
  Completeness: XX
  ...
  """
)
```

If `--single-agent` is set, the orchestrator performs this review itself instead of launching a subagent.

### 1.1 Automated Checks

The reviewer runs all available checks:

```bash
# Auto-detect project type and run checks
if [ -f "pnpm-lock.yaml" ]; then
  pnpm typecheck 2>&1 || true
  pnpm lint 2>&1 || true
  pnpm test 2>&1 || true
elif [ -f "yarn.lock" ]; then
  yarn typecheck 2>&1 || true
  yarn lint 2>&1 || true
  yarn test 2>&1 || true
elif [ -f "package-lock.json" ]; then
  npm run typecheck 2>&1 || true
  npm run lint 2>&1 || true
  npm test 2>&1 || true
elif [ -f "Cargo.toml" ]; then
  cargo clippy 2>&1 || true
  cargo test 2>&1 || true
elif [ -f "pyproject.toml" ]; then
  ruff check . 2>&1 || true
  pytest 2>&1 || true
elif [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
  ./gradlew check 2>&1 || true
fi
```

### 1.2 Manual Code Analysis

Read and analyze code across the 12 dimensions:

| Dimension | Weight |
|---|---|
| Correctness | 15% |
| Completeness | 10% |
| Robustness | 10% |
| Readability | 10% |
| Maintainability | 10% |
| Complexity | 8% |
| Duplication | 7% |
| Test Coverage | 10% |
| Test Quality | 5% |
| Security | 8% |
| Documentation | 4% |
| Style | 3% |

### 1.3 Score and Classify

Calculate weighted score. Classify all issues by severity (P0/P1/P2/P3).

### 1.4 Display Iteration Header

The orchestrator displays:

```
╔══════════════════════════════════════╗
║  ITERATION 1 / 10        [3 agents] ║
║  Score: XX/100 (Grade X)            ║
║  Target: 85  |  Issues: N           ║
║  P0: N  P1: N  P2: N  P3: N        ║
╚══════════════════════════════════════╝
```

## Phase 2: Convergence Check (ORCHESTRATOR)

The orchestrator (not a subagent) checks if we should stop:

### 2.1 Target Reached
```
IF score >= TARGET_SCORE AND |score - previous_score| < 2:
  → STOP (converged)
```

### 2.2 Excellent Quality
```
IF score >= 95:
  → STOP (target_reached — excellent quality)
```

### 2.3 Oscillating
```
IF last 4 scores alternate up/down with delta < 3:
  → STOP (oscillating — no further progress possible)
```

### 2.4 Diminishing Returns
```
IF last 3 improvements are all < 1 point:
  → STOP (diminishing_returns)
```

### 2.5 Stuck Below Minimum
```
IF iteration >= 5 AND score < TARGET_SCORE - 20 AND no improvement in 3 iterations:
  → STOP (stuck — needs manual intervention)
```

### 2.6 Max Iterations
```
IF iteration >= MAX_ITERATIONS:
  → STOP (max_iterations)
```

## Phase 3: Plan Fixes (ORCHESTRATOR)

The orchestrator creates the fix plan from the reviewer's output. This stays in the orchestrator to maintain control:

1. **Select issues to fix this iteration** — prioritize:
   - All P0 (Critical) issues — always fix these
   - P1 (High) issues — fix as many as feasible
   - P2 (Medium) — fix only if P0 and P1 are clear
   - Never fix P3 in the loop (cosmetic, not worth the churn risk)

2. **Estimate impact** — focus on fixes that will improve the score the most:
   - Fixing a failing test (Correctness +15%)
   - Adding missing error handling (Robustness +10%)
   - Adding tests for uncovered code (Test Coverage +10%)

3. **Limit scope per iteration** — max 5-7 fixes per cycle to keep changes reviewable

## Phase 4: Apply Fixes (FIXER AGENT)

The orchestrator launches a **Fixer Agent** via the `Task` tool:

```
Task(
  subagent_type = "general-purpose",
  prompt = """
  You are a CODE FIXER. Your job is to apply specific fixes to this codebase.
  You receive a list of issues — fix them one by one.

  FIXES TO APPLY:
  1. P0: [file:line] description
  2. P1: [file:line] description
  ...

  RULES:
  - Fix ONLY the listed issues, nothing else
  - Minimal changes — fix the issue, not the neighborhood
  - Run typecheck after each fix to catch regressions
  - If a fix breaks something, revert it and skip to next
  - Max 5-7 fixes per session
  - Do NOT commit anything

  After all fixes, return this EXACT format:
  ---CHANGES:
  - FIXED: [file:line] description (what you changed)
  - SKIPPED: [file:line] description (why you skipped it)
  ---FILES_MODIFIED:
  - path/to/file1.ts
  - path/to/file2.ts
  """
)
```

If `--single-agent` is set, the orchestrator applies fixes itself.

### Fix Safety Rules

- **Never change more than needed** — fix the issue, not the neighborhood
- **If tests fail after a fix, revert** — a fix that breaks tests is not a fix
- **Track what was changed** — maintain a list of modified files and changes
- **Preserve git history** — do NOT commit during the loop (user decides when to commit)

## Phase 5: Verify (VERIFIER AGENT)

The orchestrator launches a **Verifier Agent** via the `Task` tool:

```
Task(
  subagent_type = "general-purpose",
  prompt = """
  You are a CODE VERIFIER. Your job is to check if this codebase works correctly.
  You are READ-ONLY — do NOT modify any files.

  Run the full check/test suite and report results.

  {auto-detect and run: typecheck, lint, test}

  Return this EXACT format:
  ---RESULT: PASS or FAIL
  ---CHECKS:
  - typecheck: PASS/FAIL (details)
  - lint: PASS/FAIL (details)
  - tests: PASS/FAIL (N passed, N failed)
  ---FAILURES:
  - description of each failure (if any)
  """
)
```

If `--single-agent` is set, the orchestrator runs verification itself.

### Verification outcomes

- If **PASS** → proceed to re-scoring (Phase 1 of next iteration)
- If **FAIL** → the orchestrator reverts the last fix that likely caused the failure, then re-runs verification
- If **still failing** → revert all fixes from this iteration and re-score at previous state

## Phase 6: Re-Score and Loop

Go back to Phase 1 with a **fresh Reviewer Agent** (new subagent, no memory of previous review). This is critical — a fresh reviewer ensures the score is objective and not influenced by knowing what was fixed.

Display the iteration header and score progression:

```
╔══════════════════════════════════════╗
║  ITERATION 3 / 10        [3 agents] ║
║  Score: 79/100 (Grade B) ↑ +7       ║
║  Target: 85  |  Issues: 8 (was 15)  ║
║  P0: 0  P1: 2  P2: 4  P3: 2        ║
║                                      ║
║  History: 65 → 72 → 79              ║
╚══════════════════════════════════════╝
```

## Final Report

When the loop stops (for any reason), present the final report:

```
## COCO Fix Iterate — Final Report

### Result
- **Status: CONVERGED** (or: MAX_ITERATIONS / OSCILLATING / DIMINISHING / STUCK)
- **Final Score: XX/100 (Grade X)**
- **Target: XX | Iterations: N/MAX**
- **Mode: multi-agent (3 agents/iteration)** or **single-agent**

### Score Progression

| Iter | Score | Delta | Issues | Fixes Applied | Agents |
|------|-------|-------|--------|---------------|--------|
| 1    | 65    | —     | 15     | —             | R+F+V  |
| 2    | 72    | +7    | 11     | 4             | R+F+V  |
| 3    | 79    | +7    | 8      | 3             | R+F+V  |
| 4    | 84    | +5    | 5      | 3             | R+F+V  |
| 5    | 86    | +2    | 3      | 2             | R+F+V  |

### Score Chart
  100 ┤
   90 ┤                          ●  target: 85
   80 ┤              ●     ●
   70 ┤        ●
   60 ┤  ●
      └────┬────┬────┬────┬────
           1    2    3    4    5

### Dimension Breakdown (Final)

| Dimension        | Start | Final | Change |
|------------------|-------|-------|--------|
| Correctness      | 60    | 95    | +35    |
| Security         | 40    | 90    | +50    |
| Test Coverage    | 50    | 85    | +35    |
| ...              | ...   | ...   | ...    |

### All Fixes Applied (N total)
- [x] P0: [file:line] Description
- [x] P1: [file:line] Description
- [x] P1: [file:line] Description
- ...

### Remaining Issues (N)
- P2: [file:line] Description
- P3: [file:line] Description

### Files Modified (N)
- path/to/file1.ts
- path/to/file2.ts

### Recommendations
- If score < target: "Run again with a higher --max-iterations or fix remaining P1 issues manually"
- If converged: "Code quality meets the target. Consider committing these changes."
```

## Important

- This skill runs **autonomously** — it does NOT pause for user confirmation between iterations
- It **does NOT commit** — all changes stay in the working tree for the user to review
- **Multi-agent is ON by default** — each iteration spawns 3 fresh subagents for objectivity
- Use `--single-agent` when you need speed over objectivity
- The default target score of **85** represents senior-level quality
- Use `--score 95` for production-critical code that needs excellent quality
- Use `--score 70` for prototypes or spikes where speed matters more
- If the score is stuck, the skill stops rather than making useless changes
- P3 (cosmetic) issues are **never fixed** in the loop to avoid unnecessary churn
- Each Reviewer Agent is **fresh** (no memory of previous iterations) to ensure unbiased scoring
- After completion, the user can run `/code-review` to independently verify the final score

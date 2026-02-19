# Agent Orchestration Rules — Common

## Available Agents

All agents live in `.claude/agents/`. Each has a specific role and should be used only for its intended purpose.

| Agent | Model | Primary Purpose | Trigger |
|-------|-------|----------------|---------|
| `planner` | opus | Break down complex features into actionable steps | Feature request, refactoring plan |
| `architect` | opus | System design, ADR creation, architectural decisions | New module, breaking interface change |
| `tdd-guide` | sonnet | Test-driven development — write tests before code | New feature, bug fix |
| `code-reviewer` | sonnet | 12-dimension quality review (min 85/100) | After writing or modifying code |
| `security-reviewer` | sonnet | OWASP checklist, API key safety, injection detection | Code handling user input, auth, shell |
| `e2e-runner` | sonnet | Integration tests for full COCO phase pipelines | Cross-phase changes, CLI changes |
| `refactor-cleaner` | sonnet | Safe refactoring: extract, rename, deduplicate, split | Files >500 LOC, functions >50 lines |
| `doc-updater` | sonnet | JSDoc, README, CHANGELOG, ADR generation | New exports, architectural changes |
| `database-reviewer` | sonnet | Schema design, N+1 detection, migration safety | DB schema, migrations, ORM queries |

## Two Agent Systems

corbat-coco has two distinct agent systems. They are complementary and serve different contexts.

### REPL Agents (`src/cli/repl/agents/`)

Spawned **programmatically** by corbat-coco itself during automated runs. Managed by `AgentManager.spawn(type, task)`.

Available types: `explore`, `plan`, `test`, `debug`, `review`, `architect`, `security`, `tdd`, `refactor`, `e2e`, `docs`, `database`

These agents run inside corbat-coco's REPL loop and are wired to the same LLM provider. They are created, tracked, and cancelled via the `AgentManager` API. You never invoke them by name in a conversation — they are infrastructure.

### Claude Code Agents (`.claude/agents/*.md`)

Invoked **interactively** by Claude during sessions via the Task tool. Available agents: `architect`, `code-reviewer`, `planner`, `security-reviewer`, `tdd-guide`, `e2e-runner`, `refactor-cleaner`, `doc-updater`, `database-reviewer`

These agents are markdown-defined sub-agents that Claude Code launches as sub-tasks. They run as separate Claude instances with their own system prompts and tool access. You invoke them by referencing the agent name in your task instructions.

### How to Choose

| Situation | Use |
|-----------|-----|
| You are writing TypeScript code that needs to spawn a background agent | REPL agents via `AgentManager` |
| You are in a Claude Code session and need specialized review or planning | Claude Code agents via Task tool |
| Automating cross-phase quality checks inside the COCO pipeline | REPL agents |
| Interactive code review, security audit, or TDD guidance during development | Claude Code agents |

The two systems share conceptual roles (e.g., both have an "architect" and a "security" agent) but they are **not interchangeable**. REPL agents are part of the autonomous runtime; Claude Code agents are part of the interactive development workflow.

## Decision Tree: When to Delegate vs. Handle Inline

### Use an Agent When

1. **The task requires specialized expertise** you don't need inline:
   - Security review → `security-reviewer`
   - Architecture design → `architect`

2. **The task is independently executable** without your current context:
   - Code quality review of a finished file → `code-reviewer`
   - Generating docs for completed API → `doc-updater`

3. **The task benefits from a fresh perspective**:
   - Quality review immediately after writing code (blind spots)
   - Security review of authentication code you just wrote

4. **Multiple parallel tasks have no dependencies between them**:
   - Review security + review docs simultaneously → launch both agents in parallel

### Handle Inline When

1. **The task is a simple single-step action** (no delegation overhead needed):
   - Reading a file → use `Read` tool directly
   - Checking lint → run `pnpm lint` inline

2. **The task requires your current conversation context**:
   - Answering a follow-up question about code you just wrote
   - Fixing a specific line pointed out by the user

3. **The delegation cost exceeds the benefit**:
   - Asking `doc-updater` to add a single JSDoc comment → just write it inline

## Mandatory Agent Usage (Proactive Triggers)

These situations REQUIRE delegation — do not handle inline:

| Situation | Required Agent |
|-----------|---------------|
| Feature implementation requested | `planner` (create plan first) |
| New file written or existing file modified | `code-reviewer` |
| Code touches auth, API keys, user input, shell commands | `security-reviewer` |
| Architectural decision with lasting impact | `architect` (produce ADR) |
| New feature requested (TDD project) | `tdd-guide` |
| E2E/integration failure | `e2e-runner` |
| File exceeds 500 LOC | `refactor-cleaner` |

## Multi-Agent Workflow Examples

### Feature Development Flow

```
1. planner     → Create phased implementation plan
                 (WAIT for user confirmation)
2. tdd-guide   → Write failing tests for the feature
3. (implement the feature)
4. code-reviewer + security-reviewer  ← PARALLEL
5. refactor-cleaner  (if code is complex)
6. doc-updater  → Add JSDoc, update CHANGELOG
```

### Architectural Change Flow

```
1. architect   → Design, produce ADR
2. planner     → Break into implementation steps
3. (implement each step)
4. code-reviewer → Review each module
5. e2e-runner  → Add integration tests for changed pipeline
6. doc-updater → Update ARCHITECTURE.md
```

### Code Quality Improvement Flow

```
1. refactor-cleaner  → Safe structural improvements
2. code-reviewer     → Score after refactoring
3. doc-updater       → Update JSDoc for moved/renamed exports
```

## Parallel Execution Pattern

Launch independent agents simultaneously. Do NOT wait for one before starting the other if they don't share dependencies.

```
# GOOD: Code review and security review are independent
Launch in parallel:
  Agent 1: code-reviewer — review src/providers/openai.ts
  Agent 2: security-reviewer — review src/providers/openai.ts

# BAD: Sequential when parallel is possible
First: code-reviewer reviews the file
Then: security-reviewer reviews the same file
```

When to launch in parallel:
- Different agents reviewing the same file from different angles
- Different agents reviewing different independent files
- `doc-updater` generating docs while `code-reviewer` reviews quality

When NOT to launch in parallel:
- `planner` must complete before implementation begins
- `code-reviewer` should run after code is written, not during
- `refactor-cleaner` before `code-reviewer` (review the final state)

## Passing Context Between Agents

### What to Include

When invoking an agent, provide:

1. **File paths** — Specific files to review, not "the codebase"
   ```
   Review src/providers/openai.ts and src/providers/types.ts
   ```

2. **The task scope** — What was changed and why
   ```
   We just added retry logic for rate limiting in the OpenAI provider.
   Review for correctness and error handling.
   ```

3. **Relevant constraints** — Project-specific context
   ```
   This project uses ESM imports with .js extensions.
   Min quality score is 85/100.
   ```

4. **What NOT to do** — Prevent scope creep
   ```
   Review only the new retry logic, not the entire provider interface.
   ```

### What to Exclude

- Entire conversation history — agents don't need it
- Code already reviewed in a previous agent call
- Configuration that's obvious from CLAUDE.md
- Context about other unrelated features

### Context Template

```
Agent: [agent-name]
Task: [1-2 sentences describing what to do]
Files: [explicit file paths]
Context: [what changed and why — 2-3 sentences max]
Constraint: [any non-obvious limitations]
```

## Quality Gate Integration

The `code-reviewer` agent uses corbat-coco's own 12-dimension quality model. Scores below 85/100 must be resolved before merging.

When `code-reviewer` returns a verdict:
- **APPROVED (≥85)**: Proceed to next step
- **NEEDS WORK (75-84)**: Fix HIGH issues, re-run `code-reviewer`
- **BLOCKED (<75)**: Fix CRITICAL/HIGH issues, re-run `code-reviewer`

Do not skip `code-reviewer` to save time. The quality gate exists to maintain the codebase above senior-level quality.

## Agent Selection Quick Reference

```
Writing new code?          → tdd-guide (tests first) or code-reviewer (after)
Planning complex feature?  → planner
Designing system?          → architect
Checking for bugs?         → code-reviewer
Checking for exploits?     → security-reviewer
Testing whole pipeline?    → e2e-runner
Cleaning up code?          → refactor-cleaner
Writing/updating docs?     → doc-updater
Reviewing DB schema?       → database-reviewer
```

## Anti-Patterns

### Anti-Pattern 1: Skipping planner for Complex Features
The planner exists to prevent wasted implementation effort. A 10-minute planning session prevents hours of wrong-direction coding.

```
# ❌ Jump straight to implementation
"I need a caching layer for LLM responses — let me start writing code"

# ✅ Plan first
"I need a caching layer for LLM responses — invoke planner agent first"
```

### Anti-Pattern 2: Running code-reviewer on Incomplete Code
The reviewer scores what it sees. Reviewing incomplete code wastes the review.

```
# ❌ Review during implementation
After writing 30% of the feature, invoke code-reviewer

# ✅ Review when complete
After the feature is complete and tests pass, invoke code-reviewer
```

### Anti-Pattern 3: Over-Delegating Simple Tasks
Not every action needs an agent. Use agents for judgment-intensive tasks.

```
# ❌ Delegation overhead exceeds benefit
Invoke doc-updater to add one @param to an existing JSDoc block

# ✅ Handle inline
Add the @param directly with the Edit tool
```

### Anti-Pattern 4: Agents Operating Without File Scope
Agents given "review the codebase" produce unfocused output. Scope them precisely.

```
# ❌ Too broad
"code-reviewer: review the providers"

# ✅ Precise scope
"code-reviewer: review src/providers/openai.ts — specifically the new
retry logic added in the chat() and chatWithTools() methods"
```

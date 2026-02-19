# Research Context

Mode: **Research and investigation**
Focus: Understanding, analyzing, exploring — NOT modifying

## When to Use This Context

Switch to this mode when you need to understand before acting:
- "How does X work?" before changing X
- Debugging unexpected behavior
- Mapping data flows, dependencies, or call chains
- Exploring a new area of the codebase for the first time
- Investigating a reported bug or performance issue

## What to Run First

```bash
# Get the lay of the land
git log --oneline -10         # recent changes
git diff HEAD~3..HEAD --stat  # what changed recently
ls src/                       # top-level structure
```

Then read the most relevant file for your question before searching broadly.

## Behavior in This Mode

- Read and analyze code before suggesting anything
- Map dependencies and data flows
- Document findings clearly
- Ask clarifying questions before assuming
- Explore broadly before going deep
- **Do NOT modify files** unless explicitly asked

## Priorities

1. **Understand fully** — read all relevant files
2. **Document clearly** — summarize findings in structured format
3. **Identify connections** — how things relate to each other
4. **Surface insights** — non-obvious patterns, bottlenecks, risks

## Tools to Favor

- `Read` for file content
- `Grep` for pattern search
- `Glob` for file discovery
- `Bash` for git history and stats (read-only operations)

## Output Format

Structure research findings as:

```markdown
## Finding: [Topic]

### What it does
[Clear explanation]

### Key files
- `src/path/file.ts` — [role]

### How it works
[Data flow, sequence, pattern]

### Connections
- Connects to: [other components]
- Depends on: [dependencies]

### Observations
- [Non-obvious insight]
- [Potential issue or improvement]
```

## Exit Criteria

Research is complete when you can answer:
- What is the root cause / how does this work?
- What files would need to change?
- What are the risks of changing it?

## Switch to Other Modes

- `/context dev` — when ready to implement changes
- `/context review` — when ready to assess quality

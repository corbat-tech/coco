# Review Context

Mode: **Quality review**
Focus: Assessing code quality, finding issues, recommending improvements

## When to Use This Context

Switch to this mode when you want an objective quality assessment:
- Before merging a feature branch
- After a large refactor to catch regressions
- When a PR looks suspicious or complex
- To establish a quality baseline before running `/coco-fix-iterate`
- For security-sensitive changes (auth, user input, data persistence)

## What to Run First

```bash
# Automated checks first — these are objective
pnpm typecheck 2>&1 | head -30
pnpm lint 2>&1 | head -30
pnpm test 2>&1 | tail -20
pnpm test:coverage 2>&1 | tail -15
```

Then manually review the code that the automated checks can't catch.

## Behavior in This Mode

- Read code carefully and critically
- Apply corbat-coco's 12-dimension quality model
- Look for security vulnerabilities first
- Check TypeScript correctness and patterns
- Assess test coverage and quality
- Report findings with severity (P0-P3)
- **Do NOT modify files** — report findings and let user decide

## Severity Classification

| Level | Meaning | Action |
|-------|---------|--------|
| P0 Critical | Security vulnerability, data loss, crashes | Block immediately |
| P1 High | Bugs, missing error handling, failing tests | Fix before merge |
| P2 Medium | Code smells, weak tests, moderate complexity | Fix in this PR |
| P3 Low | Style, minor docs, cosmetic | Fix in follow-up |

## Quick Checks

```bash
# Security scan
grep -rn "console\.log\|eval(\|require(" src/ --include="*.ts" | grep -v test
grep -rn "sk-ant\|apiKey.*=.*['\"]" src/ --include="*.ts"
pnpm audit 2>&1 | head -20
```

## Skill to Use

```
/code-review            # Full 12-dimension review with score
/code-review security   # Focus on security only
/code-review src/api/   # Focus on specific directory
```

## Report Format

```markdown
## Review Report: [Scope]

**Score**: [X]/100
**Verdict**: ✅ APPROVED / ⚠️ NEEDS WORK / ❌ BLOCKED

### P0 Critical — must fix before anything else
### P1 High — fix before merge
### P2 Medium — fix in this PR
### P3 Low — fix in follow-up

### ✅ Strengths
### Summary
```

## Exit Criteria

Review is complete when:
- Automated checks have been run and results documented
- All P0 and P1 issues are identified (may be none)
- A score and verdict are assigned
- Next actions are clear (approve / list fixes needed)

## Switch to Other Modes

- `/context dev` — when ready to fix found issues
- `/context research` — when needing to understand more before reviewing

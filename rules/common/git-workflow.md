# Git Workflow Rules

## Conventional Commits

All commits must follow this format:
```
type(scope): short description

[optional body]

[optional footer]
```

### Types
| Type | When to Use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code restructuring (no behavior change) |
| `test` | Adding or updating tests |
| `chore` | Build, deps, CI, config (no production code) |
| `docs` | Documentation only |
| `perf` | Performance improvement |
| `ci` | CI/CD changes |

### Scopes (corbat-coco)
`agents`, `tools`, `providers`, `quality`, `phases`, `cli`, `repl`, `config`, `mcp`, `skills`, `release`, `deps`

### Examples
```
feat(tools): add semantic-search tool with embeddings support
fix(providers): handle timeout correctly in Gemini provider
refactor(quality): extract complexity analyzer to separate module
chore(release): bump version to 1.10.0
test(agents): add unit tests for AgentManager spawn
```

## Branch Strategy

```
main          ← stable, tagged releases only
develop       ← integration branch (optional)
work/*        ← feature branches (created by /fork-project or /new-feature)
merge/*       ← merge-back branches (created by /merge-back)
```

## Workflow with corbat Skills

```bash
# Start new feature
/new-feature <feature-name>   # creates isolated copy

# Work in copy...

# Finish feature
/merge-back <feature-name>    # merges back to main repo
/finish-feature <feature-name> # full workflow: merge + review + cleanup

# Release
/release patch|minor|major
```

## Pre-Commit Checklist

Before every commit:
- [ ] `pnpm check` passes (typecheck + lint + tests)
- [ ] No `console.log` in production code
- [ ] No secrets in staged files
- [ ] CHANGELOG.md updated if user-facing change

## Pull Requests

- One feature/fix per PR — no mixing concerns
- Title follows conventional commit format
- Body includes: Summary, Test Plan, checklist
- All CI checks must pass before merge
- Squash merge preferred for clean history

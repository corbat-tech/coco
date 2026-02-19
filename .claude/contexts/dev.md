# Development Context

Mode: **Active development**
Focus: Implementation, coding, building features

## When to Use This Context

Switch to this mode when you are about to write or modify code:
- Implementing a new feature or fixing a bug
- Iterating on existing code
- After research/review identified what needs to change

## What to Run First

```bash
# Confirm current state is clean before starting
pnpm check
git status
```

If `pnpm check` fails, fix it before writing new code — don't build on a broken baseline.

## Behavior in This Mode

- Write code first, explain after (unless asked to explain first)
- Prefer working solutions over architecturally perfect ones
- Run tests after every change (`pnpm test src/path/`)
- Keep commits atomic and conventional

## Workflow by Task Type

| Task | Skill to use |
|------|-------------|
| New feature | `/tdd` (test-first) |
| Build/lint errors | `/build-fix` |
| Multi-file change | `/plan` first |
| Quality iteration | `/coco-fix-iterate` |
| Single-pass fix | `/code-fix` |

## Priorities

1. **Get it working** — passing tests, no TypeScript errors
2. **Get it right** — patterns, types, error handling
3. **Get it clean** — refactoring, documentation

## Quality Bar

- `pnpm check` must pass before any commit
- Test coverage must stay at or above current level
- No new `console.log` in production code
- No new `any` types

## corbat-coco Specific

When adding to corbat-coco itself:
- New tools → register in `src/tools/index.ts`
- New config → extend schema in `src/config/schema.ts`
- All imports use `.js` extension
- No CommonJS patterns

## Exit Criteria

Done when:
- `pnpm check` passes (typecheck + lint + test)
- New/changed code has tests
- No regressions in unrelated areas

## Switch to Other Modes

- `/context research` — explore/investigate before modifying
- `/context review` — assess quality after implementing

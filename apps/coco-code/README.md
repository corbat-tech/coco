# Coco Code

Coco Code is the trusted developer product built on Coco Runtime. It keeps the
full coding-agent tool surface: filesystem, shell, git, tests, quality checks,
worktrees, review workflows, and provider switching.

The source remains in `src/cli` during the monorepo transition. This app marks
the product boundary so runtime, tools, presets, and business agents can evolve
without weakening the existing coding agent.

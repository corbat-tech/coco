# Skills Guide

Skills are instruction files that Coco injects into its context to follow project-specific conventions, workflows, or standards. They activate automatically when the context matches or manually when you type `/skill-name` in the REPL.

---

## First 5 minutes

### Create your first skill

```bash
coco skills create api-conventions
```

This creates `.agents/skills/api-conventions/SKILL.md` in your project. Open it and add your instructions:

```markdown
---
name: "api-conventions"
description: "REST API design standards for this project"
version: "1.0.0"
metadata:
  category: coding
---

# API Conventions

When designing or modifying API endpoints:

1. Use kebab-case for URL paths: `/user-profiles`, not `/userProfiles`
2. Return `{ data, meta, error }` envelope for all responses
3. Use HTTP 422 for validation errors, not 400
4. Always include pagination for list endpoints
```

Coco picks it up automatically on the next session — no restart needed.

### Verify it was loaded

```bash
coco skills list
```

---

## Where to place skills

### Project skills (in your repo)

Skills in your repo apply to everyone working on the project.

| Directory | Agent | Priority |
|-----------|-------|----------|
| `.agents/skills/` | Coco native, shared standard | Highest (last scanned, always wins) |
| `.opencode/skills/` | OpenCode | 4th |
| `.gemini/skills/` | Gemini CLI | 3rd |
| `.codex/skills/` | Codex CLI | 2nd |
| `.claude/skills/` | Claude Code | Lowest (first scanned) |

When the same skill name exists in multiple directories, the higher-priority one wins. If you have a skill in both `.claude/skills/` and `.agents/skills/`, the `.agents/` version is used.

**Recommended:** use `.agents/skills/` for all new skills. It works with Coco and any other agent that adopts the standard.

### Global skills (personal, all projects)

```
~/.coco/skills/<skill-name>/SKILL.md
```

Global skills apply to every project on your machine. Good for personal preferences, editor conventions, or workflows you always use.

```bash
coco skills create my-git-workflow --global
```

---

## Coming from Claude Code

If you already have skills in `.claude/skills/`, Coco reads them automatically — nothing to migrate.

```
.claude/skills/
  my-skill/
    SKILL.md    ← Coco reads this
```

To make a skill available to all agents (not just Claude Code), move or copy it to `.agents/skills/`:

```bash
cp -r .claude/skills/my-skill .agents/skills/my-skill
```

---

## SKILL.md format

Every skill is a directory with a `SKILL.md` file. The frontmatter controls when and how the skill activates.

```markdown
---
name: "my-skill"
description: "One sentence: when should Coco use this skill?"
version: "1.0.0"
metadata:
  author: "your-name"
  tags: ["api", "rest"]
  category: coding
---

# My Skill

Your instructions here. Be specific and actionable.
```

### Frontmatter fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique skill ID, used as slash command: `/my-skill` |
| `description` | Yes | When Coco should use this skill (used for auto-activation matching) |
| `version` | No | Semantic version, default `1.0.0` |
| `metadata.category` | No | `coding`, `testing`, `deployment`, `documentation`, `workflow`, `custom` |
| `metadata.tags` | No | Keywords for search and matching |
| `metadata.author` | No | Skill author |

### Auto-activation

The `description` field drives automatic activation. When Coco starts a task that matches your description, it injects the skill without you asking. Write it as a trigger condition:

```yaml
description: "When writing or modifying REST API endpoints in this project"
```

### Manual activation

You can always activate a skill manually in the REPL:

```
/my-skill do the thing
```

---

## Namespaced skills

For larger projects or skill collections, you can namespace skills one level deep:

```
.agents/skills/
  team/
    api-conventions/
      SKILL.md
    testing-standards/
      SKILL.md
```

The skill ID becomes `api-conventions` (not `team/api-conventions`). The namespace directory is just for organization.

---

## Reference files

Skills can include a `references/` subdirectory with supplementary files that get attached to the context:

```
.agents/skills/api-conventions/
  SKILL.md
  references/
    openapi-template.yaml
    error-codes.md
```

---

## CLI commands

```bash
coco skills list                    # list all skills (builtin + global + project)
coco skills list --scope project    # only project skills
coco skills list --scope global     # only global skills
coco skills create <name>           # create in .agents/skills/ (interactive)
coco skills create <name> --global  # create in ~/.coco/skills/
coco skills add owner/repo          # install from GitHub
coco skills add ./path/to/skill     # copy from local path
coco skills remove <name>           # remove project skill
coco skills remove <name> --global  # remove global skill
coco skills info <name>             # show skill details and preview
```

---

## Examples

### Coding standards

```markdown
---
name: "coding-standards"
description: "TypeScript coding conventions for this project"
version: "1.0.0"
metadata:
  category: coding
---

# Coding Standards

- Use `const` by default, `let` only when reassignment is needed
- Prefer `async/await` over raw promises
- Export types explicitly: `export type { Foo }`
- File names: kebab-case (`user-service.ts`)
- No `any` — use `unknown` and narrow
```

### Git workflow

```markdown
---
name: "git-workflow"
description: "Commit and PR conventions for this project"
version: "1.0.0"
metadata:
  category: workflow
---

# Git Workflow

Commits follow Conventional Commits:
- `feat(scope): message` for new features
- `fix(scope): message` for bug fixes
- `chore(scope): message` for maintenance

PR titles must match the commit format.
Branch names: `feat/description`, `fix/description`.
```

### Test conventions

```markdown
---
name: "test-conventions"
description: "Testing standards and patterns for this project"
version: "1.0.0"
metadata:
  category: testing
---

# Test Conventions

- Use Vitest, not Jest
- Test files: `*.test.ts` colocated with source
- Describe blocks mirror the module structure
- Use `it` not `test` for individual cases
- Mock at the boundary, not deep in the call stack
- Every public function needs at least one test
```

---

## Resources

- [MCP Guide](../MCP.md) — connect external tools
- [Cookbook](COOKBOOK.md) — common workflows
- [Quick Start](QUICK_START.md)

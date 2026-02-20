# Coco Ecosystem Guide

Skills, MCP servers, and the tools that make Coco genuinely powerful. This guide explains what each layer does, when to use it, and which tools the community reaches for most.

---

## Contents

- [MCP vs Skills — what's the difference](#mcp-vs-skills--whats-the-difference)
- [Recommended Skills](#recommended-skills)
- [Recommended MCP Servers](#recommended-mcp-servers)
- [Use Case Flows](#use-case-flows)

---

## MCP vs Skills — what's the difference

Both extend what Coco can do, but they work at completely different levels.

| | Skills | MCP Servers |
|---|---|---|
| **What it is** | A reusable prompt saved as a file | An external process exposing tools via a protocol |
| **Where it runs** | Inside Coco's LLM context | As a separate process, accessed over stdio or HTTP |
| **What it gives the agent** | Instructions, workflows, best practices | Real capabilities: file access, DB queries, API calls, browser control |
| **Installed where** | `.coco/skills/` (project), `.agents/skills/` (shared cross-agent), `~/.coco/skills/` (user), `.claude/skills/` (Claude-compat) | Registered globally in `~/.coco/mcp.json` |
| **Examples** | `/ship`, `/coco-fix-iterate`, `/hotfix` | filesystem, postgres, github, playwright |
| **Invocation** | `/skill-name` or auto-matched from message | Transparent — agent uses MCP tools like any other tool |
| **Requires external process** | No | Yes |
| **Works offline** | Yes | Depends on the server |
| **Good for** | Encoding team workflows, conventions, repeatable procedures | Accessing real data, external systems, browser automation |

**Rule of thumb:**
- Use a **skill** when you want to teach Coco *how to do something* (a workflow, a process, your conventions).
- Use an **MCP server** when Coco needs to *interact with something real* (read a database, call an API, control a browser).

They compose well: a skill can instruct Coco to use MCP tools. For example, a `/deploy` skill can orchestrate a sequence of Playwright MCP actions to verify a staging environment.

---

## Recommended Skills

### Built-in (ship with Coco)

| Skill | Command | What it does |
|---|---|---|
| **clear** | `/clear` | Clear conversation history and reset context |
| **status** | `/status` | Current project state, quality scores, open tasks |
| **compact** | `/compact` | Compress conversation context while preserving key decisions |
| **review** | `/review` | Code review of current changes across correctness, security, and style |
| **diff** | `/diff` | Show and explain current changes |
| **ship** | `/ship` | Full release pipeline: preflight → review → tests → lint → bump version → branch → commit → PR → CI → merge |
| **open** | `/open` | Open a file or URL in the default application |
| **help** | `/help` | Show available commands and skills |

### Repository Skills (available in `.claude/skills/` in this repo)

These skills ship as SKILL.md files in `.claude/skills/` within the Coco repository. They are not currently installable from a public registry via `coco skills add`.

**How to use these skills:** Copy the skill directory from `.claude/skills/<name>/` into your own project's `.coco/skills/` directory, or add it globally to `~/.coco/skills/`.

```bash
# Copy coco-fix-iterate to your project
cp -r .claude/skills/coco-fix-iterate .coco/skills/

# Or install globally
cp -r .claude/skills/coco-fix-iterate ~/.coco/skills/
```

| Skill | What it does | Best for |
|---|---|---|
| **coco-fix-iterate** | Multi-agent quality loop: review → fix → verify, repeat until score ≥ 85 | Bringing legacy code up to quality standards |
| **tdd** | Enforce test-first workflow: scaffold → failing tests → implement → refactor | Greenfield features with quality guarantees |
| **security-review** | OWASP Top 10 audit with fix suggestions | Pre-release security gate |
| **preflight** | Pre-release validation: tests, lint, types, security | Before any merge to main |
| **new-feature** | Full TDD feature workflow from spec to tests to code | New endpoints, services, or modules |
| **release** | Structured release: CHANGELOG, version bump, PR, tag | Projects with formal release processes |
| **learn** | Extract reusable patterns from current session and save as skills | Building up a team skill library |
| **skill-create** | Analyze git history to auto-generate SKILL.md files | Automating skill capture from existing patterns |
| **hotfix** | Fast-track patch release with minimal checks | Urgent production fixes |
| **plan** | Create a structured plan for a feature or task | Upfront design before implementation |
| **coding-standards** | Enforce project coding conventions | Onboarding or code consistency reviews |
| **continuous-learning** | Capture lessons from the session into persistent skills | Growing the team skill library |
| **verification-loop** | Iterative verify-and-fix loop for a specific check | Targeted quality gates |
| **build-fix** | Diagnose and fix build failures | CI failures or local build errors |
| **code-review** | Structured code review with actionable feedback | PR review workflows |
| **finish-feature** | Complete a partially-implemented feature | Resuming interrupted work |
| **fork-project** | Fork and set up a copy of a project | Starting from an existing codebase |
| **merge-back** | Merge a feature branch back to main with cleanup | Branch lifecycle management |
| **release-pr** | Create a release pull request with changelog | Formal release workflows |
| **verify** | Run a verification suite and report results | Post-deploy or pre-release checks |

### Skill discovery — priority order

Coco scans for skills in the following directories. When the same skill name exists in more than one location, the **highest-priority** location wins:

```
Priority order (highest → lowest):
1. .coco/skills/         — project-level skills, committed to your repo
2. ~/.coco/skills/       — your personal global skills
3. ~/.claude/skills/     — Claude Code compatibility alias (lower priority than ~/.coco/skills/)
4. Built-in              — shipped with Coco
```

> **Note:** `.claude/skills/` at the project root is supported as a compatibility alias for Claude Code conventions. `~/.claude/skills/` (global) is also scanned but has lower priority than `~/.coco/skills/`.

---


### Creating a project skill

Any file in `.coco/skills/<name>/SKILL.md` becomes a `/name` command:

```bash
coco skills create deploy-staging
# → creates .coco/skills/deploy-staging/SKILL.md
```

Or manually:

```
.coco/skills/
└── seed-db/
    └── SKILL.md    ← /seed-db is now available to the whole team
```

---

## Recommended MCP Servers

### Filesystem & Storage

| Server | Install | What it does |
|---|---|---|
| **@modelcontextprotocol/server-filesystem** | `npx -y @modelcontextprotocol/server-filesystem <path>` | Read/write files outside the project directory |
| **@modelcontextprotocol/server-memory** | `npx -y @modelcontextprotocol/server-memory` | Persistent key-value memory across sessions |

```bash
coco mcp add filesystem \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-filesystem,/Users/you/Documents" \
  --description "Access documents outside the project"
```

### Databases

| Server | Install | What it does |
|---|---|---|
| **@modelcontextprotocol/server-postgres** | `npx -y @modelcontextprotocol/server-postgres` | Query and inspect PostgreSQL databases |
| **@modelcontextprotocol/server-sqlite** | `npx -y @modelcontextprotocol/server-sqlite` | Read/write SQLite databases |

```bash
coco mcp add postgres \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-postgres" \
  --env "DATABASE_URL=postgresql://localhost/mydb" \
  --description "Production read replica"
```

### Browser & Web

| Server | Install | What it does |
|---|---|---|
| **@playwright/mcp** | `npx -y @playwright/mcp` | Full browser automation via Playwright |
| **@modelcontextprotocol/server-puppeteer** | `npx -y @modelcontextprotocol/server-puppeteer` | Browser automation via Puppeteer (verify exact package name before installing) |

```bash
coco mcp add browser \
  --command "npx" \
  --args "-y,@playwright/mcp" \
  --description "Browser automation for E2E testing and verification"
```

### Version Control & CI

| Server | Install | What it does |
|---|---|---|
| **@modelcontextprotocol/server-github** | `npx -y @modelcontextprotocol/server-github` | Read PRs, issues, commits, create branches |
| **@modelcontextprotocol/server-gitlab** | `npx -y @modelcontextprotocol/server-gitlab` | GitLab API: issues, MRs, pipelines (verify exact package name before installing) |

```bash
coco mcp add github \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-github" \
  --env "GITHUB_TOKEN=ghp_YOUR_TOKEN_HERE" \
  --description "GitHub API access"
```

### Search & Knowledge

| Server | Install | What it does |
|---|---|---|
| **@modelcontextprotocol/server-brave-search** | `npx -y @modelcontextprotocol/server-brave-search` | Web search via Brave Search API |
| **@modelcontextprotocol/server-fetch** | `npx -y @modelcontextprotocol/server-fetch` | Fetch any URL and get its content |

### Productivity & Communication

| Server | Install | What it does |
|---|---|---|
| **@modelcontextprotocol/server-slack** | `npx -y @modelcontextprotocol/server-slack` | Read channels, post messages, search Slack (verify exact package name before installing) |
| **@modelcontextprotocol/server-google-drive** | `npx -y @modelcontextprotocol/server-google-drive` | Read and search Google Drive files (verify exact package name before installing) |

---

## Use Case Flows

Real workflows showing how Skills and MCP work together.

### Flow 1: Backend Developer — daily coding loop

**Setup:**
```bash
coco mcp add postgres --command "npx" --args "-y,@modelcontextprotocol/server-postgres" \
  --env "DATABASE_URL=$DATABASE_URL"
coco mcp add github --command "npx" --args "-y,@modelcontextprotocol/server-github" \
  --env "GITHUB_TOKEN=$GITHUB_TOKEN"
```

**Typical session:**
```
"What are the 5 slowest queries hitting the orders table in the last 24h?"
→ Coco queries postgres MCP, analyzes explain plans, suggests indexes

"Add a composite index on (customer_id, created_at). Write the migration."
→ Coco writes migration, tests it, runs /check to verify

"The PR #247 has review comments about the N+1 query. Fix them."
→ Coco reads PR via GitHub MCP, locates the code, applies fixes

/ship
→ Full release pipeline: tests → lint → PR → CI → merge
```

### Flow 2: Frontend Developer — build and verify UI

**Setup:**
```bash
coco mcp add browser --command "npx" --args "-y,@playwright/mcp"
```

**Typical session:**
```
"Implement the checkout form with validation. Use the design in Figma (paste screenshot)"
→ Coco reads screenshot, implements component with TypeScript + tests

"Open the dev server and take a screenshot of the checkout page on mobile viewport"
→ Coco uses browser MCP: navigates, resizes, screenshots

"The submit button is cut off on 375px. Fix it."
→ Coco fixes CSS, re-screenshots to confirm

/review
→ Code review focused on accessibility and responsive design
```

### Flow 3: DevOps — release and deployment verification

**Setup:**
```bash
coco mcp add github --command "npx" --args "-y,@modelcontextprotocol/server-github" \
  --env "GITHUB_TOKEN=$GITHUB_TOKEN"
coco mcp add browser --command "npx" --args "-y,@playwright/mcp"
```

**Typical session:**
```
/preflight
→ Runs all checks before release: tests, lint, types, security

/ship
→ Bumps version, creates PR, waits for CI, merges

"Verify the production deployment at https://app.example.com — check login, dashboard, and API health endpoint"
→ Coco uses browser MCP to navigate and verify each page
```

### Flow 4: Data Analyst — explore and fix data issues

**Setup:**
```bash
coco mcp add postgres --command "npx" --args "-y,@modelcontextprotocol/server-postgres" \
  --env "DATABASE_URL=$ANALYTICS_DB_URL"
coco mcp add filesystem --command "npx" \
  --args "-y,@modelcontextprotocol/server-filesystem,/Users/you/reports"
```

**Typical session:**
```
"Show me the conversion funnel for signups this week vs last week"
→ Coco queries the analytics DB, formats results as a table

"There are 2,340 users with NULL email. When did this start and why?"
→ Coco traces the issue through schema history and recent migrations

"Write a one-off migration to backfill emails from the audit log where possible"
→ Coco writes migration, runs it in dry-run first, asks for confirmation

"Save the funnel report as a CSV to ~/reports/"
→ Coco uses filesystem MCP to write the file outside the project
```

### Flow 5: Team Lead — bring legacy code to quality standard

**No MCP needed — skills only:**

Note: skill arguments are passed as natural text after the command, not as CLI flags.

```
/coco-fix-iterate
→ Multi-agent loop (default: score ≥ 85, full project):
  Iteration 1: Score 52 — 8 P0 issues, 12 P1 issues
  Iteration 2: Score 67 — fixes applied, tests written
  Iteration 3: Score 79 — security issues resolved
  Iteration 4: Score 86 — CONVERGED ✓

"Now document the public API of src/legacy/payment-processor.ts"
→ Coco adds JSDoc to all exported functions

/ship
→ PR created with quality improvement summary
```

---

## Composing Skills and MCP

The most powerful patterns combine both layers:

```
# A custom skill that uses MCP tools
.coco/skills/verify-staging/SKILL.md:

---
name: verify-staging
description: Deploy to staging and verify with browser automation
---

1. Run `./scripts/deploy.sh staging` and wait for it to complete
2. Use the browser MCP to navigate to https://staging.example.com
3. Check these pages load without errors: /, /login, /dashboard, /api/health
4. Take a screenshot of each page and report any visual issues
5. If all checks pass, report STAGING OK. If any fail, report the specific failure.
```

Then `/verify-staging` gives you a one-command deployment verification that orchestrates both a shell script and browser automation.

---

**Related guides:** [Cookbook](COOKBOOK.md) · [Configuration](CONFIGURATION.md) · [MCP Reference](../MCP.md)

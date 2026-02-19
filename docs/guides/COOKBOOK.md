# Coco Cookbook

Practical patterns for getting the most out of Coco day-to-day. This guide covers how to ask for things, how to use skills, MCP tools, and the workflows developers reach for most.

---

## Contents

- [Prompting patterns](#prompting-patterns)
- [Daily workflows](#daily-workflows)
- [Skills](#skills)
- [MCP tools](#mcp-tools)
- [Built-in tools](#built-in-tools)
- [Agents](#agents)
- [Quality tuning](#quality-tuning)
- [Tips & tricks](#tips--tricks)

---

## Prompting patterns

Coco understands natural language. You rarely need exact commands — say what you want and it figures out intent. That said, some patterns produce consistently better results.

### Be specific about scope

```
# Too vague — Coco has to guess
"fix the auth"

# Better — names the file and the symptom
"The login endpoint in src/auth/login.ts is returning 500 when the
password contains special characters. Fix it and add a test for that case."

# Best — includes acceptance criteria
"In src/auth/login.ts, fix the password validation so it accepts any
UTF-8 character. The current regex rejects anything outside [a-zA-Z0-9].
Add a test that exercises passwords with emoji, accents, and symbols."
```

### Ask for tests alongside the code

```
"Add a rate limiter middleware for the /api/v1/ routes.
Limit to 100 req/min per IP. Write unit tests and document the config options."
```

### Request a plan before execution

```
"Before writing any code, show me a plan for adding WebSocket support
to the notification service. I want to review the approach first."
```

Coco will lay out the architecture and wait for your go-ahead.

### Constrain the scope explicitly

```
"Refactor the UserRepository class only — don't touch the controller or
the service layer. Focus on making the query methods composable."
```

### Reference existing code directly

```
"Look at how pagination is implemented in src/products/products.service.ts
and apply the same pattern to src/orders/orders.service.ts"
```

### Ask for explanations

```
"Explain what the middleware chain in src/app.ts does, in plain English.
Then suggest what I should move to a separate file."
```

---

## Daily workflows

These are the patterns most developers reach for every day.

### Implement a feature

```
"Add email verification to the registration flow.
- Send a 6-digit code when a new user registers
- Code expires in 10 minutes
- Add the /verify-email endpoint
- Tests for success, expired code, and wrong code cases"
```

Coco writes, tests, and iterates until the quality score converges.

### Fix a bug

```
"Orders with status 'pending' are not showing up in /api/orders
when filtered by date range. The bug is in the date comparison logic.
Here is the relevant test that should pass: [paste test]"
```

Giving a failing test is the fastest way to guide a bug fix.

### Code review

```
/review
```

Or naturally:

```
"Review the changes in the last commit for security issues and
naming consistency. Be specific about line numbers."
```

### Check quality gate before committing

```
/check
```

Runs typecheck + lint + tests and reports inline. Equivalent to your CI but instant.

### Ship a release

```
/ship
```

Full pipeline: preflight checks → code review → tests → lint → bump version → branch → commit → PR → wait for CI → merge.

Each step is interactive. Press `Ctrl+C` anytime to stop safely.

### Understand unfamiliar code

```
"Walk me through how the checkpoint system works.
Start from where a checkpoint is created and trace through to recovery."
```

```
"What does the QualityEvaluator do with the AST results?
Explain it like I've never seen this codebase before."
```

### Refactor safely

```
"Refactor the 3 duplicated database connection setups in
src/users/, src/orders/, and src/products/ into a shared
createConnection() utility. Do not change behavior, only structure.
Run the tests after each change."
```

Telling Coco to run tests after each change prevents regressions during refactors.

### Generate tests for existing code

```
"Write tests for src/billing/invoice.ts.
It currently has 0% coverage. Aim for 80%+ lines.
Focus on the calculateTotal() and applyDiscount() functions."
```

### Update documentation

```
"The README's Quick Start section is stale — it still shows the old
coco init command. Update it to match the current coco command flow
and add an example for the --provider flag."
```

### Upgrade a dependency

```
"Upgrade express from 4.x to 5.x. Check the migration guide for
breaking changes and update the code accordingly. Run the test suite
and fix any failures."
```

---

## Skills

Skills are reusable prompts committed to your repo. They work like custom slash commands, auto-discovered from three locations.

### How discovery works

```
Priority (highest to lowest):
  1. .coco/skills/        ← project skills (in the repo)
  2. ~/.claude/skills/    ← your personal global skills
  3. built-in             ← shipped with Coco
```

### Using a built-in skill

```
/ship          # full release pipeline
/review        # code review
/check         # quality gate
/preflight     # pre-release validation only
/hotfix        # fast-track patch release
```

### Creating a project skill

Create `.coco/skills/seed-db.md` in your repo:

```markdown
---
name: seed-db
description: Reset and seed the development database with fixture data
---

Run `pnpm db:reset` to drop and recreate the dev database, then run
`pnpm db:seed` to load the fixture data from `test/fixtures/`.
Confirm the record counts match expectations and report any errors.
```

Now anyone on the team types `/seed-db` and it just works.

### Skill with parameters

```markdown
---
name: migrate
description: Run database migrations (usage: /migrate [up|down] [steps])
---

Run the database migration in the direction specified ($1, default: up).
If a step count is given ($2), apply only that many migrations.
Use `pnpm db:migrate` and report which migrations ran.
```

### Skill in YAML format

`.coco/skills/deploy-staging.yaml`:

```yaml
name: deploy-staging
description: Deploy the current branch to the staging environment
prompt: |
  Build the project with `pnpm build`, then run `./scripts/deploy.sh staging`.
  After deploy, hit https://staging.example.com/health and verify 200 OK.
  Print the deployed version and any warnings from the deploy log.
```

### Overriding a built-in skill

Create `.coco/skills/review.md` in your repo to replace the global `/review` with your team's specific review checklist.

### Listing all available skills

```
/help
```

Coco lists all discovered skills, their source (project/global/built-in), and descriptions.

---

## MCP tools

MCP (Model Context Protocol) lets Coco talk to external systems — databases, APIs, browsers, filesystems — as native tools.

### Add a server

```bash
# Official filesystem server (read/write files outside the project)
coco mcp add filesystem \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-filesystem,/Users/you/Documents"

# PostgreSQL
coco mcp add postgres \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-postgres" \
  --env "DATABASE_URL=postgresql://localhost/mydb"

# Browser automation via Playwright
coco mcp add browser \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-playwright"

# GitHub API
coco mcp add github \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-github" \
  --env "GITHUB_TOKEN=ghp_..."
```

### List and manage servers

```bash
coco mcp list          # enabled servers
coco mcp list --all    # all including disabled
coco mcp remove postgres
```

### Using MCP tools in a session

Once added, tools are available immediately — no restart needed:

```
"Query the database and show me all orders placed in the last 7 days
that have status 'pending'. Group by customer_id."

"Open a browser, navigate to https://staging.example.com,
take a screenshot, and tell me if the login form looks correct."
```

### MCP in project config

Check in server configs so the whole team gets them:

`.coco.config.json`:

```json
{
  "mcp": {
    "servers": {
      "postgres": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres"],
        "env": { "DATABASE_URL": "${DATABASE_URL}" }
      }
    }
  }
}
```

---

## Built-in tools

Coco ships with a set of tools the agent uses automatically. You can also invoke them explicitly.

### File operations

```
"Read src/auth/login.ts and tell me what it does"
"Create a new file src/utils/slugify.ts with a slugify() function"
"Delete all .log files in the tmp/ directory"
"Move src/helpers/ to src/utils/ and update all imports"
```

### Git

```
"Show me what changed in the last 3 commits"
"Create a branch called feature/payment-refund"
"Commit the current changes with a conventional commit message"
"Show the diff for src/billing/ only"
```

### Running commands

```
"Run the test suite and show me only the failing tests"
"Run pnpm typecheck and fix any errors you find"
"Start the dev server and wait for it to be ready"
```

### Search and analysis

```
"Find all usages of the old createUser() function across the codebase"
"Which files import from src/legacy/? List them."
"Find all TODO comments in src/ that mention auth"
```

### Code analysis

```
/review              # full review of current changes
"Check the cyclomatic complexity of src/orchestrator/orchestrator.ts"
"Find functions longer than 50 lines in the services/ directory"
```

---

## Agents

Coco routes tasks to specialized agents automatically. You can also target them directly.

### Automatic routing

The default **Coder** agent handles most requests. Coco switches automatically when the intent is clear:

```
"Review the security of the auth module"    →  Reviewer agent
"Write tests for the billing service"       →  Tester agent
"How does the caching layer work?"          →  Researcher agent
"Optimize the database queries in orders/"  →  Optimizer agent
"Design the architecture for notifications" →  Planner agent
```

### Explicit agent targeting

```
"As the Reviewer, analyze src/api/ for OWASP Top 10 vulnerabilities.
Be specific about line numbers and severity."

"As the Optimizer, profile the getOrders() query and suggest indexes.
Do not change the query semantics."
```

### Parallel agents

For independent tasks, Coco dispatches agents concurrently:

```
"In parallel:
- Write unit tests for src/auth/
- Write unit tests for src/billing/
- Write unit tests for src/notifications/
Report when all three are done."
```

---

## Quality tuning

### Set a project threshold

```bash
# In .coco.config.json
coco config set quality.minScore 90   # stricter (production API)
coco config set quality.minScore 70   # looser (prototype/spike)
```

### Change iteration limit

```bash
coco config set quality.maxIterations 5   # faster, may not converge
coco config set quality.maxIterations 15  # more attempts for hard tasks
```

### Turn off convergence for a single task

```
"Write a quick prototype for the notification service.
Don't iterate — just give me a working draft."
```

Or toggle globally:

```
/coco off    # disable convergence mode
/coco on     # re-enable
```

### Focus on a specific dimension

```
"Improve the test coverage of src/billing/ specifically.
The current coverage is 42% — bring it to at least 80%."

"The security score is failing because of the SQL query builder.
Fix only the security issues; don't touch the rest."
```

### Configure weights per project

`.coco.config.json`:

```json
{
  "quality": {
    "weights": {
      "security": 0.25,
      "testCoverage": 0.20,
      "correctness": 0.20,
      "complexity": 0.10,
      "documentation": 0.05
    }
  }
}
```

---

## Tips & tricks

### Paste a screenshot for visual debugging

Press `Ctrl+V` to paste an image directly into the REPL (vision-capable providers only):

```
[paste screenshot of browser console error]
"What's causing this error? It appears when I submit the signup form."
```

### Resume after interruption

Coco checkpoints automatically. If a session is interrupted:

```bash
coco resume           # resume from latest checkpoint
coco resume --list    # show all available checkpoints
```

### Full-access mode for trusted environments

In CI or when you trust the task fully:

```
/full-access on
```

Coco auto-approves safe tool calls (file writes, test runs, git operations) without asking each time. Security-sensitive operations (pushing to remote, installing packages) still prompt.

### Context management for long sessions

When the conversation gets long and responses slow down:

```
/compact
```

Compresses the context while preserving key decisions and code state.

### Switch model mid-session

```
coco config set model claude-opus-4-6   # best quality
coco config set model claude-haiku-4-5  # faster, cheaper
```

### Pipe output to Coco

```bash
cat error.log | coco "Analyze this error log and suggest fixes"
pnpm test 2>&1 | coco "These tests are failing. Fix them."
```

### Language switching

Works naturally in both English and Spanish. Mix freely:

```
"Add validation to the login form"
"añade validación al formulario de login"
```

---

## What to do when things go wrong

### Quality not converging

If Coco hits `maxIterations` without converging:

1. Ask for a quality report: `"Show me the current quality report"`
2. Identify the blocking dimension: often security (must be 100) or coverage
3. Give targeted instructions: `"Focus only on fixing the SQL injection in line 47"`
4. Or lower the threshold temporarily: `coco config set quality.minScore 80`

### Stuck in a loop

```
/clear         # clear conversation history
/compact       # compress context
```

If the problem persists, start a new session: `coco resume` picks up from the last checkpoint.

### Wrong file modified

```
"Revert the changes to src/orders/orders.controller.ts.
Use the version from git HEAD."
```

### Unexpected behavior

```
"Stop. Explain what you just did to src/auth/login.ts and why."
```

Coco explains its reasoning. If the approach was wrong, redirect it explicitly before continuing.

---

**More examples:** [Agent Evaluation & Tutorial](AGENT_EVALUATION_AND_TUTORIAL.md) · [Quick Start](QUICK_START.md) · [Configuration](CONFIGURATION.md)

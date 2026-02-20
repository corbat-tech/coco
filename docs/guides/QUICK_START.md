# Quick Start

Get up and running with Coco in under 5 minutes.

---

## Prerequisites

- **Node.js 22+** — check with `node --version`
- **An API key** from your chosen provider — see [PROVIDERS.md](PROVIDERS.md) for the full list

---

## Install

```bash
npm install -g @corbat-tech/coco

# Verify
coco --version
```

---

## Configure

Create `~/.coco/.env` with your API key:

```bash
mkdir -p ~/.coco
cat > ~/.coco/.env << 'EOF'
# Use whichever provider you have a key for.
# Coco will detect the first key it finds.
ANTHROPIC_API_KEY=sk-ant-...

# Other supported keys (uncomment as needed):
# OPENAI_API_KEY=sk-...
# GOOGLE_API_KEY=...
# GROQ_API_KEY=...
EOF
```

Alternatively, export the key in your shell session:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

---

## Start

Run `coco` from any project directory:

```bash
cd my-project
coco
```

On first launch you will see:

1. **Provider selection** — Coco detects which API keys are present and lets you pick a model
2. **Welcome banner** — shows the active provider, model, COCO mode status, and available commands
3. **REPL prompt** — type your task in plain English and press Enter

---

## Your first task

At the prompt, describe what you want built:

```
> Add input validation to the registration form
```

Coco runs through four phases automatically:

```
  ◆ Converging on requirements...
  ◆ Designing architecture — 2 tasks planned

  Task 1/2  Validate registration fields (email, password strength, required fields)
  ·  iter 1  ──  score 61  no tests, missing error messages
  ·  iter 2  ──  score 83  tests added, messages improved
  ·  iter 3  ──  score 91  ✓ converged

  Task 2/2  Unit tests for validation helpers
  ·  iter 1  ──  score 94  ✓ converged first try

  ╭───────────── Quality Report ─────────────╮
  │  Correctness      94   ████████████████  │
  │  Security         96   ████████████████  │
  │  Test Coverage    88   ██████████████░░  │
  │  Documentation    82   █████████████░░░  │
  │  ─────────────────────────────────────  │
  │  Overall          91   ████████████████  │
  ╰──────────────────────────────────────────╯

  2 files written · 14 tests · 88% coverage · 0 vulnerabilities
```

Coco writes the files, runs your test suite, scores the result across 12 quality dimensions, and iterates until the score reaches the threshold (default: **85/100**).

---

## Adjust quality threshold

If the default threshold is too strict for a prototype, lower it:

```
/config quality.minScore 75
```

Or raise it for production-critical code:

```
/config quality.minScore 92
```

---

## Next steps

- **[COOKBOOK.md](COOKBOOK.md)** — prompting patterns, daily workflows, advanced skills usage
- **[PROVIDERS.md](PROVIDERS.md)** — full provider list, model recommendations, local model setup
- **[ECOSYSTEM.md](ECOSYSTEM.md)** — skills system, MCP server integration, use-case flows

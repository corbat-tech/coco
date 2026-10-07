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

For a plan before editing, start with `/plan` and review the result. When ready, ask Coco to implement it and run the relevant tests. Ordinary coding sessions may change files and execute tools.

Enable iterative self-review with `/quality on`. This requests tests and review through the agent; it does **not** certify a numerical score or guarantee all checks passed. Inspect the actual tool output, changed files and remaining failures. Missing evidence must remain explicitly unverified.

```text
/plan Add input validation to the registration form
# Review the plan, then request implementation and tests.
/quality on
/diff
```

## Measured quality checks

Run `coco check --help` from your shell to see the separate project quality-analysis options. Those tools collect measurements where supported; the REPL's self-review text is a different source of evidence.

Project thresholds belong in `.coco.config.json`, for example:

```json
{
  "quality": { "minScore": 85, "maxIterations": 8 }
}
```

There is no built-in `/config quality.minScore` slash command. Configuration and measured acceptance remain subject to the selected workflow and available analyzers; changing a threshold does not supply missing evidence.

## Headless execution

After configuring your provider, discover automation options with `coco chat --help`:

```bash
coco chat --print "Inspect the project and summarize its structure" --output json
```

Headless execution can use coding tools without interactive confirmation. Run it in a trusted checkout with suitable host permissions. JSON success means the turn completed; verify tests and changes separately.

The install command uses stable `latest`; use `npm install -g @corbat-tech/coco@next` only when intentionally evaluating a preview.

---

## Next steps

- **[COOKBOOK.md](COOKBOOK.md)** — prompting patterns, daily workflows, advanced skills usage
- **[PROVIDERS.md](PROVIDERS.md)** — full provider list, model recommendations, local model setup
- **[ECOSYSTEM.md](ECOSYSTEM.md)** — skills system, MCP server integration, use-case flows

<div align="center">

<img src="docs/assets/logo.png" alt="Coco — autonomous AI coding agent" width="640"/>

<br/>

[![npm](https://img.shields.io/npm/v/@corbat-tech/coco?style=flat-square&color=a855f7&label=npm)](https://www.npmjs.com/package/@corbat-tech/coco)
[![Node](https://img.shields.io/badge/Node.js-22+-22c55e?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-f59e0b?style=flat-square)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-5738_passing-22c55e?style=flat-square)](https://github.com/corbat-tech/coco/actions)

<br/>

[Install](#install) · [Quick Start](#quick-start) · [How It Works](#how-it-works) · [Providers](#providers) · [Skills](#skills) · [Docs](#documentation)

</div>

---

## The one-line pitch

Most AI tools write code and hand it back. If tests fail or security is off — that's your problem. **Coco runs the loop for you**: write → test → measure → fix, until your code actually hits a quality bar worth shipping.

---

## What it looks like

```
$ coco "Add JWT authentication to the Express API"

  ◆ Converging on requirements...
  ◆ Designing architecture — 3 tasks planned

  Task 1/3  JWT middleware
  ·  iter 1  ──  score 58  missing error handling, 0 tests written
  ·  iter 2  ──  score 79  tests added, OWASP issue detected
  ·  iter 3  ──  score 91  ✓ converged

  Task 2/3  Auth routes  /login · /refresh · /logout
  ·  iter 1  ──  score 71  coverage 42%, input not validated
  ·  iter 2  ──  score 89  ✓ converged

  Task 3/3  Integration tests
  ·  iter 1  ──  score 94  ✓ converged first try

  ╭───────────── Quality Report ─────────────╮
  │  Correctness      96   ████████████████  │
  │  Security        100   ████████████████  │
  │  Test Coverage    88   ██████████████░░  │
  │  Complexity       91   ████████████████  │
  │  Documentation    84   █████████████░░░  │
  │  ─────────────────────────────────────  │
  │  Overall          92   ████████████████  │
  ╰──────────────────────────────────────────╯

  3 files written · 47 tests · 88% coverage · 0 vulnerabilities
```

---

## Why Coco

| What you usually do | What Coco does |
|---------------------|----------------|
| Write code, run tests manually, fix, repeat | Autonomous iterate-until-quality loop |
| Hope your reviewer catches security issues | OWASP pattern analysis on every iteration |
| Guess at test coverage | c8/v8 instrumentation, measured per task |
| One model, one provider, take it or leave it | 12 providers, switch any time |
| Workflows live in your head or Confluence | Reusable skills committed to the repo |

### How Coco compares

| | Coco | Aider | Claude Code | Cursor |
|---|---|---|---|---|
| Quality convergence loop | ✅ | ❌ | ❌ | ❌ |
| Runs tests + measures coverage | ✅ | ❌ | ❌ | ❌ |
| Provider-agnostic (12 providers) | ✅ | ✅ | ❌ Anthropic only | Partial |
| Works in terminal | ✅ | ✅ | ✅ | ❌ IDE only |
| Reusable team workflows (Skills) | ✅ | ❌ | ✅ CLAUDE.md | ❌ |
| MCP tool integration | ✅ | ❌ | ✅ | ✅ |
| Local models (Ollama, LM Studio) | ✅ | ✅ | ❌ | Partial |
| Subscription-based providers | ✅ ChatGPT, Kimi Code | ❌ | ✅ Claude Max | ✅ |

---

## Install

### Prerequisites

Coco requires **Node.js 22 or higher**. Check your version:

```bash
node --version   # should print v22.x.x or higher
```

Don't have Node.js? Install it for your platform:

**macOS**
```bash
# Homebrew (recommended)
brew install node

# Or use the official installer: https://nodejs.org
```

**Linux (Debian/Ubuntu)**
```bash
# Via NodeSource (keeps Node up to date)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Linux (Fedora/RHEL)**
```bash
sudo dnf install nodejs
```

**WSL2 (Windows)**

Coco works great on WSL2. If you don't have WSL2 set up yet:

```powershell
# In PowerShell (as Administrator)
wsl --install
```

Then open your WSL2 terminal and follow the Linux instructions above.

> **Native Windows is not supported.** Use WSL2 — it gives you a full Linux environment on Windows with better performance and tool compatibility.

---

### Install Coco

Once Node.js 22+ is ready:

```bash
# npm
npm install -g @corbat-tech/coco

# pnpm
pnpm add -g @corbat-tech/coco

# bun
bun add -g @corbat-tech/coco
```

Verify the installation:

```bash
coco --version
```

---

## Quick Start

```bash
# Set your API key (Anthropic recommended, others work too)
export ANTHROPIC_API_KEY="sk-ant-..."

# Start the interactive REPL — first run guides you through setup
coco

# Or go straight to a task
coco "Build a REST API for user management with tests"
```

That's it. On first launch Coco walks you through choosing a provider and model.

**[5-minute tutorial →](docs/guides/QUICK_START.md)**

---

## How It Works

Coco uses the **COCO methodology** — four phases, fully automated:

```
  CONVERGE             ORCHESTRATE           COMPLETE             OUTPUT
┌────────────┐       ┌─────────────┐       ┌──────────────┐    ┌──────────┐
│ Understand │  ──►  │   Design    │  ──►  │  Build with  │ ►  │ Generate │
│  the task  │       │ + backlog   │       │  convergence │    │  CI/CD   │
└────────────┘       └─────────────┘       └──────────────┘    └──────────┘
                                                 ↑    │
                                                 │ loop│ score < threshold
                                                 └────┘
```

**The convergence loop** is what sets Coco apart. After writing each task:

1. Runs your test suite
2. Scores the result across **12 quality dimensions**
3. Identifies the weakest areas with specific diagnostics
4. Generates a targeted fix and repeats
5. Stops when the score meets your threshold (default: **85/100**)

**[Architecture deep dive →](docs/architecture/ARCHITECTURE.md)**

---

## 12-Dimension Quality Scoring

Not vibes — real measurements from static analysis and test instrumentation:

| Dimension | How it's measured |
|-----------|-------------------|
| **Correctness** | Test pass rate + build verification |
| **Security** | OWASP pattern matching (must be 100 to ship) |
| **Test Coverage** | c8/v8 line + branch instrumentation |
| **Complexity** | Cyclomatic complexity via AST |
| **Duplication** | Line-based similarity detection |
| **Style** | oxlint / eslint / biome (your config) |
| **Documentation** | JSDoc / Javadoc coverage |
| **Readability** | Derived from complexity + naming |
| **Maintainability** | Maintainability Index (MI) |
| **Test Quality** | Assertion density, coverage distribution |
| **Completeness** | Requirements traceability |
| **Robustness** | Error handling, edge case coverage |

Language-specific analyzers for **TypeScript/JavaScript**, **React/TSX**, and **Java**.

**[Quality guide →](docs/guides/QUALITY.md)**

---

## Commands

Type `/help` inside the REPL to see everything. The most useful ones day-to-day:

| Command | What it does |
|---------|--------------|
| `/quality [on\|off]` | Toggle quality convergence mode (default: on) |
| `/check` | Run typecheck + lint + tests inline |
| `/review` | Code review with severity-rated findings |
| `/diff` | Visual diff with syntax highlighting |
| `/ship` | Full release: review → test → lint → branch → PR → merge |
| `/full-access [on\|off]` | Auto-approve safe tool calls |
| `/permissions` | Show trust status and manage tool allowlist |
| `/permissions allow-commits` | Auto-approve git commits for this project |
| `/status` | Project status, git info, session stats |
| `/compact` | Compress context when the conversation grows long |
| `/copy [N]` or `/cp [N]` | Copy code block #N to clipboard (omit N for last block) |
| `/image [prompt]` | Paste clipboard image and send to agent with optional prompt |

**Keyboard shortcuts:**

| Key | What it does |
|-----|--------------|
| `Option+C` (macOS) / `Alt+C` (Linux) | Copy last rendered code block to clipboard instantly |
| `Ctrl+V` | Paste clipboard image — accumulates multiple images before Enter |
| `Tab` | Accept ghost-text completion for slash commands |
| `↑` / `↓` | Navigate history / completion menu |

You don't have to use slash commands. Natural language works:

```
"review the auth module"          →  /review
"let's ship this"                 →  /ship
"what changed since yesterday?"   →  /diff
"update coco"                     →  updates to latest version
```

Bilingual: English and Spanish both work out of the box.

**[Full cookbook and examples →](docs/guides/COOKBOOK.md)**

---

## Providers

Coco is provider-agnostic. Bring your own key or run fully local:

| Provider | Models | Auth |
|----------|--------|------|
| **Anthropic** ⭐ | Claude Opus, Sonnet, Haiku | API key / OAuth |
| **OpenAI** | GPT-4.1, o4-mini, Codex | API key / OAuth |
| **Google** | Gemini 2.5 Pro/Flash | API key / gcloud |
| **Groq** | Llama 4, Mixtral, Gemma | API key |
| **OpenRouter** | 200+ models | API key |
| **Mistral AI** | Mistral Large, Codestral | API key |
| **DeepSeek** | DeepSeek-V3, DeepSeek-R1 | API key |
| **Together AI** | Llama 4, Qwen, Falcon | API key |
| **xAI** | Grok-2, Grok-2-vision | API key |
| **Cohere** | Command R+ | API key |
| **Ollama** | Any local model | Local |
| **LM Studio** | Any GGUF model | Local |

Switch provider mid-session: `coco config set provider groq`

**[Provider guide + compatibility matrix →](docs/guides/PROVIDERS.md)**

---

## Skills

Skills are reusable workflows committed to your repo. They're discovered automatically — no registration step.

**Three scopes, one system:**

```
~/.coco/skills/            # your machine — personal workflows
.coco/skills/              # this repo — shared with the team
built-in                   # shipped with coco
```

**Using a skill:**

```
/ship              # full release pipeline
/review            # code review
/check             # quality gate
```

**Creating a project skill** — create `.coco/skills/deploy.md`:

```markdown
---
name: deploy
description: Deploy to staging and run smoke tests
---

Run `pnpm build`, then deploy to staging with `./scripts/deploy.sh staging`,
then hit the health endpoint and verify 200. Report any failures clearly.
```

Now anyone on the team can type `/deploy`.

Skills support Markdown, YAML, and JSON. The skills system auto-reloads on change.

**[Skills cookbook →](docs/guides/COOKBOOK.md#skills)**

---

## MCP Integration

Connect Coco to any MCP-compatible server — filesystem, databases, APIs, browser automation:

```bash
# Add the official filesystem server
coco mcp add filesystem \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-filesystem,/home/user"

# Add a database server
coco mcp add postgres \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-postgres" \
  --env "DATABASE_URL=postgresql://..."
```

Once connected, MCP tools are registered and available to the agent alongside built-in tools.

**[MCP guide →](docs/MCP.md)**

---

## Configuration

```bash
# Project config (committed to the repo)
cat .coco.config.json

# CLI config
coco config list
coco config set quality.minScore 90
coco config set provider deepseek
```

`.coco.config.json` example:

```json
{
  "name": "my-api",
  "language": "typescript",
  "quality": {
    "minScore": 88,
    "maxIterations": 8
  }
}
```

**[Configuration reference →](docs/guides/CONFIGURATION.md)**

---

## Multi-Agent Architecture

Six specialized agents route automatically based on the task:

- **Researcher** — codebase exploration, context gathering
- **Coder** — implementation (default for most tasks)
- **Tester** — test generation and coverage improvement
- **Reviewer** — quality audits, security analysis
- **Optimizer** — refactoring, performance improvements
- **Planner** — architecture, task decomposition

For complex tasks, agents run in parallel where dependencies allow.

---

## Documentation

| Guide | What's in it |
|-------|-------------|
| [Quick Start](docs/guides/QUICK_START.md) | Install, setup, first project |
| **[Cookbook & Examples](docs/guides/COOKBOOK.md)** | Prompting patterns, skills, MCP, daily workflows |
| [Configuration](docs/guides/CONFIGURATION.md) | Full config reference |
| [Providers](docs/guides/PROVIDERS.md) | Provider setup, compatibility, cost table |
| [Quality Guide](docs/guides/QUALITY.md) | 12-dimension analysis, language support, CI |
| [GitHub Actions](docs/guides/GITHUB-ACTIONS.md) | CI/CD integration, PR comments |
| [MCP Integration](docs/MCP.md) | Connecting external tools |
| [Architecture](docs/architecture/ARCHITECTURE.md) | System design, ADRs |
| [Troubleshooting](docs/guides/TROUBLESHOOTING.md) | Common issues |

---

## Development

```bash
git clone https://github.com/corbat-tech/coco
cd coco
pnpm install

pnpm dev          # run with tsx (hot reload)
pnpm check        # typecheck + lint + test
pnpm test         # 5604 tests
pnpm format:fix   # fix formatting
```

**Stack:** TypeScript · Node.js 22 · Vitest · oxlint · oxfmt · Zod · Commander

---

## Known Limitations

- **CLI only** — no VS Code extension yet
- **Convergence takes time** — expect 2–5 min per task depending on complexity
- **Quality depends on the model** — Claude Opus gives the best results; smaller models score lower
- **Not yet battle-tested at enterprise scale** — production use at medium-scale projects, feedback welcome

---

## Privacy

Coco sends your prompts and relevant code context to the LLM provider you configure. Your code is not stored by Coco and is not used to train models — that is governed by each provider's own data policy:

- **Anthropic**: https://www.anthropic.com/privacy
- **OpenAI**: https://openai.com/policies/privacy-policy
- **Google Gemini**: https://policies.google.com/privacy
- **Local models** (Ollama, LM Studio): nothing leaves your machine

Coco does not collect telemetry. No usage data is sent to Corbat.

---

## Contributing

Contributions welcome — especially new quality analyzers and providers.

- Bug reports: [GitHub Issues](https://github.com/corbat-tech/coco/issues)
- See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development workflow

---

## License

MIT © [Corbat](https://corbat.tech)

---

<div align="center">

**Write the requirement. Coco does the rest.** 🥥

[npm](https://www.npmjs.com/package/@corbat-tech/coco) · [GitHub](https://github.com/corbat-tech/coco) · [corbat.tech](https://corbat.tech)

</div>

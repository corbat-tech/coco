<p align="center">
  <img src="https://img.shields.io/badge/v1.2.3-stable-blueviolet?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-22+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/License-MIT-f5c542?style=for-the-badge" alt="MIT License">
  <img src="https://img.shields.io/badge/Tests-4350%2B_passing-22c55e?style=for-the-badge" alt="Tests">
</p>

<h1 align="center">🥥 Corbat-Coco</h1>

<p align="center">
  <strong>The open-source coding agent that iterates on your code until it's actually production-ready.</strong>
</p>

<p align="center">
  <em>Generate → Test → Measure → Fix → Repeat — autonomously.</em>
</p>

---

## Why Coco?

Most AI coding tools generate code and hand it to you. If something breaks — tests fail, types don't match, a security issue slips in — that's your problem.

Coco takes a different approach. After generating code, it **runs your tests, measures quality across 12 dimensions, diagnoses what's wrong, and fixes it** — in a loop, autonomously — until the code actually meets a quality bar you define.

```
 ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
 │ Generate │ ──► │   Test   │ ──► │ Measure  │ ──► │   Fix    │
 └──────────┘     └──────────┘     └──────────┘     └──────────┘
                                                          │
                                              Score < 85? │ ──► Loop back
                                              Score ≥ 85? │ ──► Done ✅
```

This is the **Quality Convergence Loop** — Coco's core differentiator.

---

## Quick Start

```bash
npm install -g @corbat-tech/coco
coco                        # Opens interactive REPL — guided setup on first run
```

That's it. Coco walks you through provider configuration on first launch.

```bash
# Or use it directly:
coco "Add a REST API endpoint for user authentication with tests"
```

---

## What You Can Do

Coco works from the interactive REPL (`coco`). You can use **slash commands** or just **talk naturally** — Coco understands both.

### Slash Commands

| Command | What it does | Example |
|---------|-------------|---------|
| `/help` | Show available commands and usage | `/help review` |
| `/status` | Project status, git info, session stats | `/status` |
| `/review` | Code review with severity-rated findings | `/review --base main` |
| `/diff` | Visual diff with syntax highlighting | `/diff --staged` |
| `/ship` | Full release pipeline: review → test → lint → branch → version → commit → PR → CI → merge | `/ship --minor` |
| `/compact` | Reduce context when conversation gets long | `/compact` |
| `/clear` | Clear conversation history | `/clear` |

### Natural Language

You don't need to memorize commands. Just describe what you want:

| What you say | What happens |
|-------------|-------------|
| "review the code" / "revisa el código" | Runs `/review` |
| "let's ship it" / "publica los cambios" | Runs `/ship` |
| "how are we doing?" / "cómo va?" | Runs `/status` |
| "create a PR" / "crea un pull request" | Runs `/ship` |
| "show me the diff" / "muéstrame los cambios" | Runs `/diff` |
| "help" / "ayuda" | Runs `/help` |

### `/ship` — Release Pipeline

The most powerful command. Orchestrates the entire release flow in one step:

```
/ship                          # Full pipeline (10 steps)
/ship --skip-tests             # Skip test step
/ship --draft                  # Create draft PR
/ship --patch                  # Force patch version bump
/ship --minor                  # Force minor version bump
/ship --major                  # Force major version bump
/ship --no-version             # Skip version bumping
/ship -m "feat: add auth"     # Pre-set commit message
```

Pipeline: **Preflight → Review → Tests → Lint → Branch → Version → Commit → PR → CI → Merge & Release**

Each step is interactive — Coco asks before proceeding when decisions are needed. Press `Ctrl+C` at any point to cancel safely.

---

## What Coco Does Well

### Quality Convergence Loop

Coco doesn't just generate code — it iterates until quality converges:

| Iteration | Score | What happened |
|:---------:|:-----:|---------------|
| 1 | 52 | Code generated — 3 tests failing, no error handling |
| 2 | 71 | Tests fixed, security vulnerability found |
| 3 | 84 | Security patched, coverage improved to 82% |
| 4 | 91 | All green — quality converged ✅ |

The quality bar is yours to set:

```bash
coco build --min-quality 90          # Per-run override
coco config set quality.minScore 90  # Persist in project config
```

Default is **85** (senior-level). You can also configure max iterations, convergence threshold, coverage targets, and security requirements — see `coco config init`.

### 12-Dimension Quality Scoring

Every iteration measures your code across 12 dimensions using real static analysis:

| Dimension | How it's measured |
|-----------|-------------------|
| Test Coverage | c8/v8 instrumentation |
| Security | Pattern matching + optional Snyk |
| Complexity | Cyclomatic complexity via AST parsing |
| Duplication | Line-based similarity detection |
| Correctness | Test pass rate + build verification |
| Style | oxlint / eslint / biome integration |
| Documentation | JSDoc coverage analysis |
| Readability | AST: naming quality, function length, nesting |
| Maintainability | AST: file size, coupling, function count |
| Test Quality | Assertion density, edge case coverage |
| Completeness | Export density + test file coverage |
| Robustness | Error handling pattern detection |

> **Transparency note**: 7 dimensions use instrumented measurements. 5 use heuristic-based static analysis. We label which is which — no black boxes.

### Multi-Provider Support

Bring your own API keys. Coco works with:

| Provider | Auth | Models |
|----------|------|--------|
| **Anthropic** | API key / OAuth PKCE | Claude Opus, Sonnet, Haiku |
| **OpenAI** | API key | GPT-5.3 Codex, GPT-4.1, o4-mini |
| **Google** | API key / gcloud ADC | Gemini 3, 2.5 Pro/Flash |
| **Ollama** | Local | Any local model (8-24GB RAM) |
| **LM Studio** | Local | Any GGUF model (8-32GB RAM) |
| **Moonshot** | API key | Kimi models |

### Multi-Agent Architecture

Six specialized agents with weighted-scoring routing:

- **Researcher** — Explores, analyzes, maps the codebase
- **Coder** — Writes and edits code (default route)
- **Tester** — Generates tests, improves coverage
- **Reviewer** — Code review, quality auditing
- **Optimizer** — Refactoring and performance
- **Planner** — Architecture design, task decomposition

Coco picks the right agent for each task automatically. When confidence is low, it defaults to the coder — no guessing games.

### Interactive REPL

A terminal-first experience with:

- **Ghost-text completion** — Tab to accept inline suggestions
- **Slash commands** — `/ship`, `/review`, `/diff`, `/status`, `/help`, `/compact`, `/clear`
- **Image paste** — `Ctrl+V` to paste screenshots for visual context
- **Intent recognition** — Natural language mapped to commands
- **Context management** — Automatic compaction when context grows large

### Production Hardening

- **Error recovery** with typed error strategies and exponential backoff
- **Checkpoint/Resume** — `Ctrl+C` saves state, `coco resume` picks up where you left off
- **AST validation** — Syntax-checks generated code before saving
- **Convergence analysis** — Detects oscillation, diminishing returns, and stuck patterns
- **Path sandboxing** — Tools can only access files within the project

---

## COCO Methodology

Four phases, each with a dedicated executor:

```
 CONVERGE          ORCHESTRATE         COMPLETE            OUTPUT
┌──────────┐     ┌──────────────┐   ┌──────────────┐   ┌──────────┐
│ Gather   │     │ Design       │   │ Execute with │   │ Generate │
│ reqs     │ ──► │ architecture │──►│ quality      │──►│ CI/CD,   │
│ + spec   │     │ + backlog    │   │ convergence  │   │ docs     │
└──────────┘     └──────────────┘   └──────────────┘   └──────────┘
                                         ↑    ↓
                                    ┌─────────────┐
                                    │ Convergence │
                                    │    Loop     │
                                    └─────────────┘
```

1. **Converge** — Understand what needs to be built. Gather requirements, produce a spec.
2. **Orchestrate** — Design the architecture, decompose into a task backlog.
3. **Complete** — Execute each task with the quality convergence loop.
4. **Output** — Generate CI/CD pipelines, documentation, and deployment config.

---

## Use Cases

Coco is designed for developers who want AI assistance with **accountability**:

- **Feature development** — Describe what you want, get tested and reviewed code
- **Vibe coding** — Explore ideas interactively; Coco handles the quality checks
- **Refactoring** — Point at code and say "make this better" — Coco iterates until metrics improve
- **Test generation** — Improve coverage with meaningful tests, not boilerplate
- **Code review** — Get multi-dimensional quality feedback on existing code
- **Learning** — See how code quality improves across iterations

---

## Development

```bash
git clone https://github.com/corbat/corbat-coco
cd corbat-coco
pnpm install
pnpm dev          # Run in dev mode (tsx)
pnpm test         # 4,350+ tests via Vitest
pnpm check        # typecheck + lint + test
pnpm build        # Production build (tsup)
```

### Project Structure

```
src/
├── agents/           # Multi-agent coordination + weighted routing
├── cli/              # REPL, commands, input handling, output rendering
├── orchestrator/     # Phase coordinator + state recovery
├── phases/           # COCO phases (converge/orchestrate/complete/output)
├── quality/          # 12 quality analyzers + convergence engine
├── providers/        # 7 LLM providers + OAuth flows
├── tools/            # 20+ tool implementations
├── hooks/            # Lifecycle hooks (safety, lint, format, audit)
├── mcp/              # MCP server for external integration
└── config/           # Zod-validated configuration system
```

### Technology Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (ESM, strict mode) |
| Runtime | Node.js 22+ |
| Testing | Vitest (4,350+ tests) |
| Linting | oxlint |
| Formatting | oxfmt |
| Build | tsup |
| Schema validation | Zod |

---

## Known Limitations

We'd rather you know upfront:

- **TypeScript/JavaScript first** — Other languages have basic support but fewer analyzers
- **CLI-only** — No IDE extension yet (VS Code integration is planned)
- **Iteration takes time** — The convergence loop adds 2-5 minutes per task. For quick one-line fixes, a simpler tool may be faster
- **Heuristic analyzers** — 5 of 12 quality dimensions use pattern-based heuristics, not deep semantic analysis
- **LLM-dependent** — Output quality depends on the model you connect. Larger models produce better results
- **Early stage** — Actively developed. Not yet battle-tested at large enterprise scale

---

## Contributing

We welcome contributions of all kinds:

- Bug reports and feature requests
- New quality analyzers
- Additional LLM provider integrations
- Documentation and examples
- Real-world usage feedback

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## About

Corbat-Coco is built by [Corbat](https://corbat.tech), a technology consultancy that believes AI coding tools should be transparent, measurable, and open source.

<p align="center">
  <a href="https://github.com/corbat/corbat-coco">GitHub</a> · <a href="https://corbat.tech">corbat.tech</a>
</p>

<p align="center"><strong>MIT License</strong> · Made by developers who measure before they ship. 🥥</p>

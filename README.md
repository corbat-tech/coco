<div align="center">

# 🥥 Coco

**The AI coding agent that actually delivers production-ready code**

[Features](#-features) •
[Quick Start](#-quick-start) •
[How It Works](#-how-it-works) •
[Commands](#-commands) •
[Documentation](#-documentation)

[![NPM Version](https://img.shields.io/npm/v/@corbat-tech/coco?style=flat-square&color=blueviolet)](https://www.npmjs.com/package/@corbat-tech/coco)
[![License](https://img.shields.io/badge/license-MIT-f5c542?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node.js-22+-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-5283%2B-22c55e?style=flat-square)](https://github.com/corbat/corbat-coco/actions)

</div>

---

## The Problem

Most AI coding tools generate code and walk away. If tests fail, types don't match, or security issues creep in — **that's on you**.

## The Solution

**Coco doesn't just generate code. It iterates until it's right.**

After writing code, Coco automatically:
- ✅ Runs your tests
- 📊 Measures quality across 12 dimensions
- 🔍 Diagnoses what's wrong
- 🔧 Fixes issues and repeats

**Until your code hits production-quality standards you define.**

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ Generate │ ──► │   Test   │ ──► │ Measure  │ ──► │   Fix    │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                                                         │
                                             Score < 85? │ ──► Loop
                                             Score ≥ 85? │ ──► Done ✅
```

---

## What's New in v2.0.0

| Feature | Description |
|---------|-------------|
| **Unified Skills System** | Auto-discovery from global + project (`.coco/skills/`) + built-in scopes; YAML/JSON support |
| **WSL Support** | Native WSL2 path translation and detection |
| **3 new providers** | xAI/Grok, Cohere, Codex/OpenAI OAuth browser flow |
| **Multi-modal input** | Paste screenshots with `Ctrl+V` — sent to vision-capable providers |
| **Parallel agents** | Independent tasks dispatched concurrently across specialized agents |
| **`/check` command** | Run typecheck + lint + test pipeline inline in the REPL |

---

## ✨ Features

### 🔄 **Quality Convergence Loop** (COCO Mode)

Not just code generation — **iterative quality improvement**:

| Iteration | Score | Status |
|:---------:|:-----:|--------|
| **1** | 52 | Code generated — 3 tests failing, no error handling |
| **2** | 71 | Tests fixed, security vulnerability found |
| **3** | 84 | Security patched, coverage 82% |
| **4** | **91** | ✅ **All green — quality converged** |

> Enable with `/coco` — now **on by default** for better results

### 📊 **12-Dimension Quality Scoring**

Real metrics, not guesses:

| Dimension | How It's Measured |
|-----------|-------------------|
| Test Coverage | c8/v8 instrumentation |
| Security | Pattern matching (OWASP) + optional Snyk |
| Complexity | Cyclomatic complexity (AST) |
| Duplication | Line-based similarity |
| Correctness | Test pass rate + build verification |
| Style | oxlint / eslint / biome |
| Documentation | JSDoc / Javadoc coverage |
| + 5 more | Readability, Maintainability, Test Quality, Completeness, Robustness |

Language-specific analyzers included for **TypeScript/JavaScript**, **React/TSX**, and **Java**.

### 🚀 **Full Release Pipeline**

Ship with confidence using `/ship`:

```bash
/ship                          # Complete 10-step pipeline
```

**Pipeline:** Preflight → Review → Tests → Lint → Branch → Version → Commit → PR → CI → Merge

Each step is interactive — press `Ctrl+C` anytime to safely cancel.

### 🤖 **Multi-Agent Architecture**

Six specialized agents with automatic routing:

- **Researcher** — Codebase exploration and analysis
- **Coder** — Code implementation (default)
- **Tester** — Test generation and coverage
- **Reviewer** — Quality auditing and code review
- **Optimizer** — Refactoring and performance
- **Planner** — Architecture and task decomposition

### 🌐 **Multi-Provider Support**

Bring your own API key:

| Provider | Auth | Models |
|----------|------|--------|
| **Anthropic** | API key / OAuth | Claude Opus, Sonnet, Haiku |
| **OpenAI** | API key | GPT-5.3 Codex, GPT-4.1, o4-mini |
| **Google** | API key / gcloud | Gemini 3, 2.5 Pro/Flash |
| **Groq** | API key | Llama 4, Mixtral, Gemma |
| **OpenRouter** | API key | 200+ models (Claude, GPT, Llama…) |
| **Mistral AI** | API key | Mistral Large, Codestral |
| **DeepSeek** | API key | DeepSeek-V3, DeepSeek-R1 |
| **Together AI** | API key | Llama 4, Qwen, Falcon |
| **Hugging Face** | API key | Any HF Inference Endpoint |
| **Ollama** | Local | Any local model |
| **LM Studio** | Local | Any GGUF model |
| **Moonshot** | API key | Kimi models |

### 🧩 **Unified Skills System**

Extend coco with reusable workflows at three scopes:

| Scope | Location | Who sees it |
|-------|----------|-------------|
| **Built-in** | Shipped with coco | Everyone |
| **Global** | `~/.claude/skills/` | Your machine |
| **Project** | `.coco/skills/` | The repo |

Skills are Markdown, YAML, or JSON files — committed alongside source code and auto-discovered at runtime.

### ⚡ **Modern Terminal UX**

- **Ghost-text completion** — Tab to accept suggestions
- **Image paste** — `Ctrl+V` to paste screenshots (vision-capable providers)
- **Intent recognition** — Natural language → commands
- **Full-access mode** — `/full-access` for auto-approvals (with safety guards)
- **Self-update** — Type "update coco" anytime
- **WSL2 native** — Runs inside Windows Subsystem for Linux with correct path translation

---

## 🚀 Quick Start

```bash
# Install globally
npm install -g @corbat-tech/coco

# Start interactive mode
coco

# Or use directly
coco "Add user authentication with tests"
```

That's it. Coco walks you through provider setup on first launch.

---

## 💬 Commands

### Slash Commands

| Command | What it does |
|---------|-------------|
| `/help` | Show available commands |
| `/status` | Project status, git info, session stats |
| `/review` | Code review with severity-rated findings |
| `/diff` | Visual diff with syntax highlighting |
| `/ship` | Full release pipeline (review → test → PR → merge) |
| `/coco [on\|off]` | Toggle quality mode (default: ON) |
| `/check` | Run typecheck + lint + tests inline |
| `/full-access [on\|off]` | Auto-approve safe commands |
| `/compact` | Reduce context when conversation grows |
| `/clear` | Clear conversation history |

### Natural Language

You don't need slash commands. Just talk:

| You say | Coco does |
|---------|-----------|
| "review the code" | Runs `/review` |
| "let's ship it" | Runs `/ship` |
| "show me the changes" | Runs `/diff` |
| **"update coco"** | **Runs `/update-coco`** |

Bilingual support (English/Spanish).

---

## 🎯 How It Works

### COCO Methodology

Four phases for production-ready output:

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

1. **Converge** — Understand requirements
2. **Orchestrate** — Design architecture
3. **Complete** — Build with quality iteration
4. **Output** — Generate deployment config

---

## 📖 Documentation

- [Configuration Guide](docs/guides/CONFIGURATION.md)
- [Quality Analysis Guide](docs/guides/QUALITY.md)
- [Provider Guide](docs/guides/PROVIDERS.md)
- [GitHub Actions Integration](docs/guides/GITHUB-ACTIONS.md)
- [Quick Start Tutorial](docs/guides/QUICK_START.md)
- [Troubleshooting](docs/guides/TROUBLESHOOTING.md)
- [API Reference](docs/API.md)
- [MCP Integration](docs/MCP.md)

---

## 🧑‍💻 Development

```bash
git clone https://github.com/corbat/corbat-coco
cd corbat-coco
pnpm install
pnpm dev          # Run in dev mode
pnpm test         # 5,100+ tests
pnpm check        # Typecheck + lint + test
```

### Project Structure

```
src/
├── agents/           # Multi-agent coordination
├── cli/              # REPL + commands
├── phases/           # COCO phases
├── quality/          # 12-dimension scoring
├── providers/        # LLM provider integrations
└── tools/            # File ops, git, tests, etc.
```

**Stack:** TypeScript + Node.js 22 + Vitest + oxlint/oxfmt + Zod

---

## 🎓 Use Cases

- **Feature development** — Get tested, reviewed code
- **Refactoring** — Improve quality with measurable progress
- **Test generation** — Meaningful tests, not boilerplate
- **Code review** — 12-dimensional quality feedback
- **Learning** — See how quality improves across iterations

---

## ⚠️ Known Limitations

We'd rather you know upfront:

- **CLI-only** — No IDE extension yet (VS Code planned)
- **Iteration takes time** — Convergence adds 2-5 min per task
- **LLM-dependent** — Quality depends on your model choice
- **Early stage** — Not yet battle-tested at enterprise scale

---

## 🤝 Contributing

Contributions welcome:

- 🐛 Bug reports and feature requests
- 🔬 New quality analyzers
- 🔌 Additional LLM providers
- 📚 Documentation and examples

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## 📄 License

MIT © [Corbat](https://corbat.tech)

---

<div align="center">

**Built by developers who measure before they ship** 🥥

[GitHub](https://github.com/corbat/corbat-coco) · [corbat.tech](https://corbat.tech) · [npm](https://www.npmjs.com/package/@corbat-tech/coco)

</div>

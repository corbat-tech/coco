# 🥥 Corbat-Coco

**The open-source coding agent that iterates until your code is actually good.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)
[![Tests](https://img.shields.io/badge/Tests-4000%2B%20passing-brightgreen)](./)
[![Coverage](https://img.shields.io/badge/Coverage-80%25%2B-brightgreen)](./)

---

## The Problem

AI coding assistants generate code and hope for the best. You paste it in, tests fail, you iterate manually, you lose an hour. Studies show **67% of AI-generated PRs get rejected** on first review.

## The Solution

Coco doesn't stop at code generation. It runs your tests, measures quality across 12 dimensions, diagnoses failures, generates targeted fixes, and repeats — autonomously — until quality reaches a configurable threshold (default: 85/100).

```
Generate → Test → Measure → Diagnose → Fix → Repeat
                                                 ↓
                                          Quality ≥ 85? → Done ✅
```

**This is the Quality Convergence Loop.** No other open-source coding agent does this.

---

## Quick Start

```bash
npm install -g corbat-coco
coco init                                    # Configure your LLM provider
coco "Build a REST API with authentication"  # That's it
```

Coco will generate code, run tests, iterate until quality passes, and generate CI/CD + docs.

---

## What Makes Coco Different

### 1. Quality Convergence Loop (Unique Differentiator)

Other agents generate code once. Coco iterates:

| Iteration | Score | What Happened |
|-----------|-------|---------------|
| 1 | 52/100 | Generated code, 3 tests failing |
| 2 | 71/100 | Fixed test failures, found security issue |
| 3 | 84/100 | Fixed security, improved coverage |
| 4 | 91/100 | All tests pass, quality converged ✅ |

The loop stops when:
- Score ≥ 85/100 (configurable)
- Score stabilized (delta < 2 between iterations)
- All critical issues resolved
- Or max 10 iterations reached

### 2. 12-Dimension Quality Scoring

Every iteration measures code across 12 real dimensions:

| Dimension | Method | Type |
|-----------|--------|------|
| **Test Coverage** | c8/v8 instrumentation | Instrumented |
| **Security** | Pattern matching + optional Snyk | Instrumented |
| **Complexity** | Cyclomatic complexity via AST | Instrumented |
| **Duplication** | Line-based similarity detection | Instrumented |
| **Correctness** | Test pass rate + build verification | Instrumented |
| **Style** | oxlint/eslint/biome integration | Instrumented |
| **Documentation** | JSDoc coverage analysis | Instrumented |
| **Readability** | AST: naming quality, function length, nesting depth | Heuristic |
| **Maintainability** | AST: file length, coupling, function count | Heuristic |
| **Test Quality** | Assertion density, trivial ratio, edge cases | Heuristic |
| **Completeness** | Export density + test file coverage ratio | Heuristic |
| **Robustness** | Error handling pattern detection via AST | Heuristic |

> **Transparency**: 7 dimensions use instrumented analysis (real measurements). 5 use heuristic-based static analysis (directional signals via pattern detection). We label which is which.

### 3. Multi-Agent with Weighted Scoring Routing

Six specialized agents, each with real LLM tool-use execution:

| Agent | Primary Keywords (weight 3) | Tools |
|-------|----------------------------|-------|
| **Researcher** | research, analyze, explore, investigate | read_file, grep, glob |
| **Coder** | (default) | read_file, write_file, edit_file, bash |
| **Tester** | test, coverage, spec, mock | read_file, write_file, run_tests |
| **Reviewer** | review, quality, audit, lint | read_file, calculate_quality, grep |
| **Optimizer** | optimize, refactor, performance | read_file, write_file, analyze_complexity |
| **Planner** | plan, design, architect, decompose | read_file, grep, glob, codebase_map |

Task routing scores each role against the task description. The highest-scoring role is selected; below threshold, it defaults to "coder". Each agent runs a multi-turn tool-use loop via the LLM protocol.

### 4. Production Hardening

- **Error Recovery**: 9 error types with automatic retry strategies and exponential backoff
- **Checkpoint/Resume**: Ctrl+C saves state. `coco resume` continues from where you left off
- **Error Messages**: Every error includes an actionable suggestion for how to fix it
- **Convergence Analysis**: Detects oscillation, diminishing returns, and stuck patterns
- **AST Validation**: Parses and validates syntax before saving files

---

## Architecture: COCO Methodology

Four phases, each with its own executor:

```
 CONVERGE          ORCHESTRATE         COMPLETE           OUTPUT
┌──────────┐     ┌──────────────┐   ┌──────────────┐   ┌──────────┐
│ Gather   │     │ Design       │   │ Execute with │   │ Generate │
│ reqs     │ ──► │ architecture │──►│ quality      │──►│ CI/CD,   │
│ + spec   │     │ + backlog    │   │ iteration    │   │ docs     │
└──────────┘     └──────────────┘   └──────────────┘   └──────────┘
                                         ↑    ↓
                                    ┌─────────────┐
                                    │ Convergence │
                                    │    Loop     │
                                    └─────────────┘
```

### Technology Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (ESM, strict mode) |
| Runtime | Node.js 22+ |
| Testing | Vitest (4,000+ tests) |
| Linting | oxlint |
| Build | tsup |
| LLM Providers | Anthropic Claude, OpenAI GPT, Google Gemini, Ollama, LM Studio |
| Auth | OAuth 2.0 PKCE (browser + device code flow) |

---

## Comparison with Alternatives

| Feature | Cursor | Aider | Goose | Devin | **Coco** |
|---------|--------|-------|-------|-------|----------|
| Quality Convergence Loop | ❌ | ❌ | ❌ | Partial¹ | **✅** |
| Multi-Dimensional Scoring | ❌ | ❌ | ❌ | Internal | **12 dimensions** |
| Multi-Agent | ❌ | ❌ | Via MCP | ✅ | **✅ (weighted routing)** |
| AST Validation | ❌ | ❌ | ❌ | ✅ | **✅** |
| Error Recovery + Resume | ❌ | ❌ | ❌ | ✅ | **✅ (9 error types)** |
| Open Source | ❌ | ✅ | ✅ | ❌ | **✅** |
| Price | $20/mo | Free² | Free² | $500/mo | **Free²** |

¹ Devin iterates internally but doesn't expose a configurable quality scoring system.
² Free beyond LLM API costs (bring your own keys).

### Where Coco Excels
- **Quality iteration**: The only open-source agent with a configurable multi-dimensional convergence loop
- **Transparency**: Every score is computed, not estimated. You can inspect the analyzers
- **Cost**: $0 subscription. ~$2-5 in API costs per project

### Where Coco is Behind
- **IDE integration**: CLI-only today. VS Code extension planned
- **Maturity**: Earlier stage than Cursor (millions of users) or Devin (2+ years production)
- **Speed**: Iteration takes time. For quick edits, use Cursor or Copilot
- **Language support**: Best with TypeScript/JavaScript. Python/Go experimental

---

## CLI Experience

### Interactive REPL

```bash
coco  # Opens interactive REPL
```

**Slash commands**:
- `/coco` — Toggle quality convergence mode (auto-test + iterate)
- `/tutorial` — Quick 5-step guide for new users
- `/init` — Initialize a new project
- `/plan` — Design architecture and backlog
- `/build` — Build with quality iteration
- `/task <desc>` — Execute a single task
- `/status` — Check project state
- `/diff` — Review changes
- `/commit` — Commit with message
- `/help` — See all commands

### Provider Support

| Provider | Auth Method | Models |
|----------|------------|--------|
| Anthropic | API key or OAuth PKCE | Claude Opus, Sonnet, Haiku |
| OpenAI | API key | GPT-4o, GPT-4, o1, o3 |
| Google | API key or gcloud ADC | Gemini Pro, Flash |
| Ollama | Local (no key) | Any local model |
| LM Studio | Local (no key) | Any GGUF model |
| Moonshot | API key | Kimi models |

---

## Development

```bash
git clone https://github.com/corbat/corbat-coco
cd corbat-coco
pnpm install
pnpm dev          # Run in dev mode
pnpm test         # Run 4,000+ tests
pnpm check        # typecheck + lint + test
```

### Project Structure

```
corbat-coco/
├── src/
│   ├── agents/           # Multi-agent coordination + weighted routing
│   ├── cli/              # REPL, commands, input handling
│   ├── orchestrator/     # Phase coordinator + recovery
│   ├── phases/           # COCO phases (converge/orchestrate/complete/output)
│   ├── quality/          # 12 quality analyzers
│   ├── providers/        # 6 LLM providers + OAuth
│   ├── tools/            # 20+ tool implementations
│   ├── hooks/            # Lifecycle hooks (safety, lint, format, audit)
│   ├── mcp/              # MCP server for external integration
│   └── config/           # Zod-validated configuration
├── test/e2e/             # End-to-end pipeline tests
└── docs/                 # Architecture docs + ADRs
```

---

## Limitations (Honest)

- **TypeScript/JavaScript first**: Other languages have basic support
- **CLI-only**: No IDE integration yet
- **Heuristic analyzers**: 5 of 12 dimensions use pattern matching, not deep semantic analysis
- **Early stage**: Not yet battle-tested at enterprise scale
- **Iteration takes time**: 2-5 minutes per task with convergence loop
- **LLM-dependent**: Quality of generated code depends on the LLM you use

---

## Contributing

MIT License. We welcome contributions:
- Bug reports and feature requests
- New quality analyzers
- Additional LLM provider integrations
- Documentation improvements
- Real-world usage feedback

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## About Corbat

Corbat-Coco is built by [Corbat](https://corbat.tech), a boutique technology consultancy. We believe AI coding tools should be transparent, measurable, and open source.

**Links**:
- [GitHub](https://github.com/corbat/corbat-coco)
- [corbat.tech](https://corbat.tech)

---

**Made with 🥥 by developers who measure before they ship.**

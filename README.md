<div align="center">

<img src="docs/assets/logo.png" alt="Coco - autonomous coding agent" width="560"/>

<br/>

[![npm](https://img.shields.io/npm/v/@corbat-tech/coco?style=flat-square&label=npm)](https://www.npmjs.com/package/@corbat-tech/coco)
[![downloads](https://img.shields.io/npm/dm/@corbat-tech/coco?style=flat-square&label=downloads)](https://www.npmjs.com/package/@corbat-tech/coco)
[![CI](https://img.shields.io/github/actions/workflow/status/corbat-tech/coco/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/corbat-tech/coco/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/corbat-tech/coco/codeql.yml?branch=main&style=flat-square&label=CodeQL)](https://github.com/corbat-tech/coco/actions/workflows/codeql.yml)
[![Node](https://img.shields.io/badge/Node.js-22%2B-22c55e?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-f59e0b?style=flat-square)](LICENSE)

[Install](#install) · [Quick Start](#quick-start) · [Why Coco](#why-coco) · [Runtime](#runtime-reuse) · [Web Assistant Example](#example-web-assistant-runtime) · [Providers](#providers) · [Documentation](#documentation)

</div>

**Coco is an open-source CLI coding agent and reusable agent runtime for real-world automation.**
It plans work, edits files, runs tools/tests, and iterates until quality checks pass. Underneath the CLI, Coco exposes a runtime for building custom agents with providers, tools, permissions, sessions, events, and workflows.

---

## What Is Coco?

Coco is a CLI coding agent for real projects. It can plan work, edit files, run tools and tests, and iterate until a quality threshold is reached.

Core idea: instead of a single "here is some code" response, Coco runs an implementation loop with validation and fixes.

Best fit:
- Teams and solo developers working on existing repos (not only greenfield demos).
- Workflows that require multi-step execution and verification, not just text generation.

## Why Coco?

Coco is built for two related jobs:

- A terminal-first coding agent that can work inside real repositories.
- A reusable agent runtime for building future assistants and business automation without depending on the interactive CLI.

That runtime boundary is intentionally practical: provider selection, model turns, tool registration, permission policy, runtime sessions, event logs, workflow metadata, and replay hooks live behind reusable APIs. The CLI is the first product built on that foundation, not the only surface it can support.

## See Coco In Action

```bash
coco "/plan add validation for the provider config parser"
# Coco inspects the repo with read-only tools and returns a plan.

coco "implement the plan and run the relevant tests"
# Coco edits files, runs checks, reviews failures, and summarizes the diff.
```

Typical final output includes changed files, checks run, risks, and next steps. For runtime embedding, see the web assistant and RAG examples below.

## Built For Two Use Cases

### For Developers

Use Coco as a coding agent that can inspect an existing repo, plan changes, edit files, run checks, review diffs, and iterate toward a passing result.

### For Teams And Products

Use Coco Runtime as a base for custom agents: internal assistants, support copilots, operations workflows, sales/product assistants, documentation agents, or client-specific automation. These products can use Coco's runtime without exposing shell, filesystem, git, or publishing tools unless you explicitly register them.

## What Coco Does

**Coding Agent**

- Multi-step execution in one run: explore -> implement -> test -> refine.
- Quality mode with convergence scoring (configurable threshold and max iterations).
- Native tool use for files, git, shell, search/web, review, diff, build/test, and MCP servers.
- Session-oriented REPL with slash commands, context compaction, and resumable workflows.

**Multi-provider Runtime**

- Provider support across API, subscription-backed, OpenAI-compatible, and local models.
- Runtime APIs for sessions, model turns, tool registration, permission policy, events, and workflow metadata.
- Reusable foundation for Coco-powered agents beyond the CLI.

**Reliability And Safety**

- Provider retry/circuit-breaker support for long sessions.
- Robust tool-call parsing and safer stream error handling.
- Strict read-only planning mode by default.

**Extensibility**

- MCP support for external tools and services.
- Skills for project-specific workflows and agent interoperability.
- Replay harness support to reproduce agent-loop behaviors from fixtures for regression testing.

Coco is designed to be useful on medium and large repos, not only toy examples.

## Install

### Prerequisites

- Node.js `22+`
- macOS or Linux
- Windows: use WSL2

```bash
node --version
```

### Global install

```bash
npm install -g @corbat-tech/coco
# or
pnpm add -g @corbat-tech/coco
```

Verify:

```bash
coco --version
```

## Quick Start

```bash
# Example with Anthropic
export ANTHROPIC_API_KEY="..."

# Start interactive mode
coco

# Or run a direct task
coco "Add JWT auth to this API with tests"
```

On first run, Coco guides provider/model setup.

## Typical Workflow

1. You give a task.
2. Coco proposes or derives a plan.
3. Coco edits code and runs tools/tests.
4. In quality mode, Coco scores output and iterates on weak points.
5. Coco returns summary + diffs/results.

Quality mode is configurable and can be turned on/off per session.

## Runtime Reuse

Coco's CLI runs on a reusable agent runtime that wires providers, tools, permissions, sessions, event logs, and workflow metadata behind a stable internal boundary. This keeps the programming CLI as the main product while making the same foundation reusable for future client-specific agents.

```ts
import { createAgentRuntime, ToolRegistry } from "@corbat-tech/coco";
```

Runtime consumers can create their own backend, register only the tools they trust, and use Coco for model/provider orchestration, session state, permissions, event logging, and workflow execution.

- [Runtime Architecture](docs/architecture/RUNTIME.md)
- [Platform Layers](docs/architecture/PLATFORM_LAYERS.md)
- [Public API v0](docs/PUBLIC_API_V0.md)
- [Product Family](docs/PRODUCT_FAMILY.md)
- [Build Custom Agents](docs/guides/BUILD_CUSTOM_AGENTS.md)
- [Support/RAG Assistant](docs/guides/SUPPORT_RAG_ASSISTANT.md)
- [Web Assistant Runtime Example](examples/web-assistant-runtime/README.md)

Subpath imports are available for embedders:

```ts
import { createAgentRuntime } from "@corbat-tech/coco/runtime";
import { createSupportRagToolRegistry } from "@corbat-tech/coco/tools";
import { supportRagAssistantPreset } from "@corbat-tech/coco/presets";
```

## What Coco Adds To Business Agents

Coco does not replace your business systems. It gives you a reusable agent layer
that connects models, tools, permissions, sessions, guardrails, and logs in the
same way across channels.

For example, in a RAG assistant:

```txt
Google Drive / Notion / PDFs / website docs
  -> your retriever or vector database
  -> Coco Runtime
  -> selected model
  -> answer with sources, policy, session, and event logs
```

The retriever still owns document indexing and search. Coco standardizes how the
agent uses that search safely: answer from approved knowledge, cite sources, say
"I don't know" when retrieval is weak, avoid dangerous tools, and record what
happened. The same runtime pattern can then be reused for a website widget,
WhatsApp assistant, customer-support draft flow, appointment assistant, or
internal operations agent.

## Runtime Maturity

| Surface | Status | Notes |
|---------|--------|-------|
| Coco CLI | Beta | Main product surface, used for coding-agent workflows. |
| Runtime APIs | Beta | Exported from `@corbat-tech/coco`; package split is planned later. |
| Agent presets | Experimental | Safe defaults for public web, RAG, sales, support, appointments, internal ops, and coding. |
| Adapters | Experimental | HTTP, streaming HTTP, and webhook-style adapter shapes. |

## Example: Web Assistant Runtime

For a website such as `corbat.tech`, the web app should own authentication, users, tenants, UI, and HTTP streaming. Coco Runtime should sit behind that app and own provider selection, model turns, session state, permission checks, tool registration, and event logs.

The recommended pattern is:

1. Build a small authenticated backend endpoint for the website chat.
2. Create a Coco runtime instance in that backend.
3. Register only narrow, domain-specific tools such as public-doc search, service listing, project-scope estimation, or lead-draft creation.
4. Stream runtime responses back to the frontend.

Do not reuse Coco's full coding-agent tool registry in a public web assistant. Shell access, arbitrary filesystem operations, git writes, deployment, package publishing, secrets, and private customer data should stay unavailable unless a product-specific backend explicitly gates them.

See [examples/web-assistant-runtime](examples/web-assistant-runtime/README.md) for a concrete embedding sketch.

## Why Coco vs Other Coding Agents?

- **Reusable runtime underneath the CLI:** Coco can power coding workflows and future custom assistants.
- **Multi-provider by design:** API, subscription-backed, OpenAI-compatible, and local models can share runtime policy.
- **Permission-first tooling:** public presets default to no tools; coding tools stay in trusted developer contexts.
- **Interop-friendly:** skills and MCP configuration can reuse existing agent ecosystem conventions.
- **Replay and release gates:** quality and provider behavior can be tested through replay fixtures and release checks.

## Reliability and Quality

- Provider calls use retry and circuit-breaker protection by default (can be disabled with `COCO_PROVIDER_RESILIENCE=0`).
- Tool-call handling is normalized across OpenAI/Codex-style streaming events to reduce malformed argument regressions.
- Agent turns include quality telemetry (`score`, iteration usage, tool success/failure, repeated-output suppression).
- Repeated identical tool outputs are suppressed in context to reduce token waste in multi-iteration loops.
- Agent loop now recovers from common "silent stop" cases (e.g. `tool_use` without reconstructed tool calls, empty `max_tokens` turns, short planning-only replies) before giving control back.
- Streaming turns now retry once on empty retryable provider failures before surfacing an error, reducing transient dead-end turns without re-running partial tool work.
- Recovery replay also covers multimodal prompts (image + text / image-only) by rebuilding a retryable task prompt when possible.
- Iteration budget can auto-extend when the task is still making real progress to reduce manual `continue` prompts.
- Automatic provider switching is **opt-in** via `agent.enableAutoSwitchProvider` (default: `false`).
- Plan mode now has a strict read-only allowlist by default, so `/plan` cannot drift into write-capable tools unless you explicitly disable `agent.planModeStrict`.
- `/doctor` provides a read-only local diagnostics pass for project access, config parsing, provider auth, hooks, and tool registry health.
- Release readiness can be gated with `pnpm check:release` (typecheck + lint + stable provider/agent suites).

## Commands (REPL)

Common commands:

- `/help` show available commands and skills.
- `/provider` switch provider.
- `/model` switch model.
- `/thinking [off|auto|low|medium|high|<tokens>]` control the reasoning/thinking budget (claude-4+, o3/o4-mini, gpt-5+, gemini-2.5+).
- `/quality [on|off]` toggle convergence mode.
- `/check` run checks in project context.
- `/review` run code review workflow.
- `/diff` inspect current changes.
- `/plan` explore and design with read-only tools only.
- `/doctor` run local diagnostics for config, auth, hooks, and tools.
- `/ship` run release-oriented workflow.
- `/permissions` inspect/update tool trust.
- `/compact` compact session context.

Natural language requests are supported too; commands are optional.

## Providers

Coco currently supports these provider IDs:

- `anthropic`
- `openai`
- `copilot`
- `gemini`
- `kimi`
- `kimi-code`
- `groq`
- `openrouter`
- `mistral`
- `deepseek`
- `together`
- `huggingface`
- `qwen`
- `ollama` (local)
- `lmstudio` (local)

Notes:

- `openai` supports API-key mode and OAuth flow (mapped internally when needed).
- `copilot` and subscription-backed providers rely on their own auth flow.
- Local providers run through OpenAI-compatible endpoints.

For setup details and model matrix:

- [Provider Guide](docs/guides/PROVIDERS.md)

## Skills

Skills are instruction files (SKILL.md) that Coco injects into its context to follow project-specific conventions or workflows. They activate automatically by context or manually via `/skill-name`.

**Where to place skills:**

| Location | Scope |
|----------|-------|
| `.agents/skills/<skill-name>/SKILL.md` | Project — native, highest priority |
| `~/.coco/skills/<skill-name>/SKILL.md` | Global — personal, all projects |

By default, Coco also scans compatible global directories from other agents:
`~/.agents/skills/`, `~/.claude/skills/`, `~/.gemini/skills/`, `~/.codex/skills/`, and `~/.opencode/skills/`.

Coco also reads skills from other agents automatically, so you can bring skills you already have:

| Directory | Agent |
|-----------|-------|
| `.agents/skills/` | Native (Coco, shared standard) |
| `.claude/skills/` | Claude Code |
| `.codex/skills/` | Codex CLI |
| `.gemini/skills/` | Gemini CLI |
| `.opencode/skills/` | OpenCode |

**Create your first skill:**

```bash
coco skills create my-conventions
# → creates .agents/skills/my-conventions/SKILL.md
```

**List all skills (including imported from other agents):**

```bash
coco skills list
```

See [Skills Guide](docs/guides/SKILLS.md) for full documentation.

## MCP Servers

MCP (Model Context Protocol) lets Coco use external tools: GitHub, databases, APIs, web search, and more.

**Quick setup — create `.mcp.json` in your project root:**

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token" }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/your/path"]
    }
  }
}
```

This format is compatible with Claude Code, Cursor, and Windsurf — if you already have a `.mcp.json`, Coco reads it automatically.

**Check MCP status inside the REPL:**

```
/mcp list      — show configured servers
/mcp status    — show connected servers and available tools
/mcp health    — run health check on all servers
```

**Authenticate with environment variables** (recommended — never hardcode tokens):

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
    },
    "my-api": {
      "url": "https://api.example.com/mcp",
      "headers": { "Authorization": "Bearer ${MY_API_TOKEN}" }
    }
  }
}
```

Set the variables in your shell environment (or in `~/.coco/.env` for Coco-managed global secrets).

See [MCP Guide](docs/MCP.md) for full documentation, authentication options, and troubleshooting.

## Configuration

Project-level config in `.coco.config.json` and CLI-level config via `coco config`.

Example:

```json
{
  "name": "my-service",
  "language": "typescript",
  "quality": {
    "minScore": 88,
    "maxIterations": 8
  }
}
```

See:

- [Configuration Guide](docs/guides/CONFIGURATION.md)

## Documentation

- [Quick Start](docs/guides/QUICK_START.md)
- [Cookbook](docs/guides/COOKBOOK.md)
- [Quality Guide](docs/guides/QUALITY.md)
- [Providers](docs/guides/PROVIDERS.md)
- [Architecture](docs/architecture/ARCHITECTURE.md)
- [Platform Layers](docs/architecture/PLATFORM_LAYERS.md)
- [Build Custom Agents](docs/guides/BUILD_CUSTOM_AGENTS.md)
- [Public Assistant Runtime](docs/guides/PUBLIC_ASSISTANT_RUNTIME.md)
- [RAG Assistant](docs/guides/RAG_ASSISTANT.md)
- [WhatsApp Assistant](docs/guides/WHATSAPP_ASSISTANT.md)
- [Security For Public Agents](docs/guides/SECURITY_FOR_PUBLIC_AGENTS.md)
- [Client Agent Integration](docs/guides/CLIENT_AGENT_INTEGRATION.md)
- [Troubleshooting](docs/guides/TROUBLESHOOTING.md)
- [Release Workflow](docs/RELEASE_WORKFLOW.md)

## Development

```bash
git clone https://github.com/corbat-tech/coco
cd coco
pnpm install

pnpm build
pnpm test
pnpm check
pnpm check:release
```

Tech stack:

- TypeScript (ESM)
- Vitest
- oxlint / oxfmt
- Zod
- Commander

Release gate (`pnpm check:release`) runs the stable typecheck/lint/provider+agent suites used for release readiness.

## Current Scope and Limitations

- CLI-first product; VS Code extension source is in `vscode-extension/`.
- Quality scores depend on project testability and model/tool quality.
- Provider behavior can vary by endpoint/model generation.
- Some advanced flows require external tooling (git, CI, MCP servers) to be installed/configured.
- No agent can guarantee zero regressions; Coco is designed to reduce risk with verification loops, not to remove it entirely.

## Privacy

Coco sends prompts and selected context to the configured provider.

- Coco itself does not claim ownership of your code.
- Provider-side data handling depends on each provider policy.
- Local providers (`ollama`, `lmstudio`) keep inference on your machine.

## Built By Corbat

Coco is developed by [Corbat](https://corbat.tech) as an open-source foundation for coding automation and custom AI agents.

## Contributing

- [CONTRIBUTING.md](CONTRIBUTING.md)
- Issues and proposals: [GitHub Issues](https://github.com/corbat-tech/coco/issues)

## License

MIT © Corbat

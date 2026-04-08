<div align="center">

<img src="docs/assets/logo.png" alt="Coco - autonomous coding agent" width="560"/>

<br/>

[![npm](https://img.shields.io/npm/v/@corbat-tech/coco?style=flat-square&label=npm)](https://www.npmjs.com/package/@corbat-tech/coco)
[![Node](https://img.shields.io/badge/Node.js-22%2B-22c55e?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-f59e0b?style=flat-square)](LICENSE)

[Install](#install) · [Quick Start](#quick-start) · [What Coco Does](#what-coco-does) · [Providers](#providers) · [Documentation](#documentation)

</div>

**Coco is an open-source CLI coding agent for real repositories.**  
It plans work, edits files, runs tools/tests, and iterates until quality checks pass.

---

## What Is Coco?

Coco is a CLI coding agent for real projects. It can plan work, edit files, run tools and tests, and iterate until a quality threshold is reached.

Core idea: instead of a single "here is some code" response, Coco runs an implementation loop with validation and fixes.

Best fit:
- Teams and solo developers working on existing repos (not only greenfield demos).
- Workflows that require multi-step execution and verification, not just text generation.

## What Coco Does

- Multi-step execution in one run: explore -> implement -> test -> refine.
- Quality mode with convergence scoring (configurable threshold and max iterations).
- Native tool use: files, git, shell, search/web, review, diff, build/test, MCP servers.
- Multi-provider support (API, subscription, and local models).
- Session-oriented REPL with slash commands, context compaction, and resumable workflows.
- Reliability features for long sessions: provider retry/circuit-breaker, robust tool-call parsing, and safer stream error handling.
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

## Reliability and Quality

- Provider calls use retry and circuit-breaker protection by default (can be disabled with `COCO_PROVIDER_RESILIENCE=0`).
- Tool-call handling is normalized across OpenAI/Codex-style streaming events to reduce malformed argument regressions.
- Agent turns include quality telemetry (`score`, iteration usage, tool success/failure, repeated-output suppression).
- Repeated identical tool outputs are suppressed in context to reduce token waste in multi-iteration loops.
- Agent loop now recovers from common "silent stop" cases (e.g. `tool_use` without reconstructed tool calls, empty `max_tokens` turns, short planning-only replies) before giving control back.
- Recovery replay also covers multimodal prompts (image + text / image-only) by rebuilding a retryable task prompt when possible.
- Iteration budget can auto-extend when the task is still making real progress to reduce manual `continue` prompts.
- Automatic provider switching is **opt-in** via `agent.enableAutoSwitchProvider` (default: `false`).
- Release readiness can be gated with `pnpm check:release` (typecheck + lint + stable provider/agent suites).

## Commands (REPL)

Common commands:

- `/help` show available commands and skills.
- `/provider` switch provider.
- `/model` switch model.
- `/quality [on|off]` toggle convergence mode.
- `/check` run checks in project context.
- `/review` run code review workflow.
- `/diff` inspect current changes.
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

## Contributing

- [CONTRIBUTING.md](CONTRIBUTING.md)
- Issues and proposals: [GitHub Issues](https://github.com/corbat-tech/coco/issues)

## License

MIT © Corbat

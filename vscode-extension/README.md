# COCO — Autonomous Coding Agent

**COCO** is an AI coding agent with a quality convergence loop that iterates until your code meets a configurable quality threshold. It runs entirely in VS Code's integrated terminal — no custom webview, no context switching.

## Features

- **Multi-provider LLM support** — Anthropic Claude, OpenAI GPT, Google Gemini, Kimi, Ollama, LM Studio, Groq, Mistral, DeepSeek, OpenRouter, Together AI, HuggingFace
- **Quality convergence** — the agent self-reviews its output and iterates until it reaches a score ≥ 85/100
- **Terminal-first UX** — COCO lives in VS Code's integrated terminal, just like the CLI
- **REPL with slash commands** — `/model`, `/provider`, `/intent`, `/mcp`, and more
- **MCP support** — connect Model Context Protocol servers for extended tooling
- **Persistent sessions** — reuses the same terminal panel across window reloads
- **Zero config to start** — just install and run; configure your provider API key when prompted

## Requirements

The COCO CLI must be installed on your system:

```bash
npm install -g @corbat-tech/coco
```

Verify the installation:

```bash
coco --version
```

## Usage

### Open COCO

| Method | Action |
|--------|--------|
| Status bar | Click **`$(robot) COCO`** in the bottom-left |
| Keyboard | `Ctrl+Shift+O` / `Cmd+Shift+O` |
| Command Palette | `COCO: Open COCO Agent` |
| Editor title bar | Click the robot icon |

### Start a new session

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:

```
COCO: New COCO Session
```

This destroys the current terminal and starts a fresh COCO session.

### Inside the COCO REPL

Once the terminal opens, you interact with COCO using natural language or slash commands:

```
> build me a REST API with authentication

/provider          — change LLM provider
/model             — change model
/intent            — set a persistent goal
/mcp               — manage MCP servers
/help              — list all commands
```

## Configuration

Open VS Code Settings (`Ctrl+,` / `Cmd+,`) and search for **COCO**.

| Setting | Default | Description |
|---------|---------|-------------|
| `coco.cliPath` | `coco` | Path to the `coco` binary. Set an absolute path if it's not on `$PATH`. |

**Example** — if you installed coco locally:

```json
{
  "coco.cliPath": "/usr/local/bin/coco"
}
```

## Supported Providers

Configure your preferred provider on first launch or via `/provider`:

| Provider | Models |
|----------|--------|
| **Anthropic** | Claude Sonnet 4.6, Opus 4.6, Haiku 4.5 |
| **OpenAI** | GPT-5.3 Codex, GPT-4.1, o4-mini |
| **Google Gemini** | Gemini 2.5 Pro, 2.0 Flash |
| **Kimi / Kimi Code** | kimi-for-coding |
| **Ollama** | Any locally downloaded model |
| **LM Studio** | Any locally downloaded model |
| **Groq** | Llama, Mixtral (ultra-fast) |
| **Mistral** | Codestral, Mistral Large |
| **DeepSeek** | DeepSeek Coder V3 |
| **OpenRouter** | 100+ models via one API key |
| **Together AI** | Open-source models |
| **HuggingFace** | Open models with free inference |

## How Quality Convergence Works

COCO's COCO loop (Converge → Orchestrate → Complete → Output) evaluates output across 12 quality dimensions on every iteration:

```
Correctness · Security · Performance · Maintainability · Test coverage
Documentation · Type safety · Error handling · Code style · Complexity
Dependencies · Modularity
```

The loop runs until the quality score reaches ≥ 85/100 or the maximum iteration count is hit. You get production-ready code, not just a first draft.

## Troubleshooting

**`coco: command not found`**

The CLI is not on your `$PATH`. Either:
1. Install globally: `npm install -g @corbat-tech/coco`
2. Or set `coco.cliPath` to the absolute path of the binary

**Terminal opens but COCO exits immediately**

Check that Node.js ≥ 22 is installed: `node --version`

**Want to use a local model?**

Install Ollama (`https://ollama.com`), pull a model, then run `/provider` inside COCO and select **Ollama**.

## Links

- [GitHub Repository](https://github.com/corbat/corbat-coco)
- [npm Package](https://www.npmjs.com/package/@corbat-tech/coco)
- [Documentation](https://github.com/corbat/corbat-coco#readme)
- [Report an Issue](https://github.com/corbat/corbat-coco/issues)
- [Discussions](https://github.com/corbat/corbat-coco/discussions)

## License

MIT © [Corbat Tech](https://github.com/corbat)

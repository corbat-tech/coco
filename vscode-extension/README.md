# COCO — Autonomous Coding Agent

**COCO** is a coding agent with tools, permissions and iterative review. Quality acceptance requires current, complete measurement evidence; a score alone is not a guarantee. It runs entirely in VS Code's integrated terminal — no custom webview, no context switching.

## Features

- **Multi-provider LLM support** — Anthropic Claude, OpenAI GPT, Google Gemini, Kimi, Ollama, LM Studio, Groq, Mistral, DeepSeek, OpenRouter, Together AI, HuggingFace
- **Quality evidence** — measured checks, missing instrumentation and failures are reported separately
- **Terminal-first UX** — COCO lives in VS Code's integrated terminal, just like the CLI
- **REPL with slash commands** — `/model`, `/provider`, `/intent`, `/mcp`, and more
- **MCP support** — connect Model Context Protocol servers for extended tooling
- **Project-scoped terminals** — reuses the active project terminal; a new session closes that project’s previous terminal. Terminals do not survive a window reload.
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

## Providers and quality

Provider/model choices come from the installed CLI. Use `/provider` and `/model` to inspect available options; Ollama runs models you have already installed locally. The extension does not include models or credentials.

The quality workflow distinguishes acceptance from convergence. Missing tests, coverage or other required measurements prevent certification. Static heuristics and a passing score do not prove that all user requirements are met; review the actual test evidence and changes.

## Workspace and executable safety

The extension runs only in trusted filesystem workspaces. In a workspace with multiple roots, it chooses the active editor’s project or asks you to select one. Each project gets its own terminal.

`coco.cliPath` is a machine setting naming one executable, without shell arguments. Paths with spaces are supported; project paths are passed as separate arguments. Windows `.cmd`/`.bat` wrappers are deliberately unsupported. Install a compatible executable or use the CLI directly on Windows. No Marketplace publication is required to install the VSIX from the GitHub release.

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

- [GitHub Repository](https://github.com/corbat-tech/coco)
- [npm Package](https://www.npmjs.com/package/@corbat-tech/coco)
- [Documentation](https://github.com/corbat-tech/coco#readme)
- [Report an Issue](https://github.com/corbat-tech/coco/issues)
- [Discussions](https://github.com/corbat-tech/coco/discussions)

## License

MIT © [Corbat Tech](https://github.com/corbat)

<p align="center">
  <img src="docs/assets/logo.svg" alt="Corbat-Coco Logo" width="180" />
</p>

<h1 align="center">🥥 Corbat-Coco</h1>

<p align="center">
  <strong>The AI Coding Agent That Actually Ships Production-Ready Code</strong>
</p>

<p align="center">
  <em>Self-reviewing • Quality-obsessed • Never ships crap</em>
</p>

<p align="center">
  <a href="https://github.com/corbat/corbat-coco/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/corbat/corbat-coco/ci.yml?branch=main&label=CI" alt="CI Status" /></a>
  <a href="https://codecov.io/gh/corbat/corbat-coco"><img src="https://img.shields.io/codecov/c/github/corbat/corbat-coco?label=coverage" alt="Coverage" /></a>
  <a href="https://www.npmjs.com/package/corbat-coco"><img src="https://img.shields.io/npm/v/corbat-coco.svg" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<br />

<p align="center">
  <img src="docs/assets/demo.gif" alt="Corbat-Coco Demo" width="700" />
</p>

---

## 💡 The Problem

AI coding assistants generate code that **looks good but breaks in production**. You end up:
- 🔄 Going back and forth fixing bugs
- 🧪 Writing tests after the fact (if at all)
- 🤞 Hoping edge cases don't blow up
- 📝 Explaining the same patterns over and over

## ✨ The Solution

**Corbat-Coco iterates on its own code until it's actually good.**

```
Generate → Test → Review → Improve → Repeat until senior-level quality
```

Every piece of code goes through **self-review loops** with **11-dimension quality scoring**. It doesn't stop until it reaches 85+ quality score.

---

## 🚀 Quick Start

```bash
# Install globally
npm install -g corbat-coco

# Start the interactive REPL
coco

# That's it. Coco guides you through the rest.
```

On first run, Coco will help you:
1. **Choose a provider** (Anthropic, OpenAI, Google, Moonshot)
2. **Set up your API key** (with secure storage options)
3. **Configure your preferences**

---

## 🎯 What Makes Coco Different

<table>
<tr>
<td width="50%">

### Other AI Assistants
```
You: "Build a user auth system"
AI: *generates code*
You: "This doesn't handle edge cases"
AI: *generates more code*
You: "The tests are broken"
AI: *generates even more code*
...3 hours later...
```

</td>
<td width="50%">

### Corbat-Coco
```
You: "Build a user auth system"
Coco: *generates → tests → reviews*
      "Score: 72/100 - Missing rate limiting"
      *improves → tests → reviews*
      "Score: 86/100 ✅ Ready"

...15 minutes later, production-ready...
```

</td>
</tr>
</table>

### Feature Comparison

| Feature | Cursor/Copilot | Claude Code | **Corbat-Coco** |
|---------|:--------------:|:-----------:|:---------------:|
| Generate code | ✅ | ✅ | ✅ |
| **Self-review loops** | ❌ | ❌ | ✅ |
| **Quality scoring** | ❌ | ❌ | ✅ (11 dimensions) |
| **Auto-iteration until good** | ❌ | ❌ | ✅ |
| Architecture planning | Basic | Basic | ✅ Full ADR system |
| Progress persistence | ❌ | Session | ✅ Checkpoints |
| Production CI/CD | ❌ | ❌ | ✅ Auto-generated |

---

## 📊 The Quality Engine

Every code iteration is scored across **11 dimensions**:

| Dimension | What It Measures |
|-----------|------------------|
| **Correctness** | Tests pass, logic is sound |
| **Completeness** | All requirements implemented |
| **Robustness** | Edge cases handled |
| **Readability** | Clean, understandable code |
| **Maintainability** | Easy to modify later |
| **Complexity** | Cyclomatic complexity in check |
| **Duplication** | DRY principles followed |
| **Test Coverage** | Line and branch coverage |
| **Test Quality** | Tests are meaningful |
| **Security** | No vulnerabilities |
| **Documentation** | Code is documented |

**Minimum threshold: 85/100** — Senior engineer level.

---

## 🛠️ Supported Providers

Coco works with multiple AI providers. Choose what fits your needs:

| Provider | Models | Best For | Auth Options |
|----------|--------|----------|--------------|
| 🟠 **Anthropic** | Claude Opus 4.5, Sonnet 4.5, Haiku 4.5 | Best coding quality | API Key |
| 🟢 **OpenAI** | GPT-5.2 Codex, GPT-5.2 Thinking/Pro | Fast iterations | API Key **or** OAuth |
| 🔵 **Google** | Gemini 3 Flash/Pro, 2.5 | Large context (2M tokens) | API Key **or** OAuth **or** gcloud ADC |
| 🌙 **Moonshot** | Kimi K2.5, K2 | Great value | API Key |
| 💻 **LM Studio** | Local models (Qwen3-Coder, etc.) | Privacy, offline | None (local) |

**Switch anytime** with `/provider` or `/model` commands.

> 💡 **OAuth Authentication**:
> - **OpenAI**: Have a ChatGPT Plus/Pro subscription? Select OpenAI and choose "Sign in with ChatGPT account" - no separate API key needed!
> - **Gemini**: Have a Google account? Select Gemini and choose "Sign in with Google account" - same as Gemini CLI!

---

## 💻 Usage Examples

### New Project: Build from Scratch

```bash
$ coco

🥥 Welcome to Corbat-Coco!

> Build a REST API for task management with auth

📋 Analyzing requirements...
📐 Creating architecture (3 ADRs)...
📝 Generated backlog: 2 epics, 8 stories

🔨 Building...

Task 1/8: User model ✓ (2 iterations, 91/100)
Task 2/8: Auth service ✓ (3 iterations, 88/100)
Task 3/8: JWT middleware ✓ (2 iterations, 94/100)
...

📊 Complete!
├─ Quality: 90/100 average
├─ Coverage: 87%
└─ Security issues: 0
```

### Existing Project: Execute Tasks

```bash
$ cd my-backend
$ coco

> Add GET /users/:id/orders endpoint with pagination

🔍 Analyzing codebase...
✓ Detected: TypeScript + Express
✓ Found existing patterns in UserController

🔨 Implementing...

Step 1/4: OrderController ✓ (2 iterations, 93/100)
Step 2/4: OrderService ✓ (1 iteration, 96/100)
Step 3/4: Tests ✓ (2 iterations, 89/100)
Step 4/4: OpenAPI docs ✓ (1 iteration, 97/100)

📊 Done in 8 minutes
├─ Files: 4 created, 1 modified
├─ Tests: 15 added (all passing)
└─ Coverage: 94%

> /commit
✓ feat(orders): add user orders endpoint with pagination
```

### Interactive REPL Commands

```bash
/help          # Show all commands
/status        # Project & git status
/model         # Change AI model
/provider      # Switch provider
/memory        # View conversation context
/compact       # Compress context if running low
/clear         # Clear conversation
/exit          # Exit REPL
```

---

## ⚙️ Configuration

Coco uses a hierarchical configuration system with **global** and **project-level** settings:

```
~/.coco/                          # Global configuration (user home)
├── .env                          # API keys (secure, gitignored)
├── config.json                   # Provider/model preferences (persisted across sessions)
├── projects.json                 # Project trust/permissions
├── trusted-tools.json            # Trusted tools (global + per-project)
├── tokens/                       # OAuth tokens (secure, 600 permissions)
│   └── openai.json               # e.g., OpenAI/Codex OAuth tokens
├── sessions/                     # Session history
└── COCO.md                       # User-level memory/instructions

<project>/.coco/                  # Project configuration (overrides global)
├── config.json                   # Project-specific settings
└── ...
```

### Configuration Priority

Settings are loaded with this priority (highest first):

1. **Command-line flags** — `--provider`, `--model`
2. **User preferences** — `~/.coco/config.json` (last used provider/model)
3. **Environment variables** — `COCO_PROVIDER`, `ANTHROPIC_API_KEY`, etc.
4. **Defaults** — Built-in default values (Anthropic Claude Sonnet)

### Environment Variables

Store your API keys in `~/.coco/.env` (created during onboarding):

```bash
# ~/.coco/.env
ANTHROPIC_API_KEY="sk-ant-..."   # Anthropic Claude
OPENAI_API_KEY="sk-..."          # OpenAI
GEMINI_API_KEY="..."             # Google Gemini
KIMI_API_KEY="..."               # Moonshot Kimi
```

Or export them in your shell profile:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Global Config (`~/.coco/config.json`)

Stores your last used provider, model preferences, and authentication methods:

```json
{
  "provider": "openai",
  "models": {
    "openai": "gpt-4o",
    "anthropic": "claude-sonnet-4-20250514",
    "kimi": "kimi-k2.5"
  },
  "authMethods": {
    "openai": "oauth"
  },
  "updatedAt": "2026-02-05T16:03:13.193Z"
}
```

This file is **auto-managed** - when you use `/provider` or `/model` commands, your choice is saved here and restored on next launch.

The `authMethods` field tracks how you authenticated with each provider:
- `"apikey"` - Standard API key authentication
- `"oauth"` - OAuth (e.g., ChatGPT subscription)
- `"gcloud"` - Google Cloud ADC

### Project Config (`<project>/.coco/config.json`)

Override global settings for a specific project:

```json
{
  "provider": {
    "type": "openai",
    "model": "gpt-4o"
  },
  "quality": {
    "minScore": 90
  }
}
```

### Project Trust & Permissions (`~/.coco/projects.json`)

Coco asks for permission the first time you access a directory. Your choices are saved:

```json
{
  "version": 1,
  "projects": {
    "/path/to/project": {
      "approvalLevel": "write",
      "toolsTrusted": ["bash_exec", "write_file"]
    }
  }
}
```

**Approval levels:**
- `read` — Read-only access (no file modifications)
- `write` — Read and write files
- `full` — Full access including bash commands

Manage permissions with `/trust` command in the REPL.

### Trusted Tools (`~/.coco/trusted-tools.json`)

Tools that skip confirmation prompts. Once you've granted directory access, trusted tools run automatically without asking each time.

When a tool requires confirmation, you can choose:
- `[y]es` — Allow once
- `[n]o` — Deny
- `[e]dit` — Edit command before running (bash only)
- `[a]ll` — Allow all this turn
- `[t]rust` — Always allow for this project

#### Recommended Safe Configuration

Here's a pre-configured `trusted-tools.json` with commonly-used **read-only** tools for developers:

```json
{
  "globalTrusted": [
    "read_file",
    "glob",
    "list_dir",
    "tree",
    "file_exists",
    "grep",
    "find_in_file",
    "git_status",
    "git_diff",
    "git_log",
    "git_branch",
    "command_exists",
    "run_linter",
    "analyze_complexity",
    "calculate_quality",
    "get_coverage"
  ],
  "projectTrusted": {}
}
```

#### Tool Categories & Risk Levels

| Category | Tools | Risk | Why |
|----------|-------|------|-----|
| **Read files** | `read_file`, `glob`, `list_dir`, `tree`, `file_exists` | 🟢 Safe | Only reads, never modifies |
| **Search** | `grep`, `find_in_file` | 🟢 Safe | Search within project only |
| **Git status** | `git_status`, `git_diff`, `git_log`, `git_branch` | 🟢 Safe | Read-only git info |
| **Analysis** | `run_linter`, `analyze_complexity`, `calculate_quality` | 🟢 Safe | Static analysis, no changes |
| **Coverage** | `get_coverage` | 🟢 Safe | Reads existing coverage data |
| **System** | `command_exists` | 🟢 Safe | Only checks if command exists |
| **Write files** | `write_file`, `edit_file` | 🟡 Caution | Modifies files - trust per project |
| **Move/Copy** | `copy_file`, `move_file` | 🟡 Caution | Can overwrite files |
| **Git stage** | `git_add`, `git_commit` | 🟡 Caution | Local changes only |
| **Git branches** | `git_checkout`, `git_init` | 🟡 Caution | Can change branch state |
| **Tests** | `run_tests`, `run_test_file` | 🟡 Caution | Runs code (could have side effects) |
| **Build** | `run_script`, `tsc` | 🟡 Caution | Executes npm scripts/compiler |
| **Delete** | `delete_file` | 🔴 Always ask | Permanently removes files |
| **Git remote** | `git_push`, `git_pull` | 🔴 Always ask | Affects remote repository |
| **Install** | `install_deps` | 🔴 Always ask | Runs npm/pnpm install (downloads code) |
| **Make** | `make` | 🔴 Always ask | Can run arbitrary Makefile targets |
| **Bash** | `bash_exec`, `bash_background` | 🔴 Always ask | Arbitrary shell commands |
| **HTTP** | `http_fetch`, `http_json` | 🔴 Always ask | Network requests to external services |
| **Env vars** | `get_env` | 🔴 Always ask | Could expose secrets if misused |

#### Example: Productive Developer Setup

For developers who want to speed up common workflows while keeping dangerous actions gated:

```json
{
  "globalTrusted": [
    "read_file", "glob", "list_dir", "tree", "file_exists",
    "grep", "find_in_file",
    "git_status", "git_diff", "git_log", "git_branch",
    "run_linter", "analyze_complexity", "calculate_quality", "get_coverage",
    "command_exists"
  ],
  "projectTrusted": {
    "/path/to/my-trusted-project": [
      "write_file", "edit_file", "copy_file", "move_file",
      "git_add", "git_commit",
      "run_tests", "run_test_file",
      "run_script", "tsc"
    ]
  }
}
```

#### Built-in Safety Protections

Even with trusted tools, Coco has **three layers of protection**:

| Level | Behavior | Example |
|-------|----------|---------|
| 🟢 **Trusted** | Auto-executes without asking | `read_file`, `git_status` |
| 🔴 **Always Ask** | Shows warning, user can approve | `bash_exec`, `git_push` |
| ⛔ **Blocked** | Never executes, shows error | `rm -rf /`, `curl \| sh` |

**Blocked commands** (cannot be executed even with approval):
- `rm -rf /` — Delete root filesystem
- `sudo rm -rf` — Privileged destructive commands
- `curl | sh`, `wget | sh` — Remote code execution
- `dd if=... of=/dev/` — Write to devices
- `mkfs`, `format` — Format filesystems
- `eval`, `source` — Arbitrary code execution
- Fork bombs and other malicious patterns

**File access restrictions**:
- System paths blocked: `/etc`, `/var`, `/root`, `/sys`, `/proc`
- Sensitive files protected: `.env`, `*.pem`, `id_rsa`, `credentials.*`
- Operations sandboxed to project directory

> ⚠️ **Important**: Tools marked 🔴 **always ask for confirmation** regardless of trust settings. They show a warning prompt because they can have **irreversible effects** (data loss, remote changes, network access). You can still approve them - they just won't auto-execute.

---

## 🔌 MCP (Model Context Protocol)

Coco supports [MCP](https://modelcontextprotocol.io/), enabling integration with 100+ external tools and services.

### Quick Setup

```bash
# Add an MCP server (e.g., filesystem access)
coco mcp add filesystem \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-filesystem,/home/user"

# Add GitHub integration
coco mcp add github \
  --command "npx" \
  --args "-y,@modelcontextprotocol/server-github" \
  --env "GITHUB_TOKEN=$GITHUB_TOKEN"

# List configured servers
coco mcp list
```

### Configuration File

Add MCP servers to `~/.coco/mcp.json` or your project's `coco.config.json`:

```json
{
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
      },
      {
        "name": "github",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
      }
    ]
  }
}
```

### Popular MCP Servers

| Server | Package | Description |
|--------|---------|-------------|
| **Filesystem** | `@modelcontextprotocol/server-filesystem` | Local file access |
| **GitHub** | `@modelcontextprotocol/server-github` | GitHub API integration |
| **PostgreSQL** | `@modelcontextprotocol/server-postgres` | Database queries |
| **Slack** | `@modelcontextprotocol/server-slack` | Slack messaging |
| **Google Drive** | `@modelcontextprotocol/server-gdrive` | Drive access |

📖 See [MCP Documentation](docs/MCP.md) for full details and HTTP transport setup.

---

## 📚 The COCO Methodology

Four phases from idea to deployment:

```
┌──────────┐    ┌────────────┐    ┌──────────┐    ┌────────┐
│ CONVERGE │ →  │ ORCHESTRATE│ →  │ COMPLETE │ →  │ OUTPUT │
└──────────┘    └────────────┘    └──────────┘    └────────┘
     │               │                 │              │
 Understand      Plan &            Execute &      Deploy &
 Requirements    Design            Iterate        Document
```

| Phase | What Happens | Output |
|-------|--------------|--------|
| **Converge** | Q&A to understand requirements | Specification |
| **Orchestrate** | Architecture design, create backlog | ADRs, Stories, Tasks |
| **Complete** | Build with quality iteration loops | Production code + tests |
| **Output** | Generate deployment artifacts | CI/CD, Dockerfile, Docs |

---

## 🔧 Development

```bash
# Clone
git clone https://github.com/corbat/corbat-coco.git
cd corbat-coco

# Install
pnpm install

# Development mode
pnpm dev

# Run tests
pnpm test

# Full check (typecheck + lint + test)
pnpm check

# Build
pnpm build
```

---

## 🗺️ Roadmap

- [x] Multi-provider support (Anthropic, OpenAI, Gemini, Kimi)
- [x] Interactive REPL with autocomplete
- [x] Checkpoint & recovery system
- [ ] VS Code extension
- [ ] Web dashboard
- [ ] Team collaboration
- [ ] Local model support (Ollama)

---

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
# Quick contribution flow
git checkout -b feat/amazing-feature
pnpm check  # Must pass
git commit -m "feat: add amazing feature"
```

---

## 📄 License

MIT — See [LICENSE](LICENSE).

---

<p align="center">
  <strong>Stop babysitting your AI. Let Coco iterate until it's right.</strong>
</p>

<p align="center">
  <a href="https://github.com/corbat/corbat-coco">⭐ Star on GitHub</a> •
  <a href="https://github.com/corbat/corbat-coco/issues">Report Bug</a> •
  <a href="https://github.com/corbat/corbat-coco/discussions">Discussions</a>
</p>

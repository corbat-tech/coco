# Configuration Guide

Complete reference for Corbat-Coco configuration options.

## Configuration File

Corbat-Coco uses a JSON configuration file stored at `.coco/config.json` in your project directory.

### Default Configuration

```json
{
  "project": {
    "name": "my-project",
    "version": "0.1.0"
  },
  "provider": {
    "type": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 16384,
    "temperature": 0.7
  },
  "quality": {
    "minScore": 85,
    "minCoverage": 80,
    "maxIterations": 10,
    "convergenceThreshold": 2,
    "minConvergenceIterations": 2
  },
  "persistence": {
    "enabled": true,
    "checkpointInterval": 300000,
    "maxCheckpoints": 50,
    "autoSave": true
  },
  "output": {
    "generateDocs": true,
    "generateDocker": true,
    "generateCICD": true,
    "cicdProvider": "github"
  }
}
```

## Configuration Sections

### Project Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `project.name` | string | - | Project name (used in generated files) |
| `project.version` | string | "0.1.0" | Project version |

### Provider Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `provider.type` | string | "anthropic" | LLM provider (`anthropic`) |
| `provider.model` | string | "claude-sonnet-4-20250514" | Model to use |
| `provider.maxTokens` | number | 16384 | Maximum tokens per request |
| `provider.temperature` | number | 0.7 | Temperature for generation (0-1) |

**Available Models:**
- `claude-sonnet-4-20250514` - Fast, good for most tasks
- `claude-opus-4-20250514` - Most capable, best for complex tasks

### Quality Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `quality.minScore` | number | 85 | Minimum quality score (0-100) |
| `quality.minCoverage` | number | 80 | Minimum test coverage (%) |
| `quality.maxIterations` | number | 10 | Max iterations per task |
| `quality.convergenceThreshold` | number | 2 | Score delta to consider converged |
| `quality.minConvergenceIterations` | number | 2 | Min iterations before converging |

**Quality Presets:**

```bash
# Strict (production)
coco config set quality.minScore 90
coco config set quality.minCoverage 85

# Normal (default)
coco config set quality.minScore 85
coco config set quality.minCoverage 80

# Relaxed (prototyping)
coco config set quality.minScore 70
coco config set quality.minCoverage 60
```

### Persistence Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `persistence.enabled` | boolean | true | Enable checkpointing |
| `persistence.checkpointInterval` | number | 300000 | Checkpoint interval (ms) |
| `persistence.maxCheckpoints` | number | 50 | Max checkpoints to keep |
| `persistence.autoSave` | boolean | true | Auto-save progress |

### Output Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `output.generateDocs` | boolean | true | Generate documentation |
| `output.generateDocker` | boolean | true | Generate Docker files |
| `output.generateCICD` | boolean | true | Generate CI/CD pipelines |
| `output.cicdProvider` | string | "github" | CI/CD provider |

**CI/CD Providers:**
- `github` - GitHub Actions
- `gitlab` - GitLab CI
- `azure` - Azure DevOps Pipelines
- `circleci` - CircleCI

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude (Anthropic) API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `GROQ_API_KEY` | Groq API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `MISTRAL_API_KEY` | Mistral AI API key |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `TOGETHER_API_KEY` | Together AI API key |
| `HUGGINGFACE_API_KEY` | Hugging Face API key |
| `KIMI_API_KEY` | Moonshot/Kimi API key |
| `COCO_CONFIG_PATH` | Custom config file path |
| `COCO_LOG_LEVEL` | Log level (`debug`, `info`, `warn`, `error`) |
| `COCO_NO_COLOR` | Disable colored output |

### Precedence

Configuration values are resolved in this order (highest to lowest):
1. Command-line flags
2. Environment variables
3. Project config (`.coco/config.json`)
4. Global config (`~/.coco/config.json`)
5. Default values

## Project-Level Configuration (.coco.config.json)

In addition to `.coco/config.json` (the internal tool config), you can place a `.coco.config.json` file at your **project root**. This file is meant to be **committed to version control** so your whole team shares the same quality standards.

### Location

```
my-project/
├── .coco.config.json   ← committed to git
├── .coco/
│   └── config.json     ← personal/machine settings, gitignored
└── src/
```

### Schema

```json
{
  "name": "my-project",
  "version": "1.0.0",
  "language": "typescript",
  "quality": {
    "minScore": 88,
    "minCoverage": 82,
    "maxIterations": 8,
    "securityThreshold": 100,
    "weights": {
      "security": 0.15,
      "testCoverage": 0.15
    },
    "ignoreRules": ["react/missing-jsdoc"],
    "ignoreFiles": ["**/generated/**", "**/vendor/**"]
  },
  "analyzers": {
    "enabledLanguages": ["typescript", "react-typescript"],
    "react": {
      "checkA11y": true,
      "checkHooks": true,
      "checkComponents": true
    },
    "java": {
      "minCoverage": 75,
      "reportPath": "target/site/jacoco/jacoco.xml"
    }
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Project name |
| `language` | string | Primary language hint (`typescript`, `java`, `react-typescript`, etc.) |
| `quality.minScore` | number | Minimum overall score (0–100) |
| `quality.minCoverage` | number | Minimum test coverage (%) |
| `quality.maxIterations` | number | Maximum convergence iterations |
| `quality.securityThreshold` | number | Required security score (default: 100) |
| `quality.weights` | object | Per-dimension weight overrides (normalised automatically) |
| `quality.ignoreRules` | string[] | Rule IDs to silence |
| `quality.ignoreFiles` | string[] | Glob patterns to exclude |
| `analyzers.enabledLanguages` | string[] | Languages to analyse |
| `analyzers.react.*` | object | React-specific analyzer toggles |
| `analyzers.java.*` | object | Java-specific options (JaCoCo path) |

### Config Inheritance

Use `extend` to share a base config across multiple packages in a monorepo:

```json
// packages/api/.coco.config.json
{
  "extend": "../../.coco.config.json",
  "quality": { "minScore": 90 }
}
```

The child config wins on scalar conflicts; `ignoreRules` / `ignoreFiles` arrays are concatenated.

### Precedence

```
CLI flags > .coco/config.json > .coco.config.json > defaults
```

## CLI Configuration Commands

### List All Settings

```bash
coco config list
coco config list --json  # JSON output
```

### Get a Setting

```bash
coco config get provider.model
coco config get quality.minScore
```

### Set a Setting

```bash
coco config set provider.model claude-opus-4-20250514
coco config set quality.minScore 90
```

### Initialize Configuration

```bash
coco config init  # Interactive setup
```

## Examples

### High-Quality Production Setup

```json
{
  "provider": {
    "type": "anthropic",
    "model": "claude-opus-4-20250514"
  },
  "quality": {
    "minScore": 90,
    "minCoverage": 85,
    "maxIterations": 15
  },
  "output": {
    "generateDocs": true,
    "generateDocker": true,
    "generateCICD": true,
    "cicdProvider": "github"
  }
}
```

### Fast Prototyping Setup

```json
{
  "provider": {
    "type": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "temperature": 0.8
  },
  "quality": {
    "minScore": 70,
    "minCoverage": 60,
    "maxIterations": 5
  },
  "persistence": {
    "checkpointInterval": 600000
  }
}
```

### GitLab CI Setup

```json
{
  "output": {
    "generateCICD": true,
    "cicdProvider": "gitlab"
  }
}
```

## Validation

Configuration is validated using Zod schemas. Invalid configuration will show helpful error messages:

```
Error: Invalid configuration
  - quality.minScore: Number must be between 0 and 100
  - provider.model: Invalid model name
```

## Reset Configuration

```bash
# Reset to defaults
rm .coco/config.json
coco config init --yes  # Use all defaults
```

---

See also:
- [Quick Start Guide](QUICK_START.md)
- [Providers Guide](PROVIDERS.md)
- [Quality Guide](QUALITY.md)
- [GitHub Actions](GITHUB-ACTIONS.md)
- [CLI Commands Reference](../../README.md#commands)

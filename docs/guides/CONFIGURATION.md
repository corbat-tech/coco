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

Environment variables override configuration file settings.

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | **Required.** Anthropic API key |
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
- [CLI Commands Reference](../../README.md#commands)

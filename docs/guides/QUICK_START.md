# Quick Start Guide

Get up and running with Corbat-Coco in 5 minutes.

## Prerequisites

- **Node.js 22+**: Check with `node --version`
- **Anthropic API Key**: Get one at [console.anthropic.com](https://console.anthropic.com)
- **Git** (optional but recommended)

## Installation

```bash
# Install globally via npm
npm install -g corbat-coco

# Or using pnpm (recommended)
pnpm add -g corbat-coco

# Verify installation
coco --version
```

## Setup

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY="sk-ant-your-api-key-here"
```

Add to your shell profile (`~/.bashrc` or `~/.zshrc`) to make it permanent.

## Your First Project

### Step 1: Initialize

```bash
# Create a new project
coco init my-awesome-app
cd my-awesome-app
```

Coco will ask you a series of questions to understand what you want to build.

**Example conversation:**

```
🚀 Welcome to Corbat-Coco!

? What would you like to build?
> A todo list API with user authentication

? What technology stack do you prefer?
> TypeScript, Express, PostgreSQL

? Any specific requirements?
> REST API with JWT auth, CRUD operations for todos
```

### Step 2: Plan

```bash
coco plan
```

This generates:
- **Specification**: Detailed requirements document
- **Architecture**: System design with diagrams
- **ADRs**: Architecture Decision Records
- **Backlog**: Epics, stories, and tasks

Review the plan in the `.coco/` directory.

### Step 3: Build

```bash
coco build
```

Coco will:
1. Generate code for each task
2. Write tests
3. Review code quality
4. Iterate until quality meets standards (85/100 by default)

**Example output:**

```
🔨 Building Sprint 0...

Task 1/6: Setup project structure
  Iteration 1: Score 72/100 - Improving...
  Iteration 2: Score 84/100 - Improving...
  Iteration 3: Score 91/100 ✓

Task 2/6: User authentication service
  Iteration 1: Score 68/100 - Improving...
  ...

📊 Sprint Complete!
├─ Average quality: 89/100
├─ Test coverage: 85%
└─ Tasks completed: 6/6
```

### Step 4: Check Progress

```bash
# Quick status
coco status

# Detailed view
coco status --detailed

# JSON output (for CI)
coco status --json
```

## Key Concepts

### Quality Score

Every piece of code is scored across 11 dimensions:

| Dimension | What it measures |
|-----------|-----------------|
| Correctness | Tests pass, logic correct |
| Completeness | All requirements met |
| Robustness | Edge cases handled |
| Readability | Code clarity |
| Maintainability | Easy to modify |
| Complexity | Cyclomatic complexity |
| Duplication | DRY score |
| Test Coverage | Line/branch coverage |
| Test Quality | Meaningful tests |
| Security | No vulnerabilities |
| Documentation | Doc coverage |

Default minimum: **85/100**

### Checkpoints

Coco saves progress automatically:
- Every 5 minutes
- After each task completion
- Before risky operations

Resume from interruption:
```bash
coco resume
```

### Configuration

View/modify settings:

```bash
# View all settings
coco config list

# Get specific value
coco config get quality.minScore

# Set value
coco config set quality.minScore 90
```

## Common Workflows

### Resume After Interruption

```bash
# List available checkpoints
coco resume --list

# Resume from latest
coco resume

# Resume from specific checkpoint
coco resume --checkpoint=<id>
```

### Build Specific Sprint

```bash
# Build only Sprint 2
coco build --sprint=2
```

### Build Specific Task

```bash
# Build only one task
coco build --task=task-123
```

### Adjust Quality Settings

```bash
# Lower quality for prototyping
coco config set quality.minScore 70

# Higher for production
coco config set quality.minScore 90
```

## Troubleshooting

### "ANTHROPIC_API_KEY not found"

```bash
export ANTHROPIC_API_KEY="sk-ant-your-key"
```

### "Quality score not improving"

Check the detailed report:
```bash
cat .coco/versions/task-XXX/review.json
```

Consider:
- Adjusting `maxIterations`
- Reviewing specific quality dimensions
- Checking for fundamental design issues

### "Rate limited"

Coco handles rate limits automatically, but you can:
- Use a smaller model
- Reduce parallelism
- Wait and retry

## Next Steps

- Read the [Full Tutorial](AGENT_EVALUATION_AND_TUTORIAL.md)
- Explore [Configuration Guide](CONFIGURATION.md)
- Check [Architecture Documentation](../architecture/ARCHITECTURE.md)
- View [Example Projects](../../examples/)

---

**Need help?** Open an issue on [GitHub](https://github.com/corbat/corbat-coco/issues)

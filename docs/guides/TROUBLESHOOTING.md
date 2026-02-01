# Troubleshooting Guide

Common issues and solutions for Corbat-Coco.

## Table of Contents

- [Installation Issues](#installation-issues)
- [API Key Issues](#api-key-issues)
- [Build Issues](#build-issues)
- [Quality Issues](#quality-issues)
- [Recovery Issues](#recovery-issues)
- [Performance Issues](#performance-issues)

---

## Installation Issues

### "Node.js version not supported"

**Problem:** Corbat-Coco requires Node.js 22+.

**Solution:**
```bash
# Check your version
node --version

# Install Node.js 22 using nvm
nvm install 22
nvm use 22

# Or using fnm
fnm install 22
fnm use 22
```

### "pnpm not found"

**Problem:** pnpm is not installed.

**Solution:**
```bash
# Install pnpm
npm install -g pnpm

# Or using corepack (Node.js 16+)
corepack enable
corepack prepare pnpm@latest --activate
```

### "Permission denied" on global install

**Problem:** No permission to install globally.

**Solution:**
```bash
# Option 1: Use sudo (not recommended)
sudo npm install -g corbat-coco

# Option 2: Fix npm permissions (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g corbat-coco
```

---

## API Key Issues

### "API key not found"

**Problem:** Anthropic API key is not configured.

**Solution:**
```bash
# Set environment variable
export ANTHROPIC_API_KEY="sk-ant-api03-..."

# Make it permanent (add to ~/.bashrc or ~/.zshrc)
echo 'export ANTHROPIC_API_KEY="sk-ant-api03-..."' >> ~/.bashrc
source ~/.bashrc
```

### "Invalid API key"

**Problem:** The API key format is wrong or expired.

**Solution:**
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Navigate to API Keys
3. Create a new key or verify existing one
4. Ensure it starts with `sk-ant-`

### "API rate limit exceeded"

**Problem:** Too many requests to the API.

**Solution:**
- Wait a few minutes before retrying
- Consider upgrading your Anthropic plan
- Use `coco resume` to continue without re-calling completed steps

---

## Build Issues

### "Task stuck in iteration loop"

**Problem:** A task keeps iterating without converging.

**Diagnosis:**
```bash
coco status --verbose
# Look for "iterations" count and "delta" values
```

**Solution:**
1. Check quality report: `.coco/versions/task-XXX/vN/scores.json`
2. If score is oscillating, there may be conflicting requirements
3. Options:
   ```bash
   # Skip the problematic task
   coco build --skip=task-XXX

   # Increase max iterations
   coco config set quality.maxIterations 15

   # Lower quality threshold temporarily
   coco config set quality.minScore 80
   ```

### "Tests failing repeatedly"

**Problem:** Generated tests keep failing.

**Solution:**
1. Check test output in `.coco/versions/task-XXX/vN/tests.json`
2. Common causes:
   - Missing test dependencies
   - Environment-specific issues
   - Flaky tests (timing-dependent)

```bash
# Run tests manually to debug
cd your-project
pnpm test -- --reporter=verbose
```

### "Build interrupted"

**Problem:** The build process was interrupted (Ctrl+C, crash, etc.)

**Solution:**
```bash
# Resume from last checkpoint
coco resume

# Or resume from a specific checkpoint
coco status --checkpoints
coco resume --from-checkpoint=cp-2024-01-15-143022
```

---

## Quality Issues

### "Score not improving"

**Problem:** Quality score stays the same across iterations.

**Diagnosis:**
```bash
# Check quality progression
cat .coco/versions/task-XXX/history.json | jq '.qualityProgression'
```

**Solution:**
1. Review suggestions in the quality report
2. Check if there are blocking issues (security, missing tests)
3. The agent may have reached a local optimum

```bash
# Force completion if acceptable
coco build --force-complete
```

### "Security score below 100"

**Problem:** Security vulnerabilities detected.

**Solution:**
1. Check security report: `.coco/versions/task-XXX/vN/scores.json`
2. Common issues:
   - Outdated dependencies
   - Hardcoded secrets
   - SQL injection risks
   - XSS vulnerabilities

The agent will try to fix these automatically. If it can't:
```bash
# Check for dependency vulnerabilities
npm audit
pnpm audit

# Update dependencies
pnpm update
```

### "Test coverage below threshold"

**Problem:** Test coverage is below the required 80%.

**Solution:**
1. The agent will generate more tests automatically
2. If it's still low after max iterations:
   ```bash
   # Check coverage report
   pnpm test:coverage

   # Lower threshold temporarily
   coco config set quality.minCoverage 70
   ```

---

## Recovery Issues

### "Checkpoint corrupted"

**Problem:** Cannot resume from checkpoint.

**Solution:**
```bash
# List available checkpoints
ls -la .coco/checkpoints/

# Try an older checkpoint
coco resume --from-checkpoint=<older-checkpoint-id>

# If all checkpoints are corrupted, restart the task
coco build --restart-task=task-XXX
```

### "State inconsistent"

**Problem:** Project state doesn't match files on disk.

**Solution:**
```bash
# Reset state (keeps files, resets tracking)
rm -rf .coco/state/
coco build --rescan

# Or start fresh (loses progress)
rm -rf .coco/
coco init .
```

### "Cannot find project"

**Problem:** `coco` commands don't recognize the project.

**Solution:**
```bash
# Ensure you're in the project directory
pwd
ls -la .coco/

# If .coco/ doesn't exist, initialize
coco init .

# If config.json is missing
coco init . --skip-discovery
```

---

## Performance Issues

### "Build taking too long"

**Problem:** Tasks are taking longer than expected.

**Causes:**
- Complex requirements
- Many iterations needed
- Large files being generated
- Slow API responses

**Solutions:**
```bash
# Use a faster model (if quality allows)
coco config set provider.model claude-3-5-haiku-20241022

# Reduce max iterations
coco config set quality.maxIterations 5

# Lower quality threshold
coco config set quality.minScore 80

# Build specific sprint only
coco build --sprint=0
```

### "High API costs"

**Problem:** Consuming too many API tokens.

**Solution:**
1. Use a cheaper model for initial iterations:
   ```bash
   coco config set provider.model claude-3-5-haiku-20241022
   ```

2. Reduce iterations:
   ```bash
   coco config set quality.maxIterations 5
   ```

3. Be more specific in requirements (fewer clarification rounds)

### "Memory issues"

**Problem:** Node.js running out of memory.

**Solution:**
```bash
# Increase Node.js memory limit
NODE_OPTIONS="--max-old-space-size=4096" coco build

# Or set permanently
export NODE_OPTIONS="--max-old-space-size=4096"
```

---

## Getting More Help

### Enable verbose logging

```bash
DEBUG=coco:* coco build
```

### Check logs

```bash
# Execution log
cat .coco/logs/execution.jsonl | tail -50

# Error log
cat .coco/logs/errors.jsonl
```

### Report an issue

If you can't resolve the issue:

1. Collect information:
   ```bash
   coco --version
   node --version
   coco status --verbose > status.txt
   ```

2. Open an issue at [GitHub Issues](https://github.com/corbat/corbat-coco/issues) with:
   - Description of the problem
   - Steps to reproduce
   - Relevant logs (remove sensitive data)
   - Configuration (`.coco/config.json` without API keys)

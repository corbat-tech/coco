# Corbat-Coco Examples

This directory contains example projects demonstrating how to use Corbat-Coco for different use cases.

## Available Examples

| Example | Description | Language | Time |
|---------|-------------|----------|------|
| [01-rest-api-typescript](./01-rest-api-typescript/) | REST API with authentication | TypeScript | ~25-45 min |
| [02-cli-tool](./02-cli-tool/) | CLI tool for image processing | TypeScript | ~20-35 min |
| [03-java-spring-boot](./03-java-spring-boot/) | Spring Boot microservice | Java | ~30-45 min |

## How to Use Examples

### Option 1: Start Fresh (Recommended)

Use the example as inspiration for your own project:

```bash
# Create your project
mkdir my-project && cd my-project

# Initialize
coco init .

# Describe something similar to the example
# Then plan and build
coco plan
coco build
```

### Option 2: Use Pre-configured Setup

Copy an example and use its configuration:

```bash
# Copy example
cp -r examples/01-rest-api-typescript my-project
cd my-project

# Configuration is ready, start planning
coco plan
coco build
```

## Example Structure

Each example contains:

```
example-name/
├── README.md           # Detailed instructions
├── .coco/
│   └── config.json     # Pre-configured settings
└── (optional) expected-output/
    └── ...             # Reference implementation
```

## Quick Reference

### REST API (TypeScript)

```bash
coco init my-api

# Describe:
"REST API for task management with JWT auth,
 TypeScript, Express, PostgreSQL"

coco plan
coco build
```

### CLI Tool (TypeScript)

```bash
coco init my-cli

# Describe:
"CLI tool for batch file processing with
 progress bars and config file support"

coco plan
coco build
```

### Spring Boot (Java)

```bash
coco init my-service

# Describe:
"Spring Boot 3 microservice with JWT auth,
 PostgreSQL, Flyway, hexagonal architecture"

coco plan
coco build
```

## Customizing Examples

### Change Quality Thresholds

Edit `.coco/config.json`:

```json
{
  "quality": {
    "minScore": 90,      // Higher quality bar
    "minCoverage": 85,   // More test coverage
    "maxIterations": 15  // Allow more iterations
  }
}
```

### Use Different LLM Model

```json
{
  "provider": {
    "model": "claude-opus-4-20250514"  // Use Opus for complex projects
  }
}
```

## Contributing Examples

Want to add a new example? See [CONTRIBUTING.md](../CONTRIBUTING.md).

Requirements for new examples:
- Clear README with prerequisites and instructions
- Pre-configured `.coco/config.json`
- Estimated time to build
- Description of what gets generated

## Need Help?

- [Main Documentation](../docs/)
- [Troubleshooting Guide](../docs/guides/TROUBLESHOOTING.md)
- [Open an Issue](https://github.com/corbat/corbat-coco/issues)

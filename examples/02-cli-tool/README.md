# Example: CLI Tool with Node.js

This example demonstrates using Corbat-Coco to build a command-line tool for file processing.

## What Gets Built

A CLI tool for batch image processing with:

- **Multiple Commands**: resize, convert, compress, watermark
- **Glob Patterns**: Process multiple files at once
- **Progress Bars**: Visual feedback during processing
- **Configuration**: JSON config file support
- **Dry Run**: Preview changes before applying
- **Tests**: Comprehensive test suite
- **Documentation**: Auto-generated help

## Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript
- **CLI Framework**: Commander.js
- **Image Processing**: Sharp
- **Progress**: ora + cli-progress
- **Testing**: Vitest

## Prerequisites

1. **Corbat-Coco installed**:
   ```bash
   npm install -g corbat-coco
   ```

2. **Anthropic API key**:
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```

## Quick Start

```bash
# Create new directory
mkdir img-cli && cd img-cli

# Initialize with Corbat-Coco
coco init .

# When asked, describe what you want:
# "A CLI tool for batch image processing. Commands: resize,
#  convert formats, compress, add watermark. Support glob
#  patterns, progress bars, and dry-run mode."

# Run planning and build
coco plan
coco build
```

## Configuration

Pre-configured `.coco/config.json`:

```json
{
  "project": {
    "name": "img-cli",
    "version": "0.1.0",
    "description": "CLI tool for batch image processing"
  },
  "provider": {
    "type": "anthropic",
    "model": "claude-sonnet-4-20250514"
  },
  "quality": {
    "minScore": 85,
    "minCoverage": 80,
    "maxIterations": 10
  },
  "stack": {
    "language": "typescript"
  }
}
```

## Expected Output

```
img-cli/
├── src/
│   ├── commands/
│   │   ├── resize.ts
│   │   ├── convert.ts
│   │   ├── compress.ts
│   │   └── watermark.ts
│   ├── lib/
│   │   ├── processor.ts
│   │   └── config.ts
│   ├── utils/
│   │   ├── progress.ts
│   │   └── files.ts
│   └── index.ts
├── test/
│   └── *.test.ts
├── package.json
└── README.md
```

## Generated CLI Usage

```bash
# Resize images
img resize "photos/*.jpg" --width 800 --height 600

# Convert to WebP
img convert "images/*.png" --format webp --quality 80

# Compress images
img compress "uploads/**/*.jpg" --quality 75

# Add watermark
img watermark "gallery/*.jpg" --text "© 2024" --position bottom-right

# Dry run (preview only)
img resize "*.jpg" --width 400 --dry-run

# Use config file
img --config img.config.json
```

## Time Estimate

~20-35 minutes total build time.

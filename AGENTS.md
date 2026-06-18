# Corbat-Coco Agent Instructions

This file is the cross-agent entry point for repositories that read `AGENTS.md`.

## Canonical Project Guidance

Read and follow [`CLAUDE.md`](CLAUDE.md). It remains the maintained source for
project structure, build commands, coding style, quality thresholds, testing,
and commit conventions.

## Compatibility Notes

- Do not duplicate the full contents of `CLAUDE.md` here.
- Keep Claude-specific files under `.claude/` intact for future Claude Code
  compatibility.
- Use `.agents/skills/` only for shared wrappers or references when needed;
  do not copy `.claude/skills/` wholesale.
- Codex-specific metadata should stay minimal and reference shared guidance
  instead of creating a second source of truth.

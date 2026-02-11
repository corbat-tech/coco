# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [1.6.0] - 2026-02-11

### Added
- **Real-time command streaming with heartbeat:** Long-running shell/build commands now show live progress instead of black box spinner
  - Stream stdout/stderr output in real-time instead of buffering until completion
  - CommandHeartbeat monitor shows elapsed time every 10 seconds for commands running >10s
  - Warning alerts when command silent for >30 seconds to detect hung processes
  - Applied to bash tool (bash_exec) for all shell commands
  - Applied to all build tools: runScriptTool (npm/pnpm/yarn scripts), installDepsTool (package installation), makeTool (Makefile targets), tscTool (TypeScript compilation)
  - Eliminates "black box" experience during npm install, webpack builds, and other long operations (360+ second operations now have visible progress)

- **Concurrent task management:** ✅ **FULLY WORKING** - Users can now provide input while COCO works
  - Interruption handler captures user input during agent execution using background line capture
  - LLM-based interruption classifier intelligently routes user input:
    - **Modify:** Add context to current task ("also add validation", "use PostgreSQL instead")
    - **Interrupt:** Cancel current work ("stop", "cancel", "wait")
    - **Queue:** Add new tasks to background queue ("also create a README", "add tests for X")
    - **Clarification:** Ask questions about ongoing work ("why did you choose X?", "what's the status?")
  - Background task manager integration for queued tasks
  - Visual feedback showing received interruptions and routing decisions
  - Synthesized messages automatically added to session for "modify" actions
  - **UX:** Clean visual indicator shows when interruption mode is active
  - **Input:** User sees their typing normally, not mixed with agent output

### Changed
- Bash tool (`bashExecTool`) now uses streaming mode with `buffer: false` for immediate output visibility
- All build tools now use streaming mode for real-time feedback
- Command execution provides live feedback with heartbeat statistics showing elapsed time
- Test mocks updated to use Promise with Object.assign instead of thenable pattern (oxlint compliance)
- `consumeInterruptions()` returns full `QueuedInterruption[]` objects instead of just strings
- `QueuedInterruption` type exported from interruption-handler for external use
- Input handler refactored with `enableBackgroundCapture()` and `disableBackgroundCapture()` methods
- REPL loop now uses background capture instead of full pause during agent turns
- Main REPL loop integrates interruption classification and background task management

### Fixed
- Long-running commands no longer appear frozen or hung - users see real-time progress
- Users can now tell if command is progressing or actually stalled
- Oxlint warnings in test mocks resolved (no-thenable, no-unused-vars)
- Users can now interact during long-running agent tasks - stdin capture works in background
- User input during agent work is properly classified and routed (modify/interrupt/queue/clarification)

---

## [1.5.0] - 2026-02-11

### Added
- **Context-aware stack detection:** COCO now auto-detects project technology stack at startup
  - Detects language/runtime: Node.js, Java, Python, Go, Rust
  - Extracts dependencies from package.json, pom.xml, build.gradle, pyproject.toml, Cargo.toml, go.mod
  - Infers frameworks (Spring Boot, React, FastAPI, etc.) from dependencies
  - Detects package manager (npm, pnpm, yarn, maven, gradle, cargo, pip, go)
  - Detects build tools and testing frameworks
  - Enriches LLM system prompt with stack context to prevent mismatched technology suggestions
  - **Prevents COCO from suggesting Node.js packages in Java projects (and vice versa)**
- **CommandHeartbeat utility:** Infrastructure for monitoring long-running commands (foundation for future streaming feature)
  - Tracks elapsed time and silence duration
  - Configurable callbacks for progress updates and warnings

### Changed
- REPL startup now includes stack detection phase
- System prompt enriched with project technology context including frameworks, dependencies, and build tools
- `ReplSession` type extended with `projectContext` field
- Stack information displayed during REPL session to help user understand detected environment

### Fixed
- Prevents COCO from suggesting incompatible technologies for project stack (major UX improvement)
- Type-safe dependency parsing with proper null checks

---

## [1.4.0] - 2026-02-10

### Added
- `/full-access` command: auto-approve safe commands within project directory with comprehensive safety guards
  - Blacklist of 60+ dangerous commands that are never auto-approved
  - Path sandboxing: only works within project directory
  - Toggle with `/full-access [on|off|status]`
- `/update-coco` command: self-update to latest npm version
  - Checks npm for latest version
  - Auto-runs `npm install -g @corbat-tech/coco@latest`
  - Natural language support: "update coco" triggers the command
  - Aliases: `/upgrade`, `/self-update`
- Status bar infrastructure for persistent context display (project path, provider/model, mode indicators)
- Interruption handler for queuing user input during agent processing (foundation for future feature)
- Release workflow documentation (`docs/RELEASE_WORKFLOW.md`) with complete step-by-step guide

### Changed
- **COCO mode now enabled by default** for better out-of-the-box quality
  - Users can disable with `/coco off` if they prefer faster responses
  - Updated welcome message to reflect default state
  - Default changed from OFF to ON in preference loading
- **README completely redesigned** for better clarity and visual appeal
  - Cleaner structure with badges and quick navigation
  - Renamed branding from "Corbat-Coco" to just "Coco"
  - Added "The Problem / The Solution" section
  - Improved feature showcase with tables and examples
  - Better command documentation with natural language examples
- Welcome screen shows COCO mode as enabled by default with helpful context
- Improved hint messages for COCO and full-access modes

### Fixed
- Removed unused `formatStatusBar` import causing TypeScript compilation error
- Fixed lint warnings in test files (unused imports)

### Documentation
- Added `RELEASE_WORKFLOW.md` with complete release process ("sube versión")
- Updated README with new branding and clearer value proposition
- Improved command documentation with bilingual examples

---

## [1.3.0] - 2026-02-10

### Added
- `/open` skill and `open_file` tool: open files with system default app (HTML→browser, images→viewer) or execute scripts (.py, .sh, .js, .ts, .rb, etc.) with auto-detected interpreter
- `/ship` skill: complete 10-step release pipeline (preflight → review → tests → lint → branch → version → commit → PR → CI checks → merge/release)
- GitHub CLI tools (`gh_check_auth`, `gh_repo_info`, `gh_pr_create`, `gh_pr_merge`, `gh_pr_checks`, `gh_pr_list`, `gh_release_create`)
- `ShipConfigSchema` for configuring release workflow defaults
- Bilingual intent patterns (ES/EN) for `open`, `exec`, `ship`, and `release` commands
- LLM classifier updated with `ship` and `open` intents for fallback classification

### Changed
- `.gitignore` now excludes `cov-temp/`, `coverage-temp/`, and `benchmark-results.json`
- `CLAUDE.md` cleaned up (removed stale `AGENT_PROMPT.md` reference)
- Minor formatting improvements in ship step files (lint-security, preflight, review, version)

### Removed
- Old audit documents (`docs/audits/`) and improvement roadmaps
- Stale coverage-temp and cov-temp directories
- Redundant markdown files (MASTER_PLAN, IMPROVEMENT_ROADMAP, IMPLEMENTATION_COMPLETE, etc.)

---

## [1.2.3] - 2026-02-10

### Added
- Thinking feedback: LLM thinking blocks displayed in real-time during REPL sessions
- `authorize_path` tool for runtime directory access authorization
- Git tools available to sub-agents (explore, plan, test, debug, review)
- Review output rendered as markdown tables via `marked-terminal`

### Changed
- Git tools (`git_status`, `git_diff`, `git_log`, `git_branch`) now respect `cwd` parameter correctly
- Review pattern detection skips `console.log` in CLI/REPL files (`excludePaths`)
- Test coverage check is filesystem-aware: suppresses noise when test file exists on disk for small changes (< 15 additions)
- Review findings displayed as markdown tables ordered by severity instead of raw chalk output

### Fixed
- Git `simpleGit` initialization uses `{ baseDir }` object form for reliable cwd handling
- `oxfmt` formatting issues in `prompts.ts` and `authorize-path.ts`
- `no-control-regex` linter warning in `renderer.ts` (intentional ANSI regex)
- False positive review findings for CLI console.log and already-tested files

---

## [1.2.2] - 2026-02-10

### Fixed
- Input line-wrap: extra blank line when user input fills first terminal row
- Header box alignment: replaced custom `visualWidth()` with `string-width` package
- Bottom separator disappearing after pressing Enter (`eraseDown` clearing too much)

### Changed
- New header design: "COCO" with tagline and color hierarchy
- Added `string-width` dependency for reliable terminal string width measurement

---

## [1.2.0] - 2026-02-10

### Fixed
- 25 bug fixes across the codebase
- README fully rewritten

### Changed
- Dependency updates: oxlint, @anthropic-ai/sdk, openai, ora, @types/node
- CI: bump actions/upload-artifact from 4 to 6

---

## [1.1.0] - 2025-02-10

### Added
- 12-dimension quality scoring system with real analyzers
- Comprehensive test suite: 4,350+ tests across 171 test files
- Test coverage for 19 previously untested modules (cost-estimator, convergence-analyzer, context-enhancer, git-simple, skill-enhancer, diff-preview, provider-bridge, hooks, code-analyzer, git-enhanced, smart-suggestions, coordinator, progress, recovery, build-verifier, import-analyzer, simple-agent, agent-coordinator, fix-generator, test-analyzer, onboarding-v2)
- Multi-agent coordination with weighted scoring and tool-use
- Interactive onboarding with multi-provider support (Anthropic, OpenAI, Google, LM Studio)
- REPL with image attachment, diff preview, and smart suggestions
- Budget tracking and cost estimation for LLM operations
- Convergence analyzer for quality iteration loops
- Build verifier with real compilation and lint checks
- Import analyzer with circular dependency detection
- Recovery system with automatic LLM provider fallback cycling
- IMPROVEMENT_RESULTS.md documenting v1.1.0 audit and improvements

### Changed
- Test coverage increased from ~55% to 80%+ across all metrics
- Quality thresholds raised to 80% (lines, functions, branches, statements)
- Removed all excluded files from vitest.config.ts coverage exclusion list
- Enhanced README with badges and demo
- Connected Orchestrator with real Phase Executors
- Improved CLI commands (plan, status, build, resume, config)
- Multi-agent planning uses deterministic task IDs and normalized dependencies
- REPL initializes multi-agent provider bridge automatically
- Code review overall score recalculated after applying real coverage

### Fixed
- Recovery system now correctly classifies "overloaded" and "capacity" as LLM errors
- Cost estimator partial model matching uses longest-match-first ordering
- Smart suggestions empty catch block detection uses `endsWith()` for accuracy
- Test failure analyzer stack trace parsing with separate regex patterns for Node.js and simple formats
- Test failure analyzer root cause categorization ordering (syntax before type)
- Import analyzer circular dependency detection with .js→.ts extension mapping
- Onboarding LM Studio tests properly mock fetch to prevent real network calls
- All 9 lint warnings resolved (unused variables, self-assignments, regex patterns)
- Phase executor exports (Converge, Orchestrate, Complete, Output)
- CLI command exports and registrations
- TypeScript compilation errors in persistence.ts
- Re-export conflicts in phases/index.ts
- Agent coordinator preserves task metadata through dependency levels
- Avoid false build-failure issues when correctness analysis is unavailable
- OAuth callback server cleanup and test reliability improvements

---

## [1.0.2] - 2025-01-XX

### Fixed
- Package renamed to @corbat-tech/coco
- Version read dynamically from package.json

---

## [1.0.1] - 2025-01-XX

### Fixed
- Quality scoring and iteration improvements

---

## [1.0.0] - 2025-01-XX

### Added
- Initial stable release
- All core COCO methodology features

---

## [0.1.0] - 2024-XX-XX

### Added

#### Core Features
- **COCO Methodology**: Four-phase development approach
  - **CONVERGE**: Requirements discovery with interactive Q&A
  - **ORCHESTRATE**: Architecture planning with ADR generation
  - **COMPLETE**: Code generation with iterative quality improvement
  - **OUTPUT**: CI/CD and deployment artifact generation

#### CLI Commands
- `coco init [path]` - Initialize a new project
- `coco plan` - Run discovery and architecture planning
- `coco build` - Execute tasks with quality iteration
- `coco status` - Show current progress and metrics
- `coco resume` - Resume from last checkpoint
- `coco config` - Manage configuration settings

#### Quality System
- Multi-dimensional quality scoring (11 dimensions)
- Configurable thresholds (default: 85/100 minimum)
- Convergence detection algorithm
- Automatic iteration until quality targets met
- Quality dimensions:
  - Correctness (15%)
  - Completeness (10%)
  - Robustness (10%)
  - Readability (10%)
  - Maintainability (10%)
  - Complexity (8%)
  - Duplication (7%)
  - Test Coverage (10%)
  - Test Quality (5%)
  - Security (8%)
  - Documentation (4%)
  - Style (3%)

#### Persistence & Recovery
- Automatic checkpointing every 5 minutes
- Recovery from any interruption
- Version history for all tasks
- Rollback capability

#### LLM Integration
- Anthropic Claude provider (claude-sonnet-4-20250514)
- Tool use support
- Streaming responses
- Context management

#### Tools
- File operations (read, write, edit, glob)
- Bash command execution
- Git operations (status, commit, push, etc.)
- Test runner integration (vitest, jest, mocha)
- Quality analysis (linting, complexity)

#### Documentation
- Architecture documentation with C4 diagrams
- Architecture Decision Records (ADRs)
- Comprehensive README
- Contributing guidelines

### Technical Details

- **Runtime**: Node.js 22+
- **Language**: TypeScript 5.7+ with strict mode
- **Modules**: ESM only (no CommonJS)
- **CLI Framework**: Commander.js 13
- **Validation**: Zod 3.24
- **Testing**: Vitest 3
- **Linting**: oxlint
- **Formatting**: oxfmt

### Known Limitations

- Requires Anthropic API key (no local models yet)
- Node.js 22+ required (may limit some users)
- Single LLM provider (Anthropic only)

---

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| 1.4.0 | 2026-02-10 | COCO mode default ON, /full-access, /update-coco, redesigned README |
| 1.3.0 | 2026-02-10 | /open tool, /ship release pipeline, GitHub CLI tools, repo cleanup |
| 1.2.3 | 2026-02-10 | Thinking feedback, git tools fix, authorize_path, review markdown output |
| 1.2.2 | 2026-02-10 | Input line-wrap fix, header redesign, string-width |
| 1.2.0 | 2026-02-10 | 25 bug fixes, README rewrite, dependency updates |
| 1.1.0 | 2025-02-10 | Pre-release quality improvements, 80%+ coverage, 12-dimension scoring |
| 1.0.2 | 2025-01 | Package rename, dynamic version |
| 1.0.1 | 2025-01 | Quality scoring improvements |
| 1.0.0 | 2025-01 | Initial stable release |
| 0.1.0 | TBD | Initial pre-release |

---

## Upgrade Guide

### Upgrading to 0.1.0

This is the initial release. No upgrade steps required.

Future versions will include upgrade guides here.

---

## Links

- [GitHub Repository](https://github.com/corbat/corbat-coco)
- [Documentation](https://github.com/corbat/corbat-coco/tree/main/docs)
- [Issues](https://github.com/corbat/corbat-coco/issues)

[Unreleased]: https://github.com/corbat-tech/corbat-coco/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/corbat-tech/corbat-coco/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/corbat-tech/corbat-coco/compare/v1.2.3...v1.3.0
[1.2.3]: https://github.com/corbat-tech/corbat-coco/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/corbat-tech/corbat-coco/compare/v1.2.0...v1.2.2
[1.2.0]: https://github.com/corbat-tech/corbat-coco/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/corbat-tech/corbat-coco/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/corbat-tech/corbat-coco/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/corbat-tech/corbat-coco/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/corbat-tech/corbat-coco/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/corbat-tech/corbat-coco/releases/tag/v0.1.0

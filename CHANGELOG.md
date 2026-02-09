# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial test infrastructure with mocks
- GitHub Actions CI/CD workflows
- Contributing guidelines
- Example projects
- SECURITY.md with vulnerability reporting guidelines
- Complete phase executor implementations
- Agent coordination coverage tests
- Unresolved dependency reporting in multi-agent planning

### Changed
- Enhanced README with badges and demo
- Connected Orchestrator with real Phase Executors
- Improved CLI commands (plan, status, build, resume, config)
- Reduced test coverage threshold to 55% temporarily
- Multi-agent planning uses deterministic task IDs and normalized dependencies
- REPL initializes multi-agent provider bridge automatically
- Code review overall score recalculated after applying real coverage

### Fixed
- Phase executor exports (Converge, Orchestrate, Complete, Output)
- CLI command exports and registrations
- TypeScript compilation errors in persistence.ts
- Lint errors (unused imports, regex escapes, async/await)
- Re-export conflicts in phases/index.ts
- Agent coordinator now preserves task metadata through dependency levels
- Avoid false build-failure issues when correctness analysis is unavailable
- Multi-agent planning documentation updated with dependency notes
- OAuth callback server cleanup and test reliability improvements

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
| 0.1.0 | TBD | Initial release |

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

[Unreleased]: https://github.com/corbat/corbat-coco/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/corbat/corbat-coco/releases/tag/v0.1.0

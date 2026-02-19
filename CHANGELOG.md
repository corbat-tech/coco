# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-02-20

### Added

#### Unified Skills System (Fork 3 — upgrade-version-2)
- **`createUnifiedSkillRegistry`** — multi-scope discovery loading skills from global (`~/.claude/skills/`), project (`.coco/skills/`), and built-in sources automatically
- **Project-local skills** in `.coco/skills/` — committed alongside source code, scoped to the repo
- **YAML/JSON skill format** support alongside Markdown `SKILL.md` files
- **`skill-enhancer`** — enriches skill context before injection, adding codebase-specific metadata
- **Automatic skill discovery** — zero-config; new files in watched directories are picked up at runtime

#### WSL Support & Security (Fork 2 — extra)
- **Windows Subsystem for Linux (WSL)** detection and path translation — coco now works natively inside WSL2 environments
- **`execFile` security fix** — replaced `exec` with `execFile` for all subprocess calls, eliminating shell-injection risk in path-handling code
- **`diff-preview` improvements** — smoother rendering, correct line-count display for large diffs

#### Extended Provider Support & REPL Features (Fork 1 — everything-claude-code)
- **`/check` command** — runs typecheck + lint + test pipeline and reports results inline in the REPL
- **Multi-modal input** — paste screenshots or images directly with `Ctrl+V`; images are base64-encoded and sent to vision-capable providers
- **Full-Access mode** — `/full-access [on|off]` auto-approves safe tool calls with configurable safety guards; persists across sessions
- **Parallel agent execution** — tasks with no mutual dependencies are now dispatched concurrently across specialized agents
- **Codex / OpenAI OAuth provider** — authenticate via browser OAuth flow (no API key required)
- **xAI / Grok provider** (`XAI_API_KEY`) — Grok-2, Grok-2-vision models
- **Cohere provider** (`COHERE_API_KEY`) — Command R+, Command R

#### Quality Analyzers — Language-Specific (Phase 3)
- **React quality analyzers** (`src/quality/analyzers/react/`)
  - `ReactComponentAnalyzer` — detects missing key props, untyped `props: any`, missing JSDoc, large components (>300 LOC)
  - `ReactA11yAnalyzer` — WCAG 2.1 rule checks: missing `alt`, missing `aria-label`, non-semantic click handlers without keyboard support, empty link text
  - `ReactHookAnalyzer` — Rules of Hooks enforcement: conditional hooks, missing `useEffect` dependencies, stale closure detection
  - `registerReactAnalyzers(registry, projectPath)` for plugin registration
- **Java quality analyzers** (`src/quality/analyzers/java/`)
  - `JavaComplexityAnalyzer` — cyclomatic complexity per method, class metrics
  - `JavaSecurityAnalyzer` — OWASP pattern detection (SQL injection, hardcoded credentials, unsafe deserialization, path traversal, XXE)
  - `JavaDocumentationAnalyzer` — Javadoc coverage for public methods and classes
  - `registerJavaAnalyzers(registry, projectPath)` for plugin registration

#### Project-Level Configuration (Phase 4.1)
- **`.coco.config.json`** — project-committed config file alongside source code
  - Schema: `name`, `version`, `description`, `language`, `quality` overrides, `analyzers` (Java/React), `extend`
  - Config inheritance via `extend` field (relative path to base config, arrays concatenated, scalars override)
  - `loadProjectConfig(projectPath)` — loads and resolves inheritance chain
  - `saveProjectConfig(config, projectPath)` — writes validated config
  - `validateProjectConfig(raw)` — Zod-based validation returning typed result
  - `mergeProjectConfigs(base, override)` — explicit merge utility
  - `createDefaultProjectConfig(name, language?)` — factory for new projects
  - All symbols re-exported from `src/config/index.ts`

#### Quality Bridge (Phase 4.2)
- **`src/quality/quality-bridge.ts`** — translates `ProjectConfig` into internal quality types
  - `resolvedThresholds(config)` → `QualityThresholds` (merges `minScore`, `minCoverage`, `securityThreshold`, `maxIterations`)
  - `resolvedWeights(config)` → `QualityWeights` (normalised to sum 1.0)
  - `resolvedConvergenceOptions(config)` → `ConvergenceOptions`
  - `thresholdsFromProjectConfig`, `mergeThresholds`, `weightsFromProjectConfig`, `convergenceOptionsFromProjectConfig` — composable helpers
  - `DEFAULT_CONVERGENCE_OPTIONS` exported constant

#### Quality Formatter (Phase 4.3)
- **`src/quality/quality-formatter.ts`** — terminal ASCII quality reports (no ANSI colours, CI-friendly)
  - `QualityFormatter` class with `formatSummary`, `formatTable`, `formatIssues`, `formatSuggestions`, `formatFull`
  - Box-drawing table with score bars (`█░`) and per-dimension pass/fail icons
  - Severity-prefixed issue list; suggestions sorted by priority then estimated impact

#### Report Exporter (Phase 4.4)
- **`src/quality/report-exporter.ts`** — multi-format quality report export
  - `QualityReportExporter` class with `toJson`, `toMarkdown`, `toHtml`, `saveReport`
  - JSON: pretty-printed, serialisable
  - Markdown: tables + issues + suggestions + footer
  - HTML: self-contained with inline CSS, progress bars, XSS-safe (`htmlEscape`)
  - `saveReport` persists to `.coco/reports/quality-<ISO-timestamp>.<ext>`

#### GitHub Actions Integration (Phase 5)
- **`src/phases/output/github-quality-workflow.ts`** — YAML workflow generator
  - `generateQualityWorkflow(options)` — produces `.github/workflows/quality.yml`
  - Supports `nodeVersion`, `packageManager` (pnpm/npm/yarn), `failOnBelowMinimum`, `commentOnPR`, `branches`
  - pnpm setup step only included when `packageManager === "pnpm"`
  - `continue-on-error` only set when `failOnBelowMinimum === false`
  - `formatQualityPRComment(evaluation, options)` — Markdown PR comment with collapsible `<details>` blocks

#### Multi-Provider Expansion
- **6 new LLM providers** added to provider support:
  - **Groq** (`GROQ_API_KEY`) — Llama 4, Mixtral, Gemma; ultra-low latency inference
  - **OpenRouter** (`OPENROUTER_API_KEY`) — 200+ models via unified OpenAI-compatible API
  - **Mistral AI** (`MISTRAL_API_KEY`) — Mistral Large, Codestral (code-optimised)
  - **DeepSeek** (`DEEPSEEK_API_KEY`) — DeepSeek-V3, DeepSeek-R1 (reasoning)
  - **Together AI** (`TOGETHER_API_KEY`) — Llama 4, Qwen, Falcon; pay-per-token
  - **Hugging Face** (`HF_API_KEY`) — any HF Inference Endpoint

#### Test Infrastructure (Phase 7)
- **Java fixture project** (`test/fixtures/java-project/`)
  - `UserService.java` — well-documented, security-clean service
  - `VulnerableService.java` — intentional OWASP vulnerabilities (SQL injection, hardcoded creds, unsafe deserialization)
  - `.coco.config.json` with `minScore: 70`, `maxIterations: 5`
- **React fixture project** (`test/fixtures/react-project/`)
  - `UserCard.tsx` — fully-typed, a11y-correct, hooks-compliant component
  - `BadComponent.tsx` — missing key, missing alt, no keyboard support
  - `.coco.config.json` with React analyzer options
- **Integration test suite** (`test/integration/quality-pipeline.test.ts`) — 27 tests covering the full pipeline end-to-end (config load → language detection → analyzers → registry → exporter/formatter) using real fixture files, zero mocks

### Changed
- **Provider table** in README expanded from 6 to 12 providers
- **Known Limitations** — removed "TypeScript/JavaScript first" limitation (Java/React now fully supported)
- **Test count** updated to 5,100+
- **`src/cli/repl/index.ts` modularisation** — 5 heavy static imports converted to lazy dynamic imports (`createLLMClassifier`, `loadFullAccessPreference`, `createConcurrentCapture`, `createFeedbackSystem`, `createInputEcho`); 4 unnecessary `export * from` re-exports removed, reducing startup memory footprint
- **Test configuration** — `src/cli/repl/index.test.ts` excluded from standard vitest run (interactive REPL causes OOM in headless worker environments); `pool: "forks"` set for improved isolation; `NODE_OPTIONS='--max-old-space-size=4096'` applied to all test scripts

### Fixed
- **Post-merge import breakage** (Fork 4 — solve-bugs) — corrected broken import paths introduced during the 4-fork merge; removed leftover dead code and stale type references
- **`/open` command** — restored correct file-open behaviour in REPL after CLI refactor

### Documentation (Phase 6)
- **`docs/guides/QUALITY.md`** (new) — complete quality analysis guide: 12-dimension weight table, language support matrix, React/Java rule references, config examples, terminal output format, convergence algorithm, ignore patterns
- **`docs/guides/GITHUB-ACTIONS.md`** (new) — GitHub Actions integration guide: full `quality.yml` template, npm/yarn/pnpm variants, Java/JaCoCo integration, monorepo matrix strategy, PR comment format, JSON report schema
- **`docs/guides/PROVIDERS.md`** (updated) — expanded to 12 providers with COCO Mode Compatibility Matrix (9 rows), Cost Considerations table (10 rows), API Key reference table
- **`docs/guides/CONFIGURATION.md`** (updated) — new "Project-Level Configuration" section with full `.coco.config.json` schema, field reference, `extend` inheritance example, precedence chain

---

## [1.8.0] - 2026-02-18

### Added
- **Release workflow skills for Claude Code**
  - `/release [patch|minor|major]`: Full 12-step release cycle with auto-retry on CI failures
  - `/preflight`: Validation-only checks with detailed status report table
  - `/hotfix`: Streamlined patch release for urgent fixes
  - Supporting templates for PR body and changelog formatting
  - All skills use `disable-model-invocation: true` for safety (only user-triggered)

### Changed
- **Dependency updates** (from pending dependabot PRs)
  - `@typescript-eslint/parser` 8.54.0 → 8.55.0
  - `@typescript-eslint/typescript-estree` 8.54.0 → 8.55.0
  - `minimatch` 10.1.2 → 10.2.0
  - `simple-git` 3.30.0 → 3.31.1
  - `openai` 6.18.0 → 6.22.0
  - `oxfmt` 0.28.0 → 0.33.0
  - `typedoc` 0.28.16 → 0.28.17

### Fixed
- **`/open` command not working in REPL**
  - The SkillRegistry (containing `/open`, `/review`, `/ship`) was implemented but never connected to the REPL command execution flow
  - `executeSlashCommand` now falls back to the SkillRegistry when a command is not found in the legacy SlashCommand array
  - Also fixes `/review` and `/ship` which had the same disconnection issue

---

## [1.7.0] - 2026-02-17

### Added
- **Concurrent input system with auto-classification and abort/rollback**

---

## [1.6.0] - 2026-02-17

### Added
- **Real-time streaming for bash commands and build scripts**
  - `bash_exec` tool now streams output in real-time instead of showing it all at the end
  - `run_script` tool streams npm/pnpm/yarn command output as it happens
  - Heartbeat monitoring shows elapsed time for commands running >10 seconds
  - Better visibility into test runs, builds, and long-running operations
- **Enhanced system prompt for better tool calling**
  - Added explicit WRONG vs CORRECT examples to prevent LLMs from describing instead of executing
  - Emphasized "TOOLS FIRST, then brief confirmation" approach
  - Significantly improved reliability with Kimi, Codex, and other OpenAI-compatible providers
- **COCO mode visual feedback during quality iterations**
  - "Running quality checks..." (after 8s)
  - "Iterating for quality..." (after 15s)
  - "Verifying implementation..." (after 25s)
  - "Quality iteration in progress... (Xs)" (after 40s+)
  - Users now know the agent is actively working, not frozen
- **JSON repair for streaming responses**
  - Added `jsonrepair` dependency to auto-fix malformed JSON from unstable providers
  - Reduces parse errors with Kimi/Moonshot and other streaming APIs

### Improved
- **COCO mode timeout optimization**
  - Unified 120s timeout for all providers (previously had aggressive 10s timeouts)
  - Quality iteration loops can now complete without premature interruption
  - Better quality results as verification steps aren't cut off
- **Better user feedback during long operations**
  - Spinner messages now context-aware (different for COCO mode vs normal mode)
  - Shows processing + quality checking status in COCO mode

### Documentation
- **ANALISIS_COCO_MODE.md**: Deep analysis of COCO mode behavior and why quality iterations matter
- **docs/guides/PROVIDERS.md**: Comprehensive provider compatibility guide
  - Detailed comparison of Claude, OpenAI, Kimi, local models
  - COCO mode compatibility matrix
  - Recommendations and troubleshooting

### Fixed
- Removed DEBUG console logs that were contaminating user output
- Cleaned up unused TypeScript variables

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
| 2.0.0 | 2026-02-19 | React/Java analyzers, ProjectConfig, quality bridge, report exporter, GitHub Actions generator, 6 new providers |
| 1.9.0 | 2026-02-19 | Parallel development skills for isolated feature work |
| 1.8.0 | 2026-02-18 | Release workflow skills, /open fix, SkillRegistry integration |
| 1.7.0 | 2026-02-17 | Concurrent input with auto-classification and abort/rollback |
| 1.6.0 | 2026-02-17 | Streaming, JSON repair, COCO mode feedback, provider guide |
| 1.5.0 | 2026-02-11 | Stack detection, command heartbeat |
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

[Unreleased]: https://github.com/corbat-tech/corbat-coco/compare/v1.8.0...HEAD
[1.8.0]: https://github.com/corbat-tech/corbat-coco/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/corbat-tech/corbat-coco/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/corbat-tech/corbat-coco/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/corbat-tech/corbat-coco/compare/v1.4.0...v1.5.0
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

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.25.2] - 2026-04-08

### Fixed
- **Atlassian MCP OAuth browser launch reliability** — MCP OAuth now uses cross-platform browser fallbacks (including WSL paths like `cmd.exe /c start` / `wslview`) instead of a single `xdg-open` attempt.
- **Bearer-with-missing-token fallback** — when MCP config declares `auth.type: "bearer"` but no token is actually available, Coco now falls back to interactive OAuth instead of failing with token-only behavior.
- **Regression coverage for auth fallback** — added test coverage to ensure 401 + missing bearer token triggers OAuth and retries with bearer auth.

## [2.25.1] - 2026-04-08

### Added
- **MCP remote OAuth automation** — HTTP MCP transport now handles `401 Unauthorized` by triggering OAuth discovery + browser login (PKCE), then automatically retries the request with bearer token.
- **MCP OAuth token store** — added dedicated MCP OAuth persistence at `~/.coco/tokens/mcp-oauth.json` with regression tests for secure writes and refresh behavior.

### Changed
- **MCP HTTP lifecycle integration** — MCP HTTP transport now receives server name context for clearer auth/log flows during remote server startup.
- **Permissions suggestion behavior** — startup recommendation prompt is now first-run only (`recommendedAllowlistPrompted`), avoiding repeated prompts on every session.
- **Provider fallback persistence** — when startup falls back to another configured cloud provider, Coco now persists that provider/model as last-used preference for future sessions.

### Fixed
- **Atlassian/remote MCP auth flow gap** — Coco previously expected preconfigured OAuth tokens and could not initiate interactive auth for remote MCP servers. It now performs standards-based MCP OAuth authorization flow.
- **OAuth client registration stability** — client IDs are now keyed by authorization server + redirect URI to prevent redirect mismatch issues in strict OAuth servers.
- **MCP token file hardening** — MCP OAuth token store is written with restricted file permissions (`0600`).
- **MCP token expiry handling** — expired MCP OAuth tokens now attempt refresh-token exchange before requiring interactive re-authentication.

## [2.25.0] - 2026-04-08

### Added
- **Cross-agent global skill discovery** — Coco now scans compatible global skill directories by default (`~/.codex/skills`, `~/.gemini/skills`, `~/.opencode/skills`, `~/.claude/skills`, `~/.agents/skills`, `~/.coco/skills`) and supports configurable multi-directory overrides.
- **`coco skills doctor` command** — added diagnostics for discovery paths, conflicts, and winning skill sources, including disabled-skill visibility.

### Changed
- **Skills config schema extended** — `skills.globalDirs` and `skills.projectDirs` are now supported (while preserving backward compatibility with single-path `globalDir`/`projectDir`).
- **MCP configuration resilience and coverage** — MCP config and registry paths received hardening and broader regression coverage to improve stability during config loading and server resolution.

### Fixed
- **Skill discovery path resolution** — relative `projectDirs` now resolve against `projectPath` (not process cwd), preventing incorrect discovery in non-cwd project contexts.
- **Release diagnostics accuracy** — `skills doctor` now reports active skills after applying `skills.disabled`, avoiding false “active” counts.

## [2.24.2] - 2026-03-25

### Fixed
- **OpenAI OAuth fallback startup regression** — when OpenAI was selected through silent fallback with OAuth configured (without `OPENAI_API_KEY`), REPL startup could still initialize the plain OpenAI provider and fail with `OpenAI API key not provided`. The fallback path now refreshes OAuth token and exports `OPENAI_CODEX_TOKEN` so startup resolves to internal `codex` consistently.
- **Regression coverage for provider fallback** — added a targeted test to ensure OAuth fallback sets `OPENAI_CODEX_TOKEN` and prevents the startup auth mismatch path.

## [2.24.1] - 2026-03-25

### Fixed
- **Provider preference persistence is now truly global** — `getLastUsedProvider`, `getLastUsedModel`, and `saveProviderPreference` now read/write `~/.coco/config.json` explicitly, avoiding project-level config overrides that caused intermittent provider/model resets.
- **OpenAI OAuth startup path in REPL** — `ensureConfiguredV2` now correctly handles preferred `openai` with saved OAuth tokens, routes internal availability checks through `codex`, and avoids false onboarding loops.
- **Silent provider switching reduced** — when a configured preferred provider is unavailable, startup no longer silently jumps to another provider before giving the user control.

### Changed
- **Configured provider detection normalized** — provider detection now accounts for OpenAI OAuth token envs and only treats local providers as preconfigured when there is explicit local configuration evidence.
- **Project init provider defaults** — new `.coco/config.json` now uses dynamic defaults from current global provider/model logic instead of hardcoded legacy Anthropic defaults.

## [2.24.0] - 2026-03-25

### Added
- **Resilient provider wrapper** (`ResilientProvider`) with provider-level retry + circuit-breaker policies and safe streaming retries (only before first emitted chunk to avoid duplicate partial output).
- **Provider resilience defaults by provider type** (remote vs local) with env kill-switch: `COCO_PROVIDER_RESILIENCE=0`.
- **Replay harness for agent-loop sessions** — deterministic fixtures for replaying streaming turns (including multi-iteration tool loops) without interactive prompts.
- **Release quality gate script** — `pnpm check:release` now runs stable typecheck/lint/test suites used as release criteria.
- **Turn quality metrics** in `AgentTurnResult` with score + execution telemetry (iterations, tool success/failure, error state, repeated-output suppression count).

### Changed
- **Unified tool-call assembly internals** — OpenAI/Codex streaming tool-call parsing now uses shared normalizers/builders instead of duplicated ad-hoc logic.
- **Agent-loop error handling policy** centralized via error classification (`abort`, `provider_non_retryable`, `provider_retryable`, `unexpected`) for clearer control flow and safer propagation.
- **Context efficiency improvement** — repeated identical tool outputs are suppressed in subsequent iterations to reduce context bloat and token waste.

### Fixed
- **OpenAI/Codex tool-call argument edge cases** (missing `index`, missing `item_id`, missing final `arguments`) now resolved by shared fallback strategy.
- **Model command persistence robustness** — `/model` no longer hard-fails the session when writing provider/model preference file fails.
- **Lint technical debt in core test paths** — removed/rewired recurrent warnings in release-critical suites; release gate now runs with zero lint warnings.

## [2.23.1] - 2026-03-25

### Fixed
- **OpenAI tool-call streaming argument assembly** — hardened Chat Completions streaming parsing for function/tool calls when compatible endpoints omit `index`/`id` in follow-up deltas, preventing malformed or empty tool inputs from reaching tools like `write_file`.
- **OpenAI Responses streaming correlation fallback** — improved function-call argument accumulation by supporting `item_id`, `output_index`, and single-builder fallback paths, and by preserving arguments already present in `response.output_item.added`.
- **Codex subscription provider tool-call parsing** — aligned `chatWithTools` and `streamWithTools` with robust Responses event handling (`item_id` + `output_index` fallbacks, missing `done.arguments` fallback to accumulated args), fixing empty argument payloads observed under browser-authenticated subscription flows.
- **Gemini multi-turn conversation conversion** — previous user turns are now preserved in history while only the final user turn is sent as the active message, improving context continuity in longer sessions.
- **Gemini function response mapping** — `functionResponse.name` now resolves to the original function name (when available) instead of blindly using `tool_use_id`, improving tool round-trip compatibility.
- **Gemini tool-call identifiers** — tool-call IDs are now unique and stable per response/stream event, avoiding collisions when the same function is called multiple times.

### Changed
- **README rewrite for technical accuracy** — replaced over-claiming language with a capability-focused, externally credible README aligned with implemented features, supported providers, and realistic limitations.

## [2.23.0] - 2026-03-25

### Added
- **Graceful iteration limit handoff** — when the agent reaches `maxToolIterations` mid-task, it now gives the LLM one final text-only turn to summarise what was completed, what remains, and what the user should do next. Previously the loop cut off with a static notice, leaving the user with no actionable context.
- **75% iteration budget warning** — at 75% of the iteration limit, a context message is injected into the last tool result telling the LLM to begin wrapping up. This allows the agent to finish cleanly before hitting the hard limit instead of being cut off mid-step.

### Improved
- **Streaming output noise suppression** — LLM text emitted during tool-calling iterations (intermediate reasoning, step narration) is now buffered and discarded. Only the final response — the one that contains no further tool calls — is streamed to the user. Agentic sessions are now significantly quieter and easier to follow.
- **Code block size cap** — streaming code blocks from LLM responses are capped at 50 lines (`MAX_STREAMING_CODE_LINES`). Blocks over the limit show the first 40 lines followed by `… N more lines · /copy X for full content`. Diff blocks are always shown in full.
- **System prompt output discipline** — added an explicit `Output Discipline` section to the system prompt with concrete rules: do not echo file contents, keep tool-iteration text minimal, only use code blocks when the code is the actual deliverable.
- **Tool skip messages now actionable for the LLM** — tool result messages for skipped/declined tools now distinguish the reason:
  - User declined → "You MUST find a different approach — do not retry the same action."
  - Timeout → "Try a simpler or faster alternative, or break into smaller steps."
  - Aborted → "Tool execution was cancelled."
  - Previously all skipped tools produced the generic "Tool execution was declined: …" message.

## [2.22.2] - 2026-03-25

### Fixed
- **Stream timeout no longer silently cancels the task** — when the LLM took over 120s to respond, the activity-based timeout called `stream.controller.abort()`, which caused the SDK to throw an `AbortError`. This was misclassified as a user cancellation, silently showing "Completed X tools before cancellation" and returning to the prompt without retrying. The timeout is now correctly surfaced as a retryable error, triggering automatic retry with error context.
  - Affects all streaming paths: `anthropic.ts` (`stream`, `streamWithTools`), `openai.ts` (`streamWithTools`, `streamViaResponses`, `streamWithToolsViaResponses`).
- **REPL flow never stops abruptly without feedback** — several paths returned to the prompt with little or no explanation:
  - After exhausting retries: now shows an actionable tip suggesting `/provider` or `/model` to switch.
  - Context compaction failure: was silently clearing the spinner; now shows a yellow warning so the user knows context was not compacted and can use `/clear` if needed.
  - After a cancelled turn with partial work: now shows a hint to retype the request to resume.

## [2.22.1] - 2026-03-25

### Fixed
- **Codex `truncation` parameter removed** — `chatgpt.com/backend-api/codex/responses` rejects `truncation: "auto"` with a 400 error despite it being valid on the standard `api.openai.com/v1/responses` endpoint. The ChatGPT backend is a private subset of the Responses API that manages context internally and does not accept any token-limit or truncation parameters.

## [2.22.0] - 2026-03-25

### Improved
- **Verb-first tool display** — tool calls now show human-readable verbs (`Read`, `Run`, `Fetch`, `Search`, `List`, `Git commit`, etc.) instead of snake_case technical names, matching the signal-rich style of Claude Code.
- **Clean URL display for web tools** — `web_fetch` and `web_search` now show `hostname › path` instead of the full URL with query parameters, reducing noise in agentic sessions.
- **Shorter bash output preview** — inline stdout preview threshold reduced from 6 to 3 lines, keeping the terminal clean for longer command output.

### Fixed
- **ENOENT absolute path no longer shown in file errors** — when a file is not found, the raw OS error (`ENOENT: no such file or directory, stat '/absolute/path'`) was being concatenated to the already-enriched error message. Now suppressed — the "File not found" + suggestions are sufficient.
- **Redundant `Suggestion:` line removed from file errors** — when `enrichENOENT` already provides "Did you mean?" suggestions and an action hint, the generic fallback suggestion is no longer appended.
- **Codex API request body** — removed `max_tokens` and `temperature` parameters which the `chatgpt.com/backend-api/codex/responses` endpoint rejects (confirmed from OpenAI Codex CLI source and LiteLLM issue #21193). Added `truncation: "auto"` to prevent 400 errors when the context window fills up.
- **Quality evaluator silent catch** — evaluation failures in the COCO Complete phase are now logged when `COCO_DEBUG=1`, preserving the LLM-only fallback behavior but aiding debugging.

## [2.21.1] - 2026-03-25

### Fixed
- **Codex API `max_tokens` parameter** — reverted incorrect `max_output_tokens` back to `max_tokens`. The Codex endpoint (`chatgpt.com/backend-api/codex/responses`) uses `max_tokens`, unlike the standard OpenAI Responses API which uses `max_output_tokens`.
- **Diff renderer raw ANSI codes visible in output** — syntax highlighting (`highlightLine`) was being applied to lines that already contained chalk ANSI escape sequences from word-level diff highlighting. This corrupted the existing sequences, causing them to appear as literal text (e.g. `[48;2;80;20;20m`). Syntax highlighting is now skipped for word-highlighted lines.

## [2.21.0] - 2026-03-24

### Fixed
- **Non-retryable provider errors no longer break the flow** — auth (401/403), bad request (400), and quota errors are now re-thrown from the agent loop so the caller receives the original `ProviderError` object. Previously these were stringified, preventing correct classification and leaving the session in a broken state.
- **Session rollback on non-retryable errors** — when a non-retryable provider error occurs, the session message history is now rolled back to pre-call state and the consecutive-error counter is reset, so the REPL returns cleanly to the prompt instead of accumulating broken state.
- **Codex `max_output_tokens` parameter** — corrected parameter name in `codex.ts` from `max_tokens` to `max_output_tokens` to match the OpenAI Responses API specification.
- **Diff renderer blank lines** — the terminal-width calculation for `edit_file` diff previews was off by one, causing an extra trailing space to wrap with background color active, producing a spurious blank colored line. Fixed by accounting for the 3-character prefix (` - ` / ` + `).
- **Diff line numbers format** — `edit_file` diff previews now show `old | new` aligned line numbers instead of a single column, making it clear which side each line belongs to.

## [2.20.1] - 2026-03-24

### Fixed
- **Error recovery path now fires for streaming errors** — `result.error` returned by the agent loop was previously ignored, causing streaming failures to be silently treated as successful turns. Now correctly triggers LLM recovery (re-queues the task with error context) up to the configured retry budget.
- **`coco setup` and `--setup` now persist configuration** — API key and provider/model preference were never saved when using the setup command or flag directly (`coco setup`, `coco --setup`). `saveConfiguration()` is now called, writing to `~/.coco/.env` and `config.json` as expected.
- **Tool errors can no longer break the agent turn** — `executeSingleTool` previously re-threw unexpected exceptions, which could propagate through the parallel executor and abort the entire turn. Unexpected errors are now converted to `{ success: false }` tool results so the LLM receives the error and can retry.
- **Confirmation dialog failures are handled gracefully** — terminal/readline errors during tool confirmation prompts now decline the tool cleanly instead of crashing the current agent turn.
- **Process safety net skips abort errors silently** — `uncaughtException`/`unhandledRejection` handlers no longer print noise for intentional abort/cancel signals.
- **edit_file diff shown immediately without buffering** — diffs are now printed line-by-line to the terminal as soon as the tool completes, eliminating the previous render delay.

## [2.20.0] - 2026-03-24

### Added
- **Deep file search for suggestions** — `findFileRecursive` uses BFS with configurable depth (default 8), timeout (3s), and exclusion patterns to find files/directories even when the user provides partial or incorrect paths. Handles permission errors gracefully and stops early when max results found.
- **Error resilience system** — new `error-resilience.ts` module provides robust abort detection (`isAbortError`) across Anthropic, OpenAI, and DOM AbortController types; user-friendly error messages for quota/billing/auth issues; and process safety nets for uncaught exceptions.
- **Diff formatter utility** — `diff-formatter.ts` provides clean Codex-style diff formatting with `getModifiedFiles`, `getStagedFiles`, `formatChangeSummary`, and `formatDiff` functions. Filters auto-generated files (lockfiles, minified assets) and respects terminal width.
- **Streaming error handling in agent loop** — individual chunk processing errors are caught and logged without stopping the flow; provider stream errors are captured in `AgentTurnResult.error` for LLM recovery prompts.
- **Provider error classification** — `isNonRetryableProviderError` and `getUserFacingProviderError` distinguish between retryable (network, rate limit) and non-retryable (auth, quota, billing) errors with actionable user messages.

### Improved
- **Diff rendering** — removed box borders for cleaner Codex-style output; syntax highlighting preserved; hunk headers use standard `@@ -L,S +L,S @@` format without decorative borders.
- **Code block rendering** — removed box borders from rendered code blocks for cleaner terminal output.
- **Default models updated** — aligned with current provider offerings:
  - `ollama`: `llama3.1` → `llama3.2`
  - `codex`: `gpt-5.4-codex` → `codex-mini-latest`
  - `copilot`: `claude-sonnet-4.6` → `gpt-4o-copilot`
  - `openrouter`: `anthropic/claude-opus-4-6` → `anthropic/claude-3.5-sonnet`
  - `mistral`: `codestral-latest` → `mistral-large-latest`
  - `deepseek`: `deepseek-coder` → `deepseek-chat`
  - `together`: `Qwen/Qwen2.5-Coder-32B-Instruct` → `meta-llama/Llama-3.3-70B-Instruct-Turbo`
  - `huggingface`: `Qwen/Qwen2.5-Coder-32B-Instruct` → `meta-llama/Llama-3.1-70B-Instruct`
  - `qwen`: `qwen-coder-plus` → `qwen-max`

### Fixed
- **Codex API parameter** — changed `max_output_tokens` to `max_tokens` to match OpenAI Responses API specification.
- **OAuth provider mapping** — `openai` provider now correctly maps to `codex` when `OPENAI_CODEX_TOKEN` is set, enabling ChatGPT subscription authentication.
- **Async provider preference** — `getLastUsedProvider` and `createSession` are now async to support persistent preference storage.
- **Trust store error handling** — trust store load failures are now non-critical warnings instead of fatal errors.

### Changed
- **Provider schema** — added `copilot` and `qwen` to valid provider types.
- **Agent turn result** — added optional `error` field for streaming error capture.
- **Config schema** — added `showDiff` option for controlling diff display behavior.

---

## [2.19.0] - 2026-03-24

### Added
- **Copy-hint footer on code blocks** — every rendered code block now shows `#N · /copy N` in the bottom border, so you can see the block ID and the exact command to copy it without hunting through output.
- **Persistent compaction line** — after context compaction completes, a `⟳ Context compacted · X% → Y%` line is printed to the scroll buffer so the reduction is visible in history (previously only an ephemeral spinner).

### Improved
- **Rich unified diff for `edit_file` previews** — `edit_file` operations now render a real unified diff with `±2` context lines, word-level change highlighting (green words added, red words removed), `⋮` separator between non-contiguous hunks, and a `… +N more lines` guard for large diffs. Replaces the previous simple before/after display.
- **`/memory` command** — shows the winning filename per level (e.g. `📁 Project (AGENTS.md) ✓`), handles the new `directory` level with a 📂 icon, and supports `/memory reload` to hot-reload all instruction files without restarting the session.
- **`AGENTS.md` placeholder in `/memory`** — when no instruction files are loaded, the placeholder now shows `~/.coco/AGENTS.md`, `./AGENTS.md`, and `./AGENTS.local.md` (aligned with the AGENTS.md-first priority order).

### Fixed
- **OpenAI 400 `max_output_tokens` error for `o3-mini`** — `needsResponsesApi()` was routing `o3-mini` to the Responses API (which requires `max_output_tokens`) when it should use Chat Completions (`max_completion_tokens`). The check now matches only the full `o3` model name.
- **Default model updated to `claude-sonnet-4-6`** — config schema was still defaulting to `claude-sonnet-4-20250514`; updated to `claude-sonnet-4-6`.

### Changed
- **`o3` and `o4-mini` added to no-temperature list** — these reasoning models do not accept a `temperature` parameter; adding them prevents `400 Unsupported parameter: temperature` errors.

---

## [2.18.0] - 2026-03-24

### Added
- **Universal `AGENTS.md` instruction file support** — `AGENTS.md` is now the primary instruction file, taking precedence over `COCO.md` and `CLAUDE.md`. This is the emerging standard adopted by OpenAI Codex, GitHub Copilot, and other AI agents. A single `AGENTS.md` file in your repo now works across all AI coding tools without changes.
- **`AGENTS.md` priority hierarchy** — file resolution order at every level is now `AGENTS.md` → `COCO.md` → `CLAUDE.md`, ensuring forward compatibility while maintaining full backward compatibility for existing projects using `COCO.md` or `CLAUDE.md`.
- **Markdown link reference following** — instruction files can reference other docs using standard markdown link syntax on its own line: `[Backend conventions](docs/ai/backend.md)`. Coco automatically inlines the referenced file's content, just like `@path/to/file.md` imports. URL links (`://`) and inline links (with surrounding text) are never followed. Supports `.md`, `.txt`, and `.rst` extensions.
- **`AGENTS.local.md` local override** — alongside the existing `COCO.local.md` and `CLAUDE.local.md`, you can now use `AGENTS.local.md` as a gitignored local override for the universal instruction format.

---

## [2.17.1] - 2026-03-24

### Fixed
- **REPL hangs after "Goodbye!" — requires Ctrl+C to close** — `inputHandler.close()` was not calling `process.stdin.pause()` after the main loop exited. stdin remained an active event-loop handle, preventing Node.js from terminating naturally. Typing `exit`, `quit`, `/exit`, or Ctrl+D now cleanly closes the process.

---

## [2.17.0] - 2026-03-23

### Added
- **Copy code blocks to clipboard** — rendered code blocks are numbered (`#1`, `#2`, …) in the block header. Press **Option+C** (macOS) / **Alt+C** (Linux) to instantly copy the last block without pressing Enter. Use `/copy [N]` or `/cp [N]` to copy a specific block by number; omit N to copy the last one. A brief inline confirmation shows language and block ID (`✓ typescript #3 copied`). Block store maintains up to 100 entries FIFO; IDs never reset within a session to avoid stale references. Invalid arguments (floats, non-numeric strings) produce a clear error instead of silently truncating.
- **Multi-image paste support** — each **Ctrl+V** or `/image` call now *accumulates* images instead of replacing the previous one. The prompt shows individual compact badges (`[📎 #1] [📎 #2]`) for each queued image so you can see exactly how many are pending. All images are sent in one agent turn when you press Enter.

### Fixed
- **Agent refuses to run `kubectl`, `gcloud`, `aws`, and other CLIs** — the model was hallucinating a technical limitation ("I don't have credentials"). `bash_exec` inherits the user's full shell environment: PATH, kubeconfig, gcloud auth, AWS profiles, SSH keys, and every tool installed on the machine. The tool description and system prompt now state this explicitly, and regression tests guard against the behaviour returning.
- **JP2 color space error leaking to terminal on image paste** — when pasting images via Ctrl+V on macOS, the `osascript` subprocess wrote macOS ImageIO's `*** Error creating a JP2 color space: falling back to sRGB` warning directly to the terminal. Fixed by capturing subprocess stderr instead of inheriting it (same fix applied to `xclip` on Linux).

---

## [2.15.0] - 2026-03-20

### Added
- **Maven and Gradle project support across all tools** — Coco now works out of the box on Spring Boot, Quarkus, and any JVM project. All analysis tools auto-detect `pom.xml` / `build.gradle` and switch to the appropriate JVM workflow:
  - `run_tests`: runs `./mvnw test` or `./gradlew test`; parses Maven Surefire output (`Tests run: X, Failures: Y, Errors: Z`); supports `-Dtest=ClassName` / `--tests` filters from pattern param
  - `get_coverage`: reads JaCoCo CSV reports from `target/site/jacoco/jacoco.csv` (Maven) and `build/reports/jacoco/` (Gradle)
  - `run_linter`: tries `checkstyle:check` / `checkstyleMain` for JVM projects; gracefully returns no-linter result when Checkstyle plugin is not configured
  - `analyze_complexity`: detects Java method signatures in addition to JS/TS functions
  - `calculate_quality`: source file discovery returns `src/main/java/**/*.java` for JVM projects
- **`run_maven` tool** — dedicated tool for running Maven goals with `./mvnw` wrapper detection, streaming output, heartbeat, and configurable timeout. Supports extra args for module selection (`-pl stock-core`) and goal flags (`-DskipTests`)
- **`run_gradle` tool** — dedicated tool for running Gradle tasks with `./gradlew` wrapper detection, same streaming/heartbeat pattern
- **JVM support in quality pipeline** — `CoverageAnalyzer`, `CorrectnessAnalyzer`, and `QualityEvaluator` now handle Maven/Gradle projects without crashing; JaCoCo CSV is parsed for real coverage metrics; Surefire output is aggregated across all modules

### Improved
- **`grep_search` default file pattern** — expanded from `{ts,tsx,js,jsx,json,md,txt}` to include `.java`, `.py`, `.go`, `.rs` so searches work across all supported language stacks by default
- **Stack detector Gradle fix** — Gradle projects are no longer misidentified as Maven projects in the system prompt context enrichment; agent receives correct build tool and testing framework information
- **Agent loop stability** — `JSON.stringify` calls in token estimation wrapped in try/catch to prevent crashes on circular reference objects in tool results

---

## [2.14.1] - 2026-03-19

### Fixed
- **Agent loop stops silently on long conversations** — `checkAndCompactContext()` was called without the tool registry, causing the context token counter to underestimate usage by ~2,000 tokens per turn (tool catalog, memory, and skills were not counted). Context would silently balloon past the window limit, causing API errors or the agent to stop mid-task
- **PR review dumps thousands of lines to terminal** — the `review_code` tool included full raw diff hunks in its return value, which got serialized into the LLM's tool result and reproduced verbatim in the response. Now strips diff hunks from the result since findings are already extracted during analysis — the agent receives only summary, findings, and file metadata

---

## [2.14.0] - 2026-03-19

### Added
- **Unified system prompt rewritten to match Cursor/Claude Code quality** — complete rewrite of the agent system prompt based on analysis of leaked prompts from Cursor, Claude Code, Codex CLI, Devin, Windsurf, Augment Code, and Superpowers
  - Verification protocol: 5-step evidence gate with anti-rationalization rules ("Belief is not evidence")
  - Parallel tool execution: "DEFAULT IS PARALLEL" directive with concrete examples for 3-5x speedup
  - Systematic debugging protocol: 3-phase Investigate → Analyze → Fix with escalation after 3 failed attempts
  - Code style rules: naming, typing, nesting, comments (inspired by Cursor CLI's `<code_style>`)
  - Testing discipline: never modify existing tests, mandatory regression tests for bugfixes
  - Task planning: atomic steps, vertical slice implementation, verify after each step
  - Tone and brevity: no sycophancy, lead with answer, disagree when warranted
  - Error recovery classification: invalid input / transient / structural (replaces flat tool-specific list)
- **Prompt enhancers reference module** — modular prompt enhancement system with request classifier, enhancer registry, and token-budget composer. Retained as reference for the content merged into the unified prompt

### Improved
- **System prompt 52% smaller** — reduced from 14,543 to 6,921 chars while adding 6 new behavioral sections. Effective prompt with 88 tools: ~13,500 chars (~3,400 tokens), aligned with Cursor CLI
- **Codebase research directive consolidated** — merged duplicate "Proactive Code Reference Search" section into single "Codebase Research Before Changes" under Tool Strategy

### Fixed
- **Context token counter undercounting** — `updateContextTokens()` was counting only the raw base prompt, ignoring tool catalog, memory, skills, and quality loop injections (~2,000 tokens undercount per turn). Now accepts optional `toolRegistry` to count the actual effective system prompt, improving compaction timing accuracy
- **`checkAndCompactContext()` forwards toolRegistry** — the compaction decision path now uses the accurate token count instead of the underestimated fallback

---

## [2.13.1] - 2026-03-09

### Fixed
- **OpenAI API rejects `max_tokens` for newer models** — GPT-4o, GPT-4.1, o1, o3, o4, and chatgpt-4o model families require `max_completion_tokens` instead of `max_tokens` in the Chat Completions API. Sending the deprecated parameter causes 400 errors on some installations depending on SDK version
  - Add `buildMaxTokensParam()` helper that selects the correct parameter based on model
  - Fix `isAvailable()` health check to use Responses API for Responses-only models (e.g. `gpt-5.4-codex`)

---

## [2.13.0] - 2026-03-06

### Added
- **Codex provider tool calling** — full tool calling support for the ChatGPT OAuth (Codex) provider via the Responses API
  - Message conversion: `tool_use` → `function_call`, `tool_result` → `function_call_output`
  - SSE streaming with function call event parsing and argument accumulation
  - `fnCallBuilders` keyed by `item.id` (Responses API invariant)
  - Safe `AbortController` timeout pattern (no throw-in-setInterval crash)
  - `withRetry` wrapper for transient API errors on both `chat()` and `chatWithTools()`
  - Temperature pass-through to `buildRequestBody`

---

## [2.12.0] - 2026-03-06

### Added
- **GPT-5.4 Codex model support** — add OpenAI's latest agentic coding model across all providers
  - New default model for OpenAI, Codex, and Copilot providers
  - Available in OpenRouter as `openai/gpt-5.4-codex`
  - Pricing: $2/M input, $8/M output (400K context window)
  - Previous models (gpt-5.3-codex and earlier) remain available as non-default options

---

## [2.11.1] - 2026-03-05

### Fixed

- **Stream timeout crashes the process** — `throw` inside `setInterval` was an unhandled exception that killed the Node.js process instead of propagating to the async generator. Affects all providers (OpenAI, Anthropic, Copilot). Now uses `AbortController` to safely abort the stream and propagate the timeout error through the normal error handling path
- **OpenAI provider cannot call tools with GPT-5+/Codex models** — these models require the Responses API (`/responses`) instead of Chat Completions (`/chat/completions`). The provider only had Chat Completions support, so the model would respond with text but never emit tool calls, causing the agent loop to exit silently. Added full Responses API routing and implementation
- **Copilot Responses API streaming drops tool call arguments** — the `fnCallBuilders` map was keyed by `call_id` but the streaming events reference items by `item_id` (the output item's `id`), causing argument accumulation to fail silently. Tool calls were emitted with empty inputs

### Improved

- **Copilot provider simplified** — removed ~200 lines of duplicated Responses API code by delegating to the parent `OpenAIProvider`. Copilot now only adds token refresh on top of the shared implementation

---

## [2.11.0] - 2026-03-05

### Added

- **GitHub Copilot provider** — full provider integration with device flow authentication, isolated credential storage, and automatic Responses API routing for Codex/GPT-5+ models
  - 15 models across 3 families (OpenAI, Anthropic, Google) via Copilot
  - Shared `getCopilotCredentialsPath()` utility for credential isolation
  - Defense-in-depth guard against `GITHUB_TOKEN` env bleeding into stored credentials
- **Auth isolation layer** — dedicated `src/auth/` module separating Copilot auth from OpenAI OAuth flows (credentials, tokens, and device flow fully independent)

### Improved

- **Model selector rendering** — truncate lines to terminal width to prevent stacked duplicate renders from line wrapping
- **Provider model catalog** — update all providers to March 2026 versions: Anthropic (claude-opus-4-6 alias), OpenAI (gpt-5.3-codex), Gemini (3.1-pro-preview)
- **Onboarding flow** — correctly handle Copilot as a cloud provider during configuration

### Fixed

- **Lint warning for Unicode ZWJ** — use alternation instead of character class for zero-width joiner sequences in renderer

## [2.10.0] - 2026-03-04

### Added

- **Specialized subagent system** — five role-based agents (explore, plan, worker, reviewer, general) with per-role tool whitelists and model selection for targeted task execution
- **Mid-task steering** — LLM classifier distinguishes STEER/MODIFY/QUEUE/ABORT intents, enabling real-time context injection between agent iterations without restarting
- **Best-of-N parallel solutions** — run N independent solution attempts in isolated worktrees, score each with quality evaluation, and pick the best result
- **Headless/CI mode** — new `-P` flag for non-interactive pipeline execution, enabling use in CI/CD workflows and scripts
- **Unix composability** — stdin piping support (`git diff | coco -P "review"`) for integrating with shell pipelines
- **Layered COCO.md configuration** — 4-level hierarchy (user/project/directory/local) for fine-grained agent behavior customization
- **Enhanced plan mode** — read-only exploration phase with approve-then-execute flow for safer architectural changes
- **Context compaction with focus preservation** — `/compact focus on X` retains relevant context while compressing the rest
- **Worktree manager** — built-in git worktree lifecycle management (create/merge/cleanup) for parallel feature development

### Fixed

- **Path traversal containment** — prevent file operations from escaping the project directory
- **setTimeout leak** — clean up dangling timers that could keep the process alive after exit
- **Worktree path collision** — detect and handle name conflicts when creating worktrees
- **Stdin timeout** — proper timeout handling for piped input in headless mode

---

## [2.9.0] - 2026-03-04

### Added

- **Codex-style colored diff rendering** — `diff` code blocks now render with full-width red/green background colors for removed/added lines, matching the style used by OpenAI Codex
  - Word-level highlighting on paired delete→add lines shows exactly which words changed using brighter backgrounds
  - Line numbers extracted from `@@ hunk` headers display alongside each diff line
  - Auto-detection of unified diff content in code blocks without an explicit `diff` language tag
  - Applies to both top-level and nested code blocks in markdown output

---

## [2.8.2] - 2026-03-03

### Fixed

- **Agent loop stops silently without explaining why** — when the LLM hit the output token limit (`max_tokens`), the stream ended with no tool calls and the agent broke out of the loop without any user-visible message. Now auto-continues by saving partial text and injecting a continuation prompt so the response completes naturally
- **No notification when iteration limit is reached** — when the agent exhausted its tool iteration limit (default 25), the loop exited silently. Now displays a visible notice: _"Reached the iteration limit. You can say 'continue' to resume."_

### Improved

- **All providers now emit `stopReason` in stream done chunks** — Anthropic, OpenAI, Gemini, and Codex providers track the LLM's stop/finish reason during streaming and surface it to the agent loop, enabling informed decisions about why a response ended

---

## [2.8.1] - 2026-03-03

### Fixed

- **REPL freeze during Anthropic/Kimi streaming** — the Anthropic provider (used by kimi-code) had no stream-level timeout; if the LLM stalled mid-stream the REPL would hang indefinitely and Ctrl+C would kill the process. Added activity-based timeout (120s, matching the OpenAI provider) to both `stream()` and `streamWithTools()` methods
- **Ctrl+C does not cancel Anthropic streams** — the AbortSignal from the agent loop is now passed through to the Anthropic SDK's `messages.stream()` call, so pressing Ctrl+C aborts the HTTP connection directly instead of waiting for the stuck generator to yield
- **REPL freeze during context compaction** — the compaction LLM call had no timeout, no abort support, and no visual feedback. Added a 30-second timeout, SIGINT handler, and spinner; on abort or timeout the REPL continues silently
- **History trimming corrupts tool_call/tool_result pairs** — `addMessage()` could slice the message history at a `tool_result` boundary, orphaning it from its preceding `tool_use` message and causing persistent API Error 400 loops. The trimming now walks back to the nearest non-tool_result boundary (same proven pattern used in the context compactor)

---

## [2.8.0] - 2026-03-02

### Added

- **Comprehensive error recovery across all tools** — every tool now returns actionable recovery hints when errors occur, guiding the agent to the correct next step instead of showing raw error messages
  - 28 tools enriched with pattern-specific error detection and human-readable suggestions
  - Git tools detect 9 common failure patterns (merge conflicts, push rejections, missing refs, etc.)
  - Build tools include a `hint` field when builds fail, suggesting missing dependencies, syntax fixes, or permission issues
  - Bash safety blocks now name the specific rule violated and how to rewrite the command
  - File-not-found errors suggest similar files via fuzzy matching (Did you mean?)
- **AGENTS.md as universal fallback for agentic documentation** — subagents now discover and use AGENTS.md files as a documentation source

### Improved

- **Error humanizer expanded** — new pass-through rules prevent double-humanization of already-enriched messages; TypeScript error codes and SQLite errors now get contextual hints
- **System prompt error recovery strategies** — per-category guidance (git, build/test, permissions, command not found, database) helps the agent self-correct without user intervention
- **Quality tool honesty** — `run_linter` returns `score: null` with an explanatory message when no linter is detected, instead of a misleading perfect score of 100
- **Semantic search transparency** — warns when using fallback text matching instead of transformer embeddings, and reports skipped files
- **Code review warnings** — `review_code` now surfaces diff read failures and linter unavailability instead of silently skipping them

### Fixed

- **Status bar first-letter clipping** — add space after folder emoji to prevent the first character from being cut off in the terminal status line

---

## [2.7.0] - 2026-02-28

### Added

- **Multi-level subcommand support for bash permission patterns** — bash safety patterns now support matching multi-level subcommands for more granular permission control

---

## [2.6.0] - 2026-02-27

### Added

- **Context usage indicator** — a live token-usage bar is now shown in the REPL status line; a warning fires at 90 % and 95 % context capacity so you can compact or start a new session before the window overflows
- **Tool output visibility and intent narration** — tool calls now display their category and a short plain-English description of what the agent is about to do; tool results show a compact, readable summary instead of raw JSON; long outputs are truncated with a "show more" hint
- **Word-wrap in input** — long input lines now wrap at word boundaries within the terminal width, so multi-line prompts stay readable and the cursor stays in sync with what the terminal renders
- **Up/down arrows jump to line boundary before navigating history** — pressing ↑ while the cursor is in the middle of a multi-line input first moves to the start of the first line; pressing ↓ first moves to the end of the last line; only a second press navigates history, matching standard shell behaviour

### Fixed

- **Wrapped input eating terminal log lines** — when a long input wrapped across terminal columns and the cursor was moved, `countVisualRows` double-counted rows where a space landed at exactly column N (terminal auto-wrap + explicit `\n`), causing `cursorUp` to overshoot the separator and erase log lines on every keypress
- **ASCII art rendering outside markdown box** — ASCII diagrams generated inside a `~~~markdown` outer block used bare `~~~` as inner fence openers; since bare `~~~` closes the outer block, the diagram content leaked as plain text; inner blocks now use backtick fences (`` ```ascii ``, `` ```bash ``) which are structurally incapable of closing a tilde outer fence
- **Nested code block collision and table truncation** — a renderer state-machine bug caused `inNestedCodeBlock` to not reset correctly after a nested code block inside a markdown wrapper, which prevented the outer block from closing and corrupted table rendering; the state is now restored on both the open and close paths
- **Double Ctrl+C required to exit** — pressing Ctrl+C once now clears the current input line; a second press exits the REPL, matching the behaviour users expect from interactive shells
- **Spinner echo and permanent log cleanup** — the input echo was printed after the spinner started on the same line, causing leftover text in the log; the echo is now cleared before `spinner.stop()`, and trailing ellipsis characters are stripped from permanent log entries
- **ANSI wrap bleed across renderer segments** — bold/colour escape sequences started in one renderer segment could leak into the next line if the terminal wrapped mid-sequence; reset codes are now emitted at every line boundary

---

## [2.5.3] - 2026-02-24

### Added

- **Lifecycle hooks** — coco now loads `.coco/hooks.json` at startup and fires `PreToolUse` / `PostToolUse` hooks around every tool execution; hooks can inspect, modify, or block tool calls; startup is non-fatal if the file is absent

### Improved

- **Contextual spinner during agent turns** — the spinner now shows which quality-loop iteration is running and what tool category was just used (e.g. "Iter. 3 · after running tests · Analyzing results…"); previously it showed a generic time-based message with no context
- **`exit` / `quit` / `q` as bare keywords** — typing these without a leading `/` now exits the REPL immediately, matching user intuition

### Fixed

- **API Error 400 on context compaction** — the compactor could split a `tool_use` / `tool_result` pair across the summarise/preserve boundary, causing the next request to be rejected by the API; the boundary now always starts at or before the matching `tool_use` message
- **API Error 400 on missing tool results** — if a tool call was streamed but its execution result was dropped (e.g. internal ID mismatch), the next LLM request would be rejected; a placeholder `tool_result` with `is_error: true` is now injected automatically and a warning is logged
- **Tool argument data-bleed in Anthropic streams** — when a `content_block_stop` event was missing between two consecutive tool calls in the stream, the second tool's argument JSON would be appended to the first tool's input; the provider now detects the unclosed block and finalises it before starting the next tool
- **OpenAI-compatible providers losing tool calls on early stream exit** — tool calls were only finalised after the full stream loop, so any provider that closes the connection before sending all events (or omits `finish_reason`) would silently drop them; tool calls are now also finalised inline when `finish_reason` is received, with a fallback pass after the loop
- **OpenAI provider rejecting providers that omit the tool-call `index`** — some OpenAI-compatible endpoints (e.g. custom local inference servers) do not include the `index` field in streaming tool-call deltas; the provider now falls back to the current map size so each new tool call gets a unique slot
- **npm update check silently failing on slow connections** — the update check was fetching the full package manifest (~100 KB) with a 2 s timeout; slow connections would silently time out and no update notification would appear; the check now fetches only the `/latest` endpoint (~10 KB) and uses a 5 s timeout
- **Timer leak in update check** — the startup-timeout promise in `checkForUpdatesInteractive` was leaving a dangling `setTimeout` when the network call resolved first; it is now cancelled with `clearTimeout`
- **Bash heredoc false positives** — commands that write files via heredoc (`cat > /tmp/test.js << 'EOF' … EOF`) were incorrectly blocked as dangerous because JavaScript code inside the heredoc body (jQuery `$()`, backticks, `eval()`, "source of truth" comments) matched shell injection patterns; safety patterns that are sensitive to code content are now checked only against the shell command header, not the heredoc body

---

## [2.5.1] - 2026-02-24

### Fixed

- **Intent recognizer false positives** — natural language messages like "implementa la tarea de instructions.md" or "construye el proyecto según el plan" were incorrectly intercepted as COCO phase commands (`/task`, `/build`) with high confidence. Phase commands (`plan`, `build`, `task`, `init`, `output`, `ship`) are now excluded from the regex recognizer entirely; the LLM handles them naturally through its registered tools and slash-command routing. Only unambiguous control-flow keywords (`status`, `trust`, `help`, `exit`) remain in the pattern recognizer.
- **Exit prompt removed** — typing `exit` or `quit` now terminates the REPL immediately without asking for confirmation; previously it would show an interactive prompt before acting.

---

## [2.5.0] - 2026-02-24

### Added

- **Error humanizer** — technical error messages are now translated into plain English before being shown to the user; covers 20+ patterns across network errors (`ECONNREFUSED`, `ENOTFOUND`, SSL), filesystem (`ENOENT` with path extraction, `EACCES`, `EISDIR`), git (`not a git repository`, merge conflicts, push rejected), JSON parse failures, missing modules, command not found, and API auth errors (401/403/429/503)
- **LLM-powered error hints** — when an error doesn't match a known rule and still looks technically opaque (stack traces, Node.js `ERR_` codes, `TypeError`, etc.), an async LLM call fires non-blocking after the tool run; the plain-language explanation is printed as a dim `💡` hint once the agent turn completes, without blocking any output

### Fixed

- **Infinite loop on repeated tool errors** — when the same tool fails with the same error 3 or more consecutive times (e.g. `write_file` called with missing `path`/`content`), the agent now injects a directive telling the LLM to stop retrying and explain the issue to the user instead; previously the agent would loop up to 25 times silently
- **Zod validation errors shown as raw JSON** — tool parameter validation failures were displayed as unreadable JSON arrays; they now produce a readable message: `Invalid tool input — path (expected string), content (expected string)`
- **Input echo and action menu in Spanish** — the secondary input placeholder ("Escribe para modificar o añadir tareas…") and interruption menu labels ("Modificar", "Encolar", "Abortar") were in Spanish; all UI text is now English
- **`[Anthropic]` hardcoded in error messages** — a `console.warn` in the Anthropic provider included a `[Anthropic]` prefix that appeared even when using other providers (e.g. `kimi-code`); removed and replaced with the structured logger
- **Slow startup without internet** — the npm version check at startup could block for several seconds when offline or using a local LLM; a 2.5 s hard timeout now ensures coco always starts quickly regardless of network availability
- **Update prompt default was "No"** — pressing Enter at the "Exit now to update?" prompt now confirms the update (default changed to Yes)

### Improved

- **Spinner feedback during tool execution** — spinner messages are now descriptive per tool: "Generating file content…" (write_file), "Planning edits…" (edit_file), `Running: npm test…` (bash_exec with actual command), "Composing commit…" (git_commit), etc.; previously all tools showed a generic "Preparing: tool_name…" message
- **Dead code annotated** — the unreachable `case "open"` branch in `intentToCommand` is now clearly documented so future maintainers know it is kept intentionally for forward-compatibility

---

## [2.4.2] - 2026-02-23

### Fixed

- **Kimi For Coding 403 error (properly fixed)** — migrated `kimi-code` from the OpenAI-compatible endpoint to Kimi's official Anthropic-compatible endpoint (`https://api.kimi.com/coding`); the previous workaround (`User-Agent: claude-code` on the OpenAI endpoint) did not resolve the 403; the Anthropic SDK now talks directly to the Anthropic-protocol endpoint that Kimi officially supports for Claude Code and other Anthropic-SDK-based agents

---

## [2.4.1] - 2026-02-23

### Fixed

- **Qwen provider connection failure for international users** — the default API endpoint now points to `dashscope-intl.aliyuncs.com` (the international DashScope endpoint used by `modelstudio.console.alibabacloud.com`); China domestic users can override with `DASHSCOPE_BASE_URL`
  - Updated across `env.ts`, `providers/index.ts`, and `providers-config.ts` for full consistency
  - Connection error hint now explains the two endpoints and the override path
- **Kimi For Coding 403 error** — requests to the `kimi-for-coding` model now include `User-Agent: claude-code`; the Kimi API requires this header to accept connections from coding agents
- **Provider switch not taking effect mid-session** — using `/provider` or `/model` to switch while the REPL is running now re-initialises the active provider object immediately; previously the old provider (e.g. `kimi-code`) remained active for the rest of the session even after switching, causing API errors on every subsequent turn
  - If re-initialisation fails, `session.config` is reverted to the previous provider so the session state stays consistent
- **Provider selector rendering corruption** — scrolling through the provider list when `kimi-code` was highlighted caused the `anthropic` row to appear duplicated multiple times; the selected-item second-line expansion was not accounted for in the line-counter used by `clearPrevious()`, leaving ghost lines that accumulated on each keystroke

---

## [2.4.0] - 2026-02-23

### Added

- **Alibaba Qwen provider** (`/provider` → Qwen) — DashScope OpenAI-compatible API; supports `qwen-coder-plus` (recommended), `qwen-max`, `qwen-plus`, `qwen-turbo`, `qwen2.5-coder-32b-instruct`, and `qwq-plus`; configure via `DASHSCOPE_API_KEY` (or `QWEN_API_KEY` as fallback)

### Fixed

- **Provider selector duplication** — moving the cursor or pressing Esc/Cancel left the first provider line (`anthropic`) duplicated on screen; fixed an off-by-one in `clearPrevious()` that skipped clearing the top line of the menu

---

## [2.3.0] - 2026-02-23

### Added

- **Auto-swarm complexity classification** — the swarm pipeline now classifies each feature's complexity before running reviews and selects the minimal necessary agent roster, instead of always running all 8 agents
  - Trivial (score 1–3): `tdd-developer` only
  - Simple (4–5): adds `qa`
  - Moderate (6–7): adds `architect`
  - Complex (8–10): adds `security-auditor` + `external-reviewer`
  - LLM-based classification with automatic heuristic fallback (word count, criteria count, dependency count, keyword signals)
  - `skipComplexityCheck` escape hatch forces the full roster; `complexityThreshold` sets a minimum level that always triggers the full roster
- **Per-project commit auto-approval** (`/permissions allow-commits`) — opt a specific project into auto-approving `git commit` without enabling it globally; revert with `/permissions revoke-commits`
- **`/permissions` command** — dedicated command for managing tool trust, applying the recommended template, and controlling per-project commit behaviour
  - `/permissions` — show current trust status (global + project tools, deny list)
  - `/permissions apply` — apply the recommended allow/deny template
  - `/permissions view` — view the full recommended template before applying
  - `/permissions reset` — clear all trusted tools (with confirmation)
  - `/permissions allow-commits` / `/permissions revoke-commits` — project-scoped commit auto-approval
- **Expanded recommended permissions template** — pnpm direct commands (`pnpm:install`, `pnpm:run`, `pnpm:test`, `pnpm:build`, …), JS/TS runners (`vitest`, `tsc`, `tsx`, `oxlint`), and additional build toolchain entries now included in the default allow-list

### Changed

- **`/coco` renamed to `/quality`** — the quality convergence mode command is now `/quality [on|off]`; `/coco` remains as a backward-compatible alias so existing workflows continue to work without changes
  - Config key migrated from `cocoMode` → `qualityLoop` with transparent fallback for existing configs

### Fixed

- **Worktree detection in `worktree-list`** — the script used `-d` to test for the `.git` entry, which failed for file-based `.git` refs used by worktrees; switched to `-e` so both regular checkouts and linked worktrees are detected correctly
- **API key not persisted after `/provider` switch** — switching provider via the interactive menu now writes the new API key to `~/.coco/.env`, matching the behaviour of the initial onboarding setup
- **Release workflow using non-existent GitHub Actions versions** — `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, and `actions/download-artifact` were pinned to `@v6` (which does not exist); corrected to `@v4`
- **OAuth success message showed "ChatGPT subscription" for all providers** — when switching to Gemini via OAuth the confirmation now correctly displays "Google account (OAuth)"
- **Circular dependency crash in swarm feature ordering** — `topologicalSort` had no cycle guard; a circular dependency between features would cause infinite recursion; now detects cycles early and throws a descriptive error

---

## [2.1.0] - 2026-02-20

### Added

- **`/mcp` command** — interactive MCP server management directly from the REPL: list connected servers, add/remove servers, and toggle them on or off without restarting
- **`/intent` command** — display or reset the agent's current task intent; useful for confirming what the agent understood before it starts executing
- **`kimi-code` provider** (`KIMI_CODE_API_KEY`) — Kimi Code subscription endpoint (`api.kimi.com/coding/v1`), separate from the pay-per-token Moonshot Kimi provider; `paymentType: "sub"` for users on a monthly plan
- **MCP manager + skill discovery wired to REPL** — both the MCP server manager and the unified skill registry are now initialised at startup and available to all REPL commands
- **VS Code extension scaffolding** — initial extension structure (`feat(repl,vscode)`) enabling IDE integration
- **`checkForUpdatesInteractive()`** — displays the available update notice **before** opening the REPL (once per session). Replaces the inline check in `printWelcome()`
- **Persistent version cache** — version-check result written to `~/.coco/version-check-cache.json` (valid 24 h) instead of an env variable that reset each session
- **`parseCocoQualityReport(content)`** — extracted from `index.ts` to `coco-mode.ts` as a public tested function; parses the `COCO_QUALITY_REPORT` marker block into a typed `CocoQualityResult`; covered by 7 unit tests

### Changed

- **Welcome screen** now shows MCP server count, loaded skill count (builtin vs project), and trust level at startup — single compact block, no restarting required
- **MCP manager switched to singleton pattern** (`getMCPServerManager`) — prevents duplicate instantiation across REPL lifecycle
- **COCO mode routes through `coco-fix-iterate` skill when available** — checks skill registry first; falls back to text-protocol injection when skill is not found
- **`/coco status` shows active mode type** — displays `(skill-based)` or `(prompt-based)` depending on whether `coco-fix-iterate` was discovered
- **`looksLikeFeatureRequest()` threshold lowered** (40 → 20 chars) and four new keywords added (`fix … bug/issue/error/problem`, `update … function/component/service/module`, `generate`, `convert`) so more natural language requests are correctly classified as feature work
- **Git status shown in REPL welcome** — current branch and dirty-state indicator displayed at startup using project git context
- **`merge-back` skill runs `format:fix` both before and after merge** — eliminates CI Lint & Format failures caused by cross-branch formatting drift

### Fixed

- **System prompt silently dropped in Anthropic and Gemini providers** — added `extractSystem()` helper that falls back to scanning the messages array, so the agent-loop system prompt is now reliably forwarded on every call
- **Tool-trust `ask` action wrote to deny list** — the `ask` branch no longer persists the decision to disk; it only removes the tool from the session's trusted set

### Documentation

- **README** — added `## Privacy` section and provider comparison table (Coco vs Aider vs Claude Code vs Cursor)
- **`docs/guides/QUICK_START.md`** — fully rewritten for v2 REPL-first flow; removed stale `coco init/plan/build` references
- **`docs/guides/ECOSYSTEM.md`** — added skill discovery priority order section
- **`SECURITY.md`** — supported versions updated to `2.0.x` / `2.1.x`
- **`CONTRIBUTING.md`** — repository URL corrected to `github.com/corbat-tech/coco`
- **`CHANGELOG.md`** — `[Unreleased]` comparison link fixed, Spanish bullet points translated

---

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
| 2.12.0 | 2026-03-06 | GPT-5.4 Codex model support across all OpenAI-compatible providers |
| 2.8.1 | 2026-03-03 | Fix REPL freeze on Anthropic/Kimi streaming, compaction timeout+spinner, addMessage pair-safe trimming |
| 2.1.0 | 2026-02-20 | /mcp, /intent commands, kimi-code provider, MCP+skills wired to REPL, VS Code extension, improved welcome screen |
| 2.0.0 | 2026-02-20 | React/Java analyzers, ProjectConfig, quality bridge, report exporter, GitHub Actions generator, 6 new providers |
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

[Unreleased]: https://github.com/corbat/corbat-coco/compare/v2.25.0...HEAD
[2.25.0]: https://github.com/corbat/corbat-coco/compare/v2.24.2...v2.25.0
[2.22.2]: https://github.com/corbat/corbat-coco/compare/v2.22.1...v2.22.2
[2.22.1]: https://github.com/corbat/corbat-coco/compare/v2.22.0...v2.22.1
[2.22.0]: https://github.com/corbat/corbat-coco/compare/v2.21.1...v2.22.0
[2.21.1]: https://github.com/corbat/corbat-coco/compare/v2.21.0...v2.21.1
[2.21.0]: https://github.com/corbat/corbat-coco/compare/v2.20.1...v2.21.0
[2.20.1]: https://github.com/corbat/corbat-coco/compare/v2.20.0...v2.20.1
[2.20.0]: https://github.com/corbat/corbat-coco/compare/v2.19.0...v2.20.0
[2.19.0]: https://github.com/corbat/corbat-coco/compare/v2.18.0...v2.19.0
[2.18.0]: https://github.com/corbat/corbat-coco/compare/v2.17.1...v2.18.0
[2.17.1]: https://github.com/corbat/corbat-coco/compare/v2.17.0...v2.17.1
[2.17.0]: https://github.com/corbat/corbat-coco/compare/v2.15.0...v2.17.0
[2.15.0]: https://github.com/corbat/corbat-coco/compare/v2.14.1...v2.15.0
[2.14.1]: https://github.com/corbat/corbat-coco/compare/v2.14.0...v2.14.1
[2.14.0]: https://github.com/corbat-tech/coco/compare/v2.13.1...v2.14.0
[2.13.1]: https://github.com/corbat-tech/coco/compare/v2.13.0...v2.13.1
[2.13.1]: https://github.com/corbat-tech/coco/compare/v2.13.0...v2.13.1
[2.12.0]: https://github.com/corbat-tech/coco/compare/v2.11.1...v2.12.0
[2.11.0]: https://github.com/corbat-tech/coco/compare/v2.10.0...v2.11.0
[2.8.2]: https://github.com/corbat-tech/coco/compare/v2.8.1...v2.8.2
[2.8.1]: https://github.com/corbat-tech/coco/compare/v2.8.0...v2.8.1
[2.8.0]: https://github.com/corbat-tech/coco/compare/v2.7.0...v2.8.0
[2.7.0]: https://github.com/corbat-tech/coco/compare/v2.6.0...v2.7.0
[2.6.0]: https://github.com/corbat-tech/coco/compare/v2.5.3...v2.6.0
[2.4.0]: https://github.com/corbat-tech/coco/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/corbat-tech/coco/compare/v2.2.5...v2.3.0
[2.2.5]: https://github.com/corbat-tech/coco/compare/v2.1.0...v2.2.5
[2.1.0]: https://github.com/corbat-tech/coco/compare/v2.0.0...v2.1.0
[2.4.2]: https://github.com/corbat-tech/coco/compare/v2.4.1...v2.4.2
[2.10.0]: https://github.com/corbat-tech/coco/compare/v2.9.0...v2.10.0
[2.9.0]: https://github.com/corbat-tech/coco/compare/v2.8.2...v2.9.0
[2.11.1]: https://github.com/corbat-tech/coco/compare/v2.11.0...v2.11.1
[2.13.0]: https://github.com/corbat-tech/coco/compare/v2.12.0...v2.13.0
[2.14.1]: https://github.com/corbat-tech/coco/compare/v2.14.0...v2.14.1
[2.14.0]: https://github.com/corbat-tech/coco/compare/v2.13.1...v2.14.0
[2.15.0]: https://github.com/corbat-tech/coco/compare/v2.14.1...v2.15.0
[2.4.1]: https://github.com/corbat-tech/coco/compare/v2.4.0...v2.4.1
[2.0.0]: https://github.com/corbat-tech/coco/compare/v1.8.0...v2.0.0
[1.8.0]: https://github.com/corbat-tech/corbat-coco/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/corbat-tech/corbat-coco/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/corbat-tech/corbat-coco/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/corbat-tech/corbat-coco/compare/v1.4.0...v1.5.0
[2.5.3]: https://github.com/corbat-tech/corbat-coco/compare/v2.5.2...v2.5.3
[2.5.2]: https://github.com/corbat-tech/corbat-coco/compare/v2.5.1...v2.5.2
[2.5.1]: https://github.com/corbat-tech/corbat-coco/compare/v2.5.0...v2.5.1
[2.5.0]: https://github.com/corbat-tech/corbat-coco/compare/v2.4.2...v2.5.0
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

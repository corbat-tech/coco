# Dependency maintenance — 2026-10-28

Coco 2.43.0 → 3.0.1; extension 2.42.0 → 2.42.1. Baseline: `5d1dffc`.
Major release for the published Node minimum: >=22.13.0. Public application APIs remain unchanged. Baseline dependencies already required 22.13 despite root metadata advertising 22.0; a basic smoke on 22.0 did not prove engine compatibility.
Development/release: Node 24.22.1 LTS, pnpm 12.15.0, release npm 12.2.1.
Compatibility targets: Node 22.23.4 LTS and 26.12.1 Current.

## Scope and reproducibility

- Root npm package, five consuming apps and three private source wrappers (no external dependencies).
- Independent extension: its own pnpm workspace, manager pin and lockfile. Its ignored, untracked npm lock from 2.40.0 is not a release input and was preserved.
- Baseline environment: macOS arm64, Node 26.4.0, npm 11.17.0, pnpm 10.0.0; no Corepack/runtime manager. Homebrew node@24/25/26 aliases all pointed to 26.4.0. Installed fnm 1.39.0 and parallel runtimes without editing shell startup, replacing Homebrew Node or removing installations. Isolated pnpm/npm: `~/.local/share/coco-toolchains/manager`.
- pnpm 12: move configuration from package.json to workspace YAML, review lifecycle scripts explicitly, preserve frozen installs. Version-specific release-age exceptions record reviewed new AWS/OpenAI/glob releases; other resolutions retain the default age policy. pnpm 12 records manager dependencies in a separate YAML document in the lockfile.
- Remove all 12 old overrides: brace-expansion, esbuild, markdown-it, picomatch, protobufjs, vite, ws, linkify-it, postcss, nanoid, source-map-js, tinypool. Natural compatible resolutions now supply corrections; no cross-major transitive overrides.

## Migrations and deferrals

- Execa 10: exit listeners move to `nodeChildProcess`; retain owned process groups, cancellation/escalation, stream draining and failures. Fixtures model the new emitter; real process tests cover cancellation and TERM-resistant descendants.
- Chalk 6, Glob 14 and Minimatch 11 retain the used APIs and Node 22 support. Platform/CLI tests exercise consumers.
- Vitest and coverage 5.0.5 stay paired, Vite is explicit. Existing assertions, coverage scope and thresholds are preserved. New mock clearing and async assertion checks remain enabled. tsup 9 supports the selected LTS build runtime.
- Root/workspace TypeScript 7.0.2 deferred: TypeDoc 0.28.20 supports through 6.0.x; typescript-eslint 8.72.1 requires <6.1.0. Keep 6.0.3 until compiler consumers support 7.
- Marked 18.1.2 deferred: marked-terminal 7.3.0 requires Marked >=1 <16. Keep 15.0.12, respecting the peer contract.
- Commander 15 now fits the corrected >=22.13 minimum and its CLI contracts pass. Undici 8 stays deferred because it requires >=22.19; patched 7.30.1 preserves support for 22.13–22.18 without forcing an additional floor increase.
- Anthropic SDK 1.3.0 deferred: changes default API version to 2026-10-21 and removes temperature/top_p/top_k. Coco exposes sampling and supports Anthropic-compatible endpoints. Keep 0.135.0 rather than silently removing these contracts; migration needs explicit API/capability routing and acceptance checks.
- tslog 5.4.0 deferred: rewrite changes JSON layout/settings, while public Coco logger helpers return tslog Logger instances. Latest 4.x (4.11.0) preserves logging contracts; migrate schema/types in a breaking release.
- @types/node follows the minimum supported Node major (22), not Current 26. Corepack 0.36.0 was evaluated but is not required or globally activated. npm 12's runtime requirement is satisfied by selected LTS.

## Versions

Resolved baseline/final versions; target metadata comes from the official npm registry's latest tag. Target engines and peer constraints were reviewed before installation. The table includes unchanged direct dependencies to make its scope explicit.

| Dependency | Baseline | Final | Latest stable target | Target Node requirement |
|---|---|---|---|---|
| @anthropic-ai/sdk | 0.135.0 | 0.135.0 | 1.3.0 | not declared |
| @aws-sdk/client-bedrock-runtime | 3.1156.0 | 3.1158.0 | 3.1158.0 | >=20.0.0 |
| @aws-sdk/credential-providers | 3.1156.0 | 3.1158.0 | 3.1158.0 | >=20.0.0 |
| @azure/identity | 4.14.0 | 4.14.0 | 4.14.0 | >=22.0.0 |
| @clack/prompts | 1.8.1 | 1.8.1 | 1.8.1 | >= 20.12.0 |
| @google/genai | 2.31.0 | 2.31.0 | 2.31.0 | >=20.0.0 |
| @typescript-eslint/parser | 8.72.0 | removed (unused) | 8.72.1 | ^18.18.0 \|\| ^20.9.0 \|\| >=21.1.0 |
| @typescript-eslint/typescript-estree | 8.72.0 | 8.72.1 | 8.72.1 | ^18.18.0 \|\| ^20.9.0 \|\| >=21.1.0 |
| ajv | 8.20.0 | 8.20.0 | 8.20.0 | not declared |
| ajv-formats | 3.0.1 | 3.0.1 | 3.0.1 | not declared |
| ansi-escapes | 7.3.0 | 7.3.0 | 7.3.0 | >=18 |
| chalk | 5.6.2 | 6.0.1 | 6.0.1 | >=22 |
| commander | 14.0.3 | 15.0.0 | 15.0.0 | >=22.12.0 |
| diff | 9.0.0 | 9.0.0 | 9.0.0 | >=0.3.1 |
| execa | 9.6.1 | 10.2.1 | 10.2.1 | >=22 |
| glob | 13.0.6 | 14.0.3 | 14.0.3 | 18 \|\| 20 \|\| >=22 |
| highlight.js | 11.12.0 | 11.12.0 | 11.12.0 | >=12.0.0 |
| json5 | 2.2.3 | 2.2.3 | 2.2.3 | >=6 |
| jsonrepair | 3.15.0 | 3.15.0 | 3.15.0 | not declared |
| marked | 15.0.12 | 15.0.12 | 18.1.2 | >= 20 |
| marked-terminal | 7.3.0 | 7.3.0 | 7.3.0 | >=16.0.0 |
| minimatch | 10.2.6 | 11.0.2 | 11.0.2 | 18 \|\| 20 \|\| >=22 |
| openai | 7.43.0 | 7.45.1 | 7.45.1 | >=22.0.0 |
| ora | 9.4.1 | 9.4.1 | 9.4.1 | >=20 |
| simple-git | 4.0.2 | 4.0.2 | 4.0.2 | not declared |
| string-width | 8.3.0 | 8.3.0 | 8.3.0 | >=20 |
| tslog | 4.10.2 | 4.11.0 | 5.4.0 | >=22 |
| undici | 7.30.0 | 7.30.1 | 8.12.3 | >=22.19.0 |
| wrap-ansi | 10.0.2 | 10.0.2 | 10.0.2 | >=20 |
| yaml | 2.9.1 | 2.9.1 | 2.9.1 | >= 14.6 |
| zod | 4.6.7 | 4.6.7 | 4.6.7 | not declared |
| @types/marked-terminal | 6.1.1 | 6.1.1 | 6.1.1 | not declared |
| @types/node | 25.6.0 | 22.20.5 | 26.6.5 | not declared |
| @vitest/coverage-v8 | 4.1.11 | 5.0.5 | 5.0.5 | not declared |
| oxfmt | 0.74.0 | 0.75.0 | 0.75.0 | ^20.19.0 \|\| >=22.12.0 |
| oxlint | 1.89.0 | 1.90.0 | 1.90.0 | ^20.19.0 \|\| >=22.12.0 |
| tsup | 8.5.1 | 9.0.0 | 9.0.0 | ^22.18.0 \|\| ^24.11.0 \|\| >=26.0.0 |
| tsx | 4.23.15 | 4.23.15 | 4.23.15 | >=18.0.0 |
| typedoc | 0.28.20 | 0.28.20 | 0.28.20 | >= 18 |
| typescript | 6.0.3 | 6.0.3 | 7.0.2 | >=16.20.0 |
| vite | 8.3.4 | 8.3.5 | 8.3.5 | ^20.19.0 \|\| >=22.12.0 |
| vitest | 4.1.11 | 5.0.5 | 5.0.5 | ^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0 |

Apps: tsx 4.23.15, TypeScript 6.0.3, @types/node 22.20.5. Extension: VSCE 3.7.1 → 4.0.0, esbuild 0.24.2 → 0.28.2, TypeScript 5.9.3 → 7.0.2, Node declarations 22.19.11 → 22.20.5; test-electron stays 3.1.0. VS Code declarations deliberately pin 1.85.0 (baseline lock 1.109.0; latest 1.140.0) to enforce the advertised editor minimum. Node type inclusion is explicit in the extension compiler configuration. Standalone TypeScript 7.0.2 passes typecheck and real Extension Host on macOS, and has no compiler-API consumers; reuse Dependabot PR #246 for this migration. While checks ran, the existing auto-merge workflow merged declaration-only PR #247; restore 1.85.0 and prevent isolated minor/major declaration upgrades until engines.vscode is reviewed alongside them. This does not suppress vulnerability advisories.

Actions: checkout 6 → 7.0.1; setup-node 6 → 7.1.0; upload-artifact 4/6 → 7.0.2; download-artifact 4 → 8.0.2; Codecov 6 → 7.1.1; pnpm/action-setup 6.0.10 → 6.1.0; CodeQL 4.39.0 → 4.39.1; fetch-metadata 3 → 3.1.0; gh-release 3 → 3.0.3. Reviewed ESM transitions, setup-node's removal of dummy NODE_AUTH_TOKEN and download-artifact's default digest enforcement. OIDC remains the only npm publication channel.

Reviewed Dependabot #242/241/240/239/238/236/233/228/226/193/180/175/165 for release notes/constraints. Compatible proposals are superseded; SDK/logger/Undici/type majors remain deferred; Commander 15 is included in the final major release. PR #167's older release fix is superseded by the maintained pack/verify/publish workflow; no unrelated branch was merged. Add independent extension Dependabot coverage.

## Security evidence

Counts are known advisories, including distinct affected major ranges, not proven exploitable instances.

| Scope | Baseline low/moderate/high/critical | Final |
|---|---|---|
| Workspace full lockfile | 3/8/6/0 (17) | 0/0/1/0 (1) |
| Workspace production | 2/6/5/0 (13) | 0/0/1/0 (1) |
| Workspace development-only | 1/2/1/0 (4) | 0 |
| Independent extension full lockfile | 8/35/44/0 (87) | 0/0/1/0 (1) |
| Independent extension production | no production dependencies | 0 |

Baseline pnpm 10 classifies linked workspace paths as non-dev in some metadata; development-only counts use paths and the separate production audit.

Remaining: **@azure/msal-node 6.0.1**, high, [GHSA-xcx6-jx8p-x3h5](https://github.com/AzureAD/microsoft-authentication-library-for-js/security/advisories/GHSA-xcx6-jx8p-x3h5). Runtime: Coco → @azure/identity 4.14.0 → MSAL; extension: VSCE 4 → Identity → MSAL (development only, excluded from VSIX). Origin validation in `acquireTokenByCode` can disclose information over the network. Fixed in >=7.1.0 (latest 7.1.2), but latest stable Identity requires ^6.0.0. No compatible upstream correction exists at inspection time. Coco calls `DefaultAzureCredential.getToken`, not auth-code redemption; the advisory workaround is to pass only the auth_code to acquireTokenByCode. This narrows observed exposure but does not establish safety. Keep the upstream-supported graph, without audit suppression; revisit a backport or Identity's adoption of patched MSAL.

Corrected paths include Coco/OpenAI → Undici (7.30.0 → 7.30.1), AJV → fast-uri (3.1.8 → 3.1.9), TypeDoc → markdown-it (14.3.2 → 14.3.3), Vitest/coverage → mocker (4.1.11 → 5.0.5). Extension refresh also corrects esbuild, minimatch, brace-expansion, picomatch, lodash, uuid, qs, tmp, form-data, linkify-it and js-yaml under VSCE's packaging graph. Full and production audits are separate, and a clean npm consumer is checked independently. Known-advisory scans do not prove absence of unknown defects.

## Release recovery

The official [2.43.1 run](https://github.com/corbat-tech/coco/actions/runs/40676113322) passed the release gate and clean-consumer smoke, but stopped before npm publication: npm 12 emits package-name-keyed pack metadata and wraps successful view results in arrays, while the publisher assumed npm 11's single-element array. Registry lookup confirmed 2.43.1 absent. Preserve that tag/artifact; release a new 2.43.2 with shared keyed-object/legacy-array pack normalization and wrapped registry-result handling in the publisher and post-publish integrity check. Regression tests cover the observed object format and reject incomplete/multiple candidates before registry access. Local validation now invokes the isolated npm 12 executable explicitly (fnm's bundled npm 11 had shadowed it). No manual publication or blind retry. A read-only rehearsal packs the official 2.43.0 tarball with real npm 12.2.1, validates the failed run's actual metadata and reconciles registry integrity/latest through the publisher with every operation except view forbidden. This verifies actual CLI formats without granting publish authority.

The 2.43.2 release was cancelled while its prepublication smoke was running (publish step still pending), and the registry was checked before any further release. Engine inventory found the pre-existing ESLint 10 and eslint-visitor-keys 5 floor of 22.13. Remove unused @typescript-eslint/parser (including its ESLint peer), retain the used ESTree parser, and declare >=22.13.0 with major 3.0.0. No unsupported transitive override or compiler rollback. Add a strict clean installation at exactly Node 22.13.0 to CI and local acceptance.

The [3.0.0 run](https://github.com/corbat-tech/coco/actions/runs/40686139952) stopped in the main suite before packing or publishing: Gemini startup exceeded a pending-body fixture's 100 ms real-time budget on the busy runner (one failed, 8,562 passed). Keep that failure and tag. The 3.0.1 fixture uses a controlled timeout clock until READY, then advances exactly 100 ms while the second read is pending. Real HTTP, server close, TimeoutError, one request, non-aborted host signal and iterator-return assertions remain; production timeouts are untouched. Cleanup restores the clock even on failure. No blind retry or suppressed test.

## Validation

Baseline: types/lint/format, 413 files / 8,555 tests (15 skipped), REPL 28 tests, build, five apps and extension types/contracts pass. Coverage statements 80.45%, branches 71.59%, functions 82.55%, lines 81.27%. The pre-existing oxlint no-thenable warning in owned-shell.ts remains unchanged; it models an intentionally tracked completion. Baseline Extension Host could not start because the installed dependencies lacked the declared test-electron package; reinstalling the independent lockfile fixed it.

Migrated Node 24 LTS release gate: initial 8,555 + 28 tests pass; the final 3.0.1 gate passes 8,563 + 28 after eight release-format/validation regressions, thresholds unchanged. Coverage statements 80.47%, branches 71.64%, functions 82.67%, lines 81.29%. Five apps typecheck. macOS arm64 Extension Host 1.137.0 passes executable argv, special paths, multiroot, terminal reuse/new/close, missing executable; trust/launch contracts also pass. VSIX inspected with no dependencies or test fixtures. No live paid provider calls were made.

Installed 2.43.1 prepublication tarball: all six export routes (CLI via --version/--help), real read_file with a scripted provider, file-backed session reopening and continuation pass on macOS arm64 with Node 22.0.0 (declared minimum), 22.23.4, 24.22.1 and 26.12.1. npm resolves one remaining high MSAL advisory in that clean external consumer, matching the documented path; no override is needed to install within declared parent ranges. The package contains only dist (JS, declarations, maps), README, LICENSE and package metadata.

The 2.43.2 tarball is packed and installed using the explicit npm 12.2.1 executable; CLI/exports/tool/durable continuation pass on Node 24.22.1 and the published minimum 22.0.0. Audits still show only the documented MSAL advisory.

The final 3.0.0 tarball installs with --engine-strict on Node 22.13.0; every installed production engine range accepts that minimum, and CLI/exports/tool/persisted continuation pass on 22.13.0 and 24.22.1. Removing the unused parser/ESLint peer reduces clean consumer installation from 322 to 248 packages. The published minimum is now explicit and guarded; earlier 22.0 smokes were behavioral observations, not evidence of compatible dependency engines. Session storage stays at schema version 1.

The CI matrix verifies Node 22/24/26 on Linux; platform contracts and packed consumer checks also run on macOS/Windows. Extension CI runs its real host and VSIX packaging independently. CodeQL SARIF is retained for exact-commit review. The initially active work account returned 403 for security alerts. The already-authenticated personal maintainer account can read them and publish workflow changes; it is selected per command without changing the global account. Baseline main has 18 open CodeQL alerts (pre-existing sanitizer/escaping, URL scheme, shell environment and log findings); final checks compare exact-commit alerts against that baseline without dismissals. Delivery identifiers and observed CI outcomes are appended after validation.

## Official research

- [Node versions/support](https://nodejs.org/en/about/previous-releases), [Node download versions](https://nodejs.org/en/download).
- [pnpm 11 migration](https://pnpm.io/11.x/migration), [pnpm 12 release](https://pnpm.io/blog/releases/12.0), [platform support](https://pnpm.io/installation).
- [TypeScript 7 release and compiler API limitations](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
- [Vitest 5 migration](https://vitest.dev/guide/migration/), [tsup 9](https://github.com/egoist/tsup/releases/tag/v9.0.0), [Execa 10](https://github.com/sindresorhus/execa/releases/tag/v10.0.0), [Chalk 6](https://github.com/chalk/chalk/releases/tag/v6.0.0).
- [Anthropic API migration](https://platform.claude.com/docs/en/api/migration-2026-10-21), [tslog 5](https://github.com/fullstack-build/tslog/releases/tag/v5.0.0), [Undici 8](https://undici.nodejs.org/best-practices/migrating-from-v7-to-v8).
- [npm 12 JSON and lifecycle migration notes](https://github.com/npm/cli/releases/tag/v12.0.0).
- Official npm metadata (engines/peers), upstream security advisories and Actions release notes linked through the reviewed Dependabot PRs.

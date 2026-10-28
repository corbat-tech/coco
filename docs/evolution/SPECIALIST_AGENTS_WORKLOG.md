# Specialist agents implementation log

## P0 — frozen contract

- Base: `dc55b8f162aa429a0385e69c6635191e740c7186`, Coco 3.0.1.
- Branch: `codex/specialist-agents`. Existing untracked implementation plan preserved and included.
- Development runtime: Node 24.22.1 via `fnm exec`; global runtime unchanged.
- Baseline: 58 tests passed across delegation-roles, delegation-consumers, agent-runner, multi-agent and agents command (2026-10-28).
- Acceptance and rollout: implementation plan G1–G9 remain unchanged. Live quality/speed/usage gates cannot be claimed from deterministic fixtures. No live model calls authorized by this implementation run.
- Frozen evaluation corpus: `test/fixtures/delegation/corpus.json`; 36 requests, 24 development and 12 reserved. Strategy labels describe acceptable routing, not functional coding success. A live harness must additionally run external checks on isolated project snapshots before scoring functional performance.
- Existing architecture: runtime owns orchestration (ADRs 009–011); legacy CLI/executor surfaces are adapters. No additional orchestration framework.
- Confirmed gaps: textual `/agents run`; static status; divergent alias resolution; generic AgentRunner accepts tasks without a real executor; graph defaults fail-fast; budget declarations do not prove enforcement.

## Execution order

P1 catalogue → P2 explicit execution → P3 handoffs/evidence → P4 bounded scheduling → P5 recovery/observability → P6 conservative opt-in selection → P7 deterministic evaluation and prepared live protocol → P8 documentation/package verification.

Each implementation entry records focused checks and any deviations. Automatic delegation remains opt-in until real-model gates pass. Uncertain external effects must remain blocked for host reconciliation; no claim of distributed transactions or OS sandboxing.

## P1 — canonical distributed profiles

- Added runtime-owned versioned profiles and strict user-facing alias lookup; legacy REPL prompt/config exports and executor roles now adapt the same catalogue.
- Removed target-project assumptions (Coco-only TypeScript/Vitest conventions), arbitrary shell from read-only researcher/security defaults and coverage/one-assertion goals.
- Preserved 12 public IDs; `coder` canonical lookup is `debug`, `editor` is `refactor`. CLI adapter migrates its previous inconsistent coder alias.
- Focused regression run: 77 tests passed across profiles, policy, budget, legacy executor, delegation role authority and consumers. No model requests.

## P2–P4 — real runtime contracts and bounded scheduling

- Generic AgentRunner fails closed without an executor; explicit simulation remains labelled. Profile IDs, role/risk consistency, output schemas and current-workflow dependency context are enforced.
- Existing graph gains opt-in continue-independent with blocked descendants, retains fail-fast default and serializes mutation-capable work. Invalid numeric scheduler limits are rejected.
- Focused runtime verification: 98 tests passed, typecheck clean. Coordinator-specific coverage: 100% lines and 96.72% branches (agent-reported focused run; integrated verification follows).
- Conservative rollout adjustment: initial plans serialize all mutation-capable nodes, including disjoint writes. Parallelism initially benefits independent readers; no claim of concurrent mutation safety or cross-process locking.

## P2–P6 — session integration, authority and admission

- Typed `/agents run` now executes a worker in the same turn. Session-owned managers replace global state in the new CLI path; status/explain/cancel and persisted interrupted summaries are real, bounded and sanitized.
- Manual is default; auto is opt-in and raw unrequested workers are rejected without a validated plan. Off, unknown roles and negations close admission. Explicit sequential requests survive plan adaptation.
- Root and workers share request admission, including auxiliary compaction. Unknown consumption blocks further calls. Worker stop-reason/tool-call inconsistencies and exhaustion fail before effects.
- Host-only child approval snapshots exact arguments, preserves ancestor authority and is not inherited as worker-created consent. A pre-effect persistence barrier precedes delegated effects; failed persistence prevents dispatch.
- `delegateTask.assignments` adapts bounded acceptance/dependency/resource declarations onto the existing graph. Current workflow identity selects the current authority context; cached coordinators never retain the first caller's authority.
- Structured plans permit bounded file writes only, with canonical host paths, symlink checks, observed-read preconditions and a final optional hash check inside write_file. Other mutation tools return blockers/proposals. Read resources remain advisory within parent authority.
- Independent review identified and drove regressions for missing runtime fields, English contraction negations, explicit sequence, invalid roles, simulated/cancelled results, stale authority, stop reason integrity and content preconditions. No remaining critical finding was reported in the last review; final gate is still required.
- Focused new-policy coverage run: 39 tests passed, 98.82% lines / 96.51% branches; scoped files are profiles, policy, shared budget and coordinator. Global coverage is reported separately.
- Minimum runtime smoke: Node22.13, 67 tests passed across new runtime policies/coordinator/tool-plan/session dispatch/CLI delegation. No new provider calls.
- Five reference apps typecheck successfully after building. Known existing no-thenable lint warning remains unchanged.

## P7 — evaluation preparation and boundaries

- Added a provider-neutral evaluation harness and independent real-file acceptance tests. Seven harness tests pass; no model SDK or provider call is invoked by the fixtures.
- The 36 frozen requests are routing cases, not 36 coding exercises. Added 12 separate coding fixtures and frozen external graders (8 development / 4 reserved after core implementation; not a blind pre-implementation benchmark), an injected-provider Coco adapter and an approval-gated executable pilot runner. All 12 broken baselines fail and all 12 known-good solutions pass real Node acceptance. Live gates remain unexecuted.
- The live protocol documents paired configurations, attempt/call/token budgets, model identity evidence, redaction and retained failures. Live quality/speed gates G5/G6 remain pending; automatic mode is not promoted to a default.

## Integration verification

- First broad integration run: 8649 passed, 15 pre-existing skips, 5 failures. Failures exposed a contraction-regex bug, two scheduling timing changes from an unconditional optional await, and direct-path checkpoint/cancellation regressions. All affected focused regressions subsequently passed; failures were not hidden or replaced with skips.
- First release-gate attempt stopped at formatting the frozen JSON corpus; formatting was corrected without changing its semantic content. Final integrated results follow below.

## Late P5 recovery correction and review

- A new regression reproduced a reopened running ledger entry admitting another mutation. New admission blocks uncertain prior outcomes but permits read-only inspection. Live nested calls are tracked separately.
- Independent review reproduced provider call-ID reuse clearing an older unknown effect. Added hostExecutionId UUID correlation without changing public provider toolCallId correlation; model IDs cannot hide or overwrite host uncertainty.
- `/work resolve` and host-only reconcileWorkEvidence record inspected outcomes as observations, never passing checks. A failed post-effect checkpoint also preserves uncertainty in the current host, preventing an immediate retry.
- New nested/cross-session/collision regressions and minimum Node22.13 checks passed. No additional journal or automatic effect replay was introduced.
- Concrete P7 smoke proposal is now executable: three selected development fixtures × direct/manual/auto × one repetition, nine attempts, max eight logical provider invocations per attempt. No model has been selected or called; explicit consumption approval remains required.

## Final verified delivery

Source and retained test harness: `331db5a` (production recovery fix `783f147`). Subsequent delivery documentation does not change runtime code.

| Check | Observed result |
| --- | --- |
| `fnm exec --using=24.22.1 pnpm check:release` | Passed: typecheck, lint, format, main tests, separate REPL tests, build. |
| Main suite | 8,704 passed, 15 existing skips, 428 files. |
| REPL suite | 29 passed, 1 file. |
| Global coverage | Statements80.73%, branches72.17%, functions82.94%, lines81.56%; configured exclusions/thresholds unchanged. |
| New profile/policy/budget/coordinator coverage | 39 tests; lines98.83%, branches96.02%, functions96.66%, statements97.38%. |
| Minimum Node22.13 | Focused new-policy tests67passed; later recovery/work-command tests26passed; pilot fixtures14 and runner3 passed in separate checks. These are focused checks, not a full second-platform release gate. |
| Five reference apps | Build and typechecks passed again on final source. |
| Generated npm tarball | Consumer imports and CLI help passed using local dependency links; checksum and exact limits in `evidence/specialist-delivery-package.json`. No independent registry install is claimed. |
| Routing local overhead | 1,000 measurements on Node24.22.1/darwin/arm64: median0.000541ms, p95 0.000750ms for the fixed simple request; excludes startup/provider latency and is not a live efficiency comparison. |
| Model/provider evaluation | Not executed. Real pilot requires explicit consumption approval; default remains manual and auto opt-in. |

P0–P6 engineering contracts and conservative rollout are implemented and locally validated. P7 tooling/fixtures/adapter/runner are prepared; its actual model quality/speed/usage gates remain pending. P8 local packaging/docs are verified; publishing/push/global installation changes were not authorized or performed.

Remaining deliberate boundaries: parallel readers with serialized mutation-capable work; no arbitrary shell/test mutation inside structured worker plans; read resources advisory; no OS sandbox/distributed lock; no automatic whole-graph replay. Manual pilot configuration is one forced specialist, not an optimized hand-built team.

## Subsequent release authorization — 3.1.0

The user subsequently authorized review, corrections, merge, push and npm publication. The previous no-publication entries above describe the initial local delivery, not this new authorization.

Pre-release independent review found and reproduced payload mutation during an asynchronous checkpoint and direct workers overlapping under an explicit sequential request. Both were corrected with regressions; specialist trust choices are also persisted. Release3.1.0 adds these corrections and uses the existing official OIDC publication workflow. The live-model evaluation remains outside this release authorization and has not been run.

Publication evidence is the official GitHub tag/release/workflow and npm registry integrity, verified after the workflow completes; it must not be inferred from local version metadata.

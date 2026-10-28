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

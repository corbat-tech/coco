# ADR 012: Proportionate specialist delegation

## Status

Accepted for the opt-in implementation. Live benefit evaluation remains pending.

## Context

ADRs 009–011 established runtime contracts, a shared execution boundary and durable evidence. Specialist definitions still diverged between adapters, commands could express delegation without executing it, and declared budgets did not prove request admission.

## Decision

- Keep the runtime as the canonical owner of profiles, decisions and graph scheduling. Preserve legacy adapters and exports.
- Ship versioned profiles independent of Coco's own project conventions. Use strict user-facing selection while retaining documented legacy aliases.
- Keep direct execution as the default. Manual requests can dispatch specialists; automatic delegation is opt-in and requires a validated decomposition for unrequested workers.
- Reuse `AgentGraphEngine` and `delegateTask`. Bound assignments and concurrency; serialize mutations conservatively rather than introducing worktrees or another scheduler.
- Carry host-owned session dispatch and exact child consent separately from model inputs. Re-evaluate ancestor authority at actual tool execution.
- Share request admission across the parent, workers and auxiliary compaction; unknown usage is not free usage.
- Scope structured file writes and check observed content before overwrites. File tools recheck optional hash preconditions at execution. These checks do not establish an atomic cross-process filesystem transaction.
- Persist pre-effect intent and post-effect observations through the existing ledger and host checkpoints. Interrupted work is inspected, not silently replayed.
- Treat worker completion and semantic acceptance separately. Preserve artifacts and label simulation; missing executors fail closed.

## Consequences

Simple work has no mandatory routing model call. Readers may run concurrently; mutation throughput is intentionally conservative. Structured workers cannot use effects whose scope cannot be bounded, including arbitrary shell/test side effects. Hosts may verify such work separately through normal tool permissions.

Session histories are bounded and sanitized; resources describing reads are advisory within existing parent authority. Neither isolated contexts nor project path checks constitute an OS sandbox. Generic injected executors remain responsible for actual provider calls and tool authority.

Deterministic regressions establish execution contracts. Functional benefit, latency and aggregate usage require paired live evaluations on frozen project fixtures; the routing corpus alone cannot establish them. Automatic mode stays opt-in until those gates pass.

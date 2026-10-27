# ADR 011: Durable Conversations and Work Evidence

## Status

Accepted (2026-10-27). The design is implemented and the final independent
evaluation reports 17/17 deterministic contracts and 13/13 reserved cases
passing. On the common live evaluation criteria, Coco achieved 94/95 and
OpenCode 95/95. These bounded results do not establish global product equivalence.
See the [independent audit](../../evolution/EXCELLENCE_AUDIT.md) for evidence
and limits, and the [continuity guide](../../guides/CONVERSATION_CONTINUITY.md)
for the user-facing workflow.

## Context

Long conversations need more than a final answer and a quality score. A tool may
change files successfully before the next provider request fails. Losing that
tool result makes subsequent work unsafe. A model can also declare completion
without executing a check, and a passing check can become stale after an edit.

Coco already has native message contracts, runtime session stores, a shared tool
executor and permission policy, a context compactor, and REPL session storage.
The decision extends these boundaries rather than adding a workflow framework,
database, global task service, or a second permission system.

## Decision

### Preserve facts separately from the request view

Runtime sessions retain native `Message` history, including tool call IDs,
provider state and thought signatures. A versioned journal in
`metadata.runtimeTurn` records the current turn and its tool call states.

The host persists the user input before calling the runner, the assistant tool
batch before execution, each call's start before its effect, and each result
before proceeding. Calls distinguish `planned`, `running`, and `completed`;
turns distinguish `running`, `completed`, `failed`, and `cancelled`.

A started call with no stored result has an uncertain outcome. Inspection does
not execute it. Explicit host resolution requires the matching turn and call
identity and an evidence reason; resolution records the host's observation,
without replaying the tool or granting additional authority. Resumption closes
unstarted calls as not executed and continues from recorded results. It rejects
completed turns and unresolved started calls before changing their state.

Journal patches load the latest session and preserve unrelated metadata,
including work evidence. A session guard prevents concurrent turns and recovery
mutations within one runtime instance. Native stores remain the persistence
boundary: in-memory stores serve ephemeral hosts, while `FileRuntimeSessionStore`
provides file-backed snapshots using temporary files and rename.

### Share execution guarantees across runtime entry points

The tool-calling runner uses the journal instead of keeping its transcript only
in local variables. Default and custom runners retain their compatibility
contract; transcript-aware resumption requires explicit runner support.

For a runner advertising tool support, `streamTurn` delegates to the durable
`runTurn` path and emits the final text and completion event after execution.
This is buffered delivery, not incremental token streaming. Failures emit an
error rather than a successful completion. The text-only streaming path remains
available for runners that do not advertise tool support.

Headless CLI session continuation uses the file-backed runtime store and exposes
the session identity for subsequent invocations. Session selection is a host
operation, not a model-authored tool argument. A headless invocation still uses
the normal permission boundary.

### Connect REPL persistence to real execution

REPL startup attaches a project-local `FileRuntimeSessionStore` for work state
and tool observations, then saves an initial REPL snapshot. The agent loop's
checkpoint callback saves conversation snapshots at execution boundaries, and
the CLI saves the returned turn result. This is explicit lifecycle wiring;
the presence of an autosave interval configuration alone is not persistence.

`SessionStore` captures a coherent message/configuration/work-state view and
serializes saves per session. A temporary file and rename commit `snapshot.json`
as the authoritative REPL snapshot. Legacy multi-file projections remain for
compatibility and cannot undo a committed snapshot if a projection fails.
Loading prefers the snapshot; `/resume` reconciles it with the latest durable
runtime work ledger.

REPL conversation snapshots and runtime tool observations have different roles.
Restoring a prompt after cancellation does not undo file or shell effects.
Durable observations must remain available to the next conversation, including
started actions whose outcome is unknown. REPL snapshots do not imply that its
interactive loop implements every runtime journal recovery operation.

### Budget the effective request and recover overflow once

The shared context budget measures conversation content, composed system
instructions, serialized definitions of the tools actually offered, and the
reserved output tokens. It distinguishes the fixed system/tool cost from
history that can be compacted. Runtime and REPL use the shared compactor rather
than implementing independent summarizers.

Compaction produces a request view. In the durable runtime runner it does not
rewrite the stored transcript or invalidate journal message references. The
request view preserves complete tool boundaries and recent context; future
turns can reconstruct it from the retained transcript.

A recognized provider context-overflow rejection permits one recovery attempt
for that request: compact at a safe boundary, require actual reduction and a
request that fits, and retry the provider request. Previously executed tools
are not replayed. A second rejection, failed summary, ineffective reduction or
fixed context that cannot fit terminates explicitly. Cancellation, rate limits,
timeouts, output truncation and arbitrary provider errors are not overflow.

### Keep completion claims separate from observed checks

A versioned session work ledger holds at most 64 work items and 128 evidence
records. `read_plan` and `update_plan` use a host-injected session handle through
`ToolExecutionContext`; the model cannot select another session or write a
verification receipt. Updates preserve existing items unless removal is explicit.
An optional expected plan revision detects stale updates.

The shared tool executor captures observations before and after execution.
Recognized built-in checks are distinguished conservatively from arbitrary
commands and remote tools. A successful tool wrapper alone does not establish
a successful check: its reported execution outcome must support that claim.
Pending observations expose unknown outcomes rather than inventing a failure
or success result.

Plan revision and mutation revision are separate. Potential mutations invalidate
older checks conservatively; editing a plan does not itself invalidate them.
Work items may link existing evidence IDs, while derived outcomes distinguish
pending, blocked, completed but unverified, and verified work. Here, verified
means that linked checks executed successfully at the current mutation revision;
it does not prove that the checks cover every user requirement. A heuristic
quality score cannot upgrade completion claims into acceptance.

The ledger survives session snapshots and contributes a bounded prompt/status
projection. It does not replace the runtime transcript, the historical backlog,
background jobs, or an external acceptance verifier.

## Consequences and Limits

- Stores, messages, tools and permission enforcement remain reusable runtime
  components. CLI behavior is wired to them without migrating every legacy
  orchestration surface at once.
- Persisting an intention before execution and a result afterward cannot make
  arbitrary shell or external effects exactly once. A crash between those two
  writes requires inspection and explicit reconciliation.
- Rename-based snapshots do not promise durability across power loss or an
  atomic transaction spanning the filesystem, provider, and external tools.
- Session guards and ordered saves are local to their runtime/store instance.
  There is no multiprocess lock or distributed writer coordination.
- Provider token counters and serialized schema measurements are estimates.
  They do not guarantee an exact count of provider wire tokens, hidden protocol
  overhead or every provider-specific multimodal encoding.
- Durable storage can retain more conversation and tool data than the request
  view. Compaction is not deletion or a retention/privacy policy.
- Observed checks support review; they are not an independent benchmark or
  proof of security, requirement completeness, or equivalent competitor quality.

## Validation Scope

The integration validation scope includes file-backed reopen after a completed effect and
a later failure; failure to persist before and after execution; uncertain-call
inspection and host resolution; cancellation; session concurrency; transcript
pair integrity; and buffered streaming success and failure.

Context validation covers large tool catalogs, fixed-context exhaustion,
repeated real compactions, ineffective summaries, second overflow rejection and
preservation of effects without replay. Work validation checks rejection of invented or
stale check evidence and preserve pending work after steering and reopening.

REPL validation traverses startup, checkpoint/result saving and reopening,
not merely call the storage class directly. Live evaluation records its model,
effort, budgets and external acceptance separately from heuristic scores. Final
check logs and detailed results belong in the delivery evidence, rather than being
duplicated in this architectural decision.

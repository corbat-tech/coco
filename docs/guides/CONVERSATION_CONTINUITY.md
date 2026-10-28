# Continuing work with reliable session state

Coco keeps conversation state, observed tool actions and work plans separate.
An assistant's statement that a task is complete does not establish that its
checks passed. A cancelled request also does not undo a completed tool effect.

## Interactive work

Start `coco` in the project and request a concrete multi-step task. Coco can use
`update_plan` to create or revise a session plan and `read_plan` to inspect it.
Stable step IDs preserve pending work when you change requirements. Removing a
step is explicit; updating one step does not silently replace the whole plan.

Use `/work` to inspect the work plan and recent observed actions/checks. Outcomes
are distinct:

| Outcome | Meaning |
| --- | --- |
| `pending` | Work remains in progress or has not started. |
| `blocked` | At least one step is blocked. |
| `completed_unverified` | Steps are claimed complete, with missing, failed or stale linked checks. |
| `verified` | Every completed step links current successful observed checks. This does not establish that those checks cover every requirement. |
| `not_planned` | No structured work steps have been recorded. |

Evidence comes from actual host-dispatched tools. The model can reference an
existing evidence ID but cannot manufacture a receipt. Known test/typecheck
tools and narrowly recognized standalone check commands qualify; arbitrary
successful commands, remote tools, and help/version invocations do not. An
unknown result protocol is not treated as a successful check.

Potential mutations, including check commands that may themselves write files,
advance the mutation revision before execution. Older check evidence becomes
stale. Editing only the plan does not change the mutation revision. The latest
check may be linked to several steps when it actually checks their behavior;
the host records its outcome, not a proof of semantic coverage.

The CLI saves a snapshot at startup, before model iterations, after returned
turns, after slash-command execution, and on exit. The authoritative snapshot
commits messages/configuration/work state together; older metadata and JSONL
files are compatibility projections. `/resume` lists saved sessions in the
current project and restores conversation data while retaining current host
configuration and consent. A corrupt authoritative snapshot is not replaced
with potentially stale compatibility data.

Tool observations are also written through a project-local runtime store at
`.coco/repl-runtime-sessions.json`. Thus an effect between conversation
checkpoints can still be visible when resuming. Started actions without a
recorded result remain unknown, including their target and call identity; do
not repeat them without inspecting the actual state. The interactive loop's
conversation rollback on cancellation retains these observations.

## Headless continuation

Use the persistent runtime runner for conversations across invocations:

```bash
coco chat --runtime-runner --print "Inspect this project and propose the next change" --output json
coco chat --continue --print "Apply the additional requirement and verify it" --output json
coco chat --session <sessionId> --print "Explain what changed" --output json
```

The JSON result exposes `sessionId`, including failures after session creation.
`--session` and `--continue` select the persistent runtime runner; they cannot be
combined. Sessions live in the selected project's `.coco/runtime-sessions.json`.
`--path` selects the canonical project directory for both persistence and tool
execution. Session selection never grants additional tool authority: current
host/project permissions still apply.
Existing grants are matched by the current host against the exact tool trust
pattern, including shell command, working directory and environment. Embedded
hosts can supply an ephemeral `confirmToolCall` callback; neither that callback
nor approval is inferred from saved messages. Runtime policy and read-only mode
still apply after host confirmation.

To explicitly resume an interrupted recorded task, select its session and omit
the new task:

```bash
coco chat --session <sessionId> --print --output json
```

An unresolved started action blocks continuation. Inspect its real effect and
resolve it through the embedding host's recovery API before resuming. Passing a
new task does not silently replace an interrupted task, and resuming a completed
turn is rejected without altering it.

## Reuse from another agent or application

The reusable exports are available from `@corbat-tech/coco/runtime`:

- `createFileRuntimeSessionStore` and `createToolCallingRuntimeTurnRunner` for
  durable tool conversations.
- `runtime.inspectSessionRecovery(sessionId)` to inspect an interrupted turn and
  its uncertain actions without executing anything.
- `runtime.resolveSessionToolCall(sessionId, { turnId, callId, content, isError,
  reason })` to record a host-observed outcome. `callId` is the host-generated
  uncertain-call ID returned by inspection, not a model-supplied replacement.
- `runtime.resumeTurn({ sessionId, options, confirmedTools })` to continue the
  recorded request after reconciliation, without duplicating the user input.
- `readWorkLedger`, `deriveWorkOutcome` and `formatWorkLedger` for host views.
- `measureContextBudget`, `compactContextToFit` and `ContextCompactor` for
  provider-neutral request budgeting and compaction.

Configure `FileRuntimeSessionStore` explicitly for durable embedded sessions;
the default in-memory store remains appropriate for ephemeral hosts. Tool plan
access is bound by the host's session context. Calling a plan tool directly
without that context fails rather than using a global fallback.

The runtime records user input, planned calls, started calls and completed
results before progressing. A new instance reading the same store can recover
confirmed facts. A started call whose result was not saved has an uncertain
outcome; the host must inspect it instead of automatically executing it again.

For tool-capable runners, `streamTurn` uses this same execution path and delivers
the final text and terminal event after the tools finish. This path is buffered,
not incremental token streaming. Text-only/custom runners without tool support
retain their text streaming behavior. Guards reject concurrent operations on the
same session within one runtime instance.

## Long conversations and limits

The effective request budget includes conversation content, composed system
instructions, actual offered tool schemas and output reserve. The estimate is
provider-neutral and does not measure every wire/media overhead. A classified
context overflow can compact and retry the rejected model request once; it does
not re-execute previously completed tools. An ineffective summary, impossible
fixed budget or second overflow returns an explicit error.

The runtime retains the complete transcript on disk and compacts only its local
request view. This preserves tool evidence and recovery references, at the cost
of growing storage and potentially recomputing a summary after reopening.
Output reserve is a budgeting target, not a guaranteed hard output limit for
every subscription endpoint.

The work ledger holds up to 64 steps and 128 observations. Unresolved started
actions are never discarded to make room for completed history. If the bound is
exhausted by unresolved actions, further recording stops before another effect.
Pruned check references degrade to unverified rather than remaining successful.

File snapshots use atomic replacement and private temporary files. They do not
provide an exactly-once transaction across shell, MCP or remote services, an OS
sandbox, a multi-process lock or a guarantee against power loss. External edits
that bypass Coco's tools require fresh verification. See
[ADR 011](../architecture/adrs/011-durable-conversations-and-work-evidence.md)
and the [independent audit](../evolution/EXCELLENCE_AUDIT.md) for design and evidence.

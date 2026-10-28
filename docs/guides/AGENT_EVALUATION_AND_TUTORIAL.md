# Evaluating Coco and using it on a real project

Coco's supported coding flow is the interactive `coco` agent. Its reusable
runtime also supports embedded applications. Legacy `coco build` and
`coco resume` commands do not execute backlogs or restore phase checkpoints;
they exit with an explicit error.

This guide replaces historical simulated transcripts and unmeasured numerical
ratings. A heuristic score, a generated test, or an assistant's completion claim
does not establish that a change works. See the [October capability review and
live evaluation](../evolution/AGENT_REVIEW_2026-10-27.md) for measured evidence.

## Start with a bounded development task

Install the CLI, configure an available provider, and start it in your checkout:

```bash
npm install -g @corbat-tech/coco
cd my-project
coco
```

For an existing Java/Spring Boot service, a useful first request is:

```text
Inspect the registration controller, service and existing tests. Add validation
for empty email addresses while preserving the public response schema. Follow
AGENTS.md and CLAUDE.md. Reproduce the bug, make the smallest change, and run the
relevant test class. Report the exact command and any remaining failures.
Do not install dependencies, change authentication or publish anything.
```

Use `/plan <instruction>` when you want read-only exploration first. Review the
pending plan with `/plan status`; `/plan edit <text>` changes it and
`/plan reject` discards it. When ready, use `/plan approve` and continue the
approved work. Tool execution still follows the runtime permission policy.
Use `/diff` to inspect edits and `/permissions` to inspect trust settings.

`/quality on` requests iterative review. It does not certify a quality threshold
or prove that every test passed. Ask for the actual test output and inspect the
diff before accepting the result. Run the relevant Maven/Gradle command for your
repository, rather than assuming a generated command matches its build.

## Keep long work recoverable

Managed REPL sessions check context before each model iteration, including
between tool batches during one long turn. Compaction preserves recent complete
tool call/result pairs and recounts the effective system prompt. Failed or
non-reducing compaction is not retried on every iteration of the same turn.
`/compact` remains available for explicit compaction.

Cancelling a turn restores its pre-turn conversation. This does not undo shell,
remote, or already completed file effects. Inspect `/diff` before continuing.
Automatic file checkpoints cover eligible bounded file operations; see
[the checkpoint implementation](../../src/cli/repl/checkpoints/capture.ts)
for restrictions. Do not describe them as complete environment rollback.

For delegated work, truncated output is an incomplete result. A failed
prerequisite blocks its dependent tasks; independent branches can continue.
A plan's declared priority is preserved by `create_agent_plan`; priority-based
ordering selects ready tasks, blocks missing prerequisites and rejects cycles.
These guarantees
do not mean every legacy execution surface has identical session persistence.

## Verify control flow cheaply during development

`/evals run` executes offline replay fixtures. They exercise the agent loop with
scripted provider responses and do not call the selected live model. They are
useful for detecting broken tool round trips; they do not measure coding ability.

While editing Coco, run the focused regression files for the changed behavior.
At integration, use the repository checks:

```bash
pnpm typecheck
pnpm lint
pnpm format
pnpm test:coverage
pnpm test:repl
pnpm build
```

The REPL integration suite is separate because the main Vitest configuration
excludes its interactive entry-point tests. Coverage exclusions and thresholds
are defined in `vitest.config.ts`; a passing aggregate does not establish full
coverage of every agent surface.

## Compare live agent behavior honestly

Choose an isolated fixture with external acceptance tests, preserve its initial
state, and fix the prompt, model, reasoning effort, tools, permissions and budget
before the baseline. Repeat against the improved code from the same starting
state. Include failed attempts and distinguish setup mistakes from valid runs.

Record completion, acceptance tests, tool calls and failures, recovery, steering,
duration and observed usage. Streaming REPL token counts are estimates; do not
present them as provider billing. One successful run after a failure is useful
evidence for that scenario, not a general success-rate or speed claim.

For a subscription-backed Luna comparison, select the actual account-available
`gpt-6-luna` and `/thinking medium`. Coco sends the effort to the endpoint on
streaming and non-streaming requests. Keep the exact model; do not silently
substitute a different one if it is unavailable.

Headless mode only removes interactive prompting; it does not grant authority.
An evaluation host must explicitly permit the intended operations. Shell trust
is tied to the full invocation, including its arguments. Limit test execution
to the fixture and use host-level isolation when running untrusted code.

After verification, retain useful regression tests and a durable evidence
summary. Remove only the temporary evaluation fixtures, raw logs and executed
working plans created for the task. Preserve existing repository material and
user changes.

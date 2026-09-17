# Quality Analysis Guide

This guide describes the 2.42 preview contracts. Check `coco --version`; npm `latest` and `next` may point to different releases.

## Three different kinds of feedback

- `/quality` asks the language model to review its work. It is explicitly **unverified self-review**. Its prose or score does not authorize acceptance.
- `review_code` inspects Git changes with patterns and optional linting. Its approval applies to the requested checks; it is not a complete security or requirements audit. A missing base or unavailable requested linter prevents approval.
- `coco check` and `calculate_quality` produce an evidence-backed evaluation. Acceptance requires complete, current measurements; unavailable tools and failed execution cannot become a passing score.

## Run and save an evaluation

```bash
coco check --path ./my-project
coco check --path ./my-project --output json --output-file ./quality.json
coco check --path ./my-project --output markdown --output-file ./quality.md
```

Reports are written only when `--output-file` is supplied; there is no automatic report after every agent reply. JSON, Markdown and HTML are supported. By default the command exits nonzero when the evaluation fails its minimum. `--no-fail` changes the exit behavior for inspection; it does not turn an incomplete evaluation into a pass.

Only evaluate a trusted project: checks execute the project's test/build commands. Inspect its scripts and dependencies first.

## Evidence and acceptance

Every dimension records one of `measured`, `not_applicable`, `unavailable` or `error`, with its evidence/reason. Only measured dimensions contribute effective weight. Not-applicable dimensions can be excluded with a stated reason; unavailable or erroneous evidence makes acceptance incomplete.

Tests, coverage and the project snapshot must belong to the same evaluation. Old coverage files are not a substitute for a new run. The current source hash also binds review and acceptance: editing the project invalidates earlier evidence. Cancellation and command failure remain failures.

A complete report can still fail thresholds. Conversely, an iteration can stop because it reached its budget or stopped improving without passing. Read the acceptance fields and reasons, not just an overall number.

## Quality Dimensions

The evaluator has **12 dimensions** (0–100). Some use static heuristics; a score is not a proof that requirements are correct or that no vulnerability exists.

| Dimension | Weight | What it measures |
|-----------|-------:|-----------------|
| Correctness | 15% | Tests pass, build succeeds, logic correct |
| Completeness | 10% | All requirements implemented |
| Robustness | 10% | Edge cases handled, error handling present |
| Readability | 10% | Code clarity and naming conventions |
| Maintainability | 10% | Ease of future modification |
| Complexity | 8% | Cyclomatic complexity (lower = higher score) |
| Duplication | 7% | DRY score — code reuse (lower dup = higher score) |
| Test Coverage | 10% | Line and branch coverage |
| Test Quality | 5% | Tests are meaningful, not boilerplate |
| Security | 8% | Vulnerabilities — 100 = none found |
| Documentation | 4% | JSDoc / Javadoc coverage |
| Style | 3% | Lint and formatting compliance |

**Acceptance floor:** 85/100 overall, 80% coverage and the required security threshold, plus complete evidence tied to the current project snapshot.

## Language support and limits

The certified measurement path currently supports JavaScript/TypeScript source, including `.mjs`, `.cjs`, `.mts` and `.cts`. It needs compatible local test, coverage, build and lint tooling. An unsupported setup reports unavailable/error instead of inventing a score.

The language registry also contains Java and React heuristics (for example, Javadoc/JaCoCo hints and React accessibility/hook patterns). These remain available to existing callers, but do not override the certified measurement contract. Their existence does not certify all twelve dimensions for every language. Static security patterns are not a vulnerability scanner or a penetration test.

Completeness, readability and similar dimensions use heuristics rather than an independent understanding of all user requirements. Review requirements and diffs yourself even when the measured gate passes.

## Configuration and stopping

Programmatic evaluator callers can supply supported thresholds and weights. Applicable measured weights are normalized. The acceptance floor is not bypassed by lowering a project's preferred target.

Project configuration can contain quality preferences, but do not assume every command consumes every field. In particular, `coco check` constructs its evaluator directly; verify the effective settings in the calling path before relying on a project-specific override. `ignoreRules` and `ignoreFiles` are configuration fields, not a promise that every analyzer filters its findings.

Quality iteration may stop at the iteration limit, a stable score or another convergence guard. **Stopping is not acceptance.** When evidence is incomplete or thresholds are unmet, report the remaining checks and findings instead of claiming completion.

## CI and review

Store the report with the commit and test logs being reviewed. Re-run after changes. A GitHub comment or HTML report is a presentation of evidence, not new evidence itself.

See [Configuration Guide](CONFIGURATION.md), [GitHub Actions Integration](GITHUB-ACTIONS.md) and [Providers Guide](PROVIDERS.md).

# Quality Analysis Guide

How Corbat-Coco measures, reports, and enforces code quality.

## Quality Dimensions

Coco evaluates code across **12 dimensions** (0–100 each):

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

**Default minimum:** 85/100 overall, 80% coverage, 100 security

## Supported Languages

| Language | ID | Analyzers |
|----------|----|-----------|
| TypeScript | `typescript` | All 12 dimensions |
| JavaScript | `javascript` | All 12 dimensions |
| React + TypeScript | `react-typescript` | All 12 + React-specific |
| React + JavaScript | `react-javascript` | All 12 + React-specific |
| Java | `java` | Complexity, Security, Style, Documentation, Coverage (JaCoCo) |

Language is **auto-detected** from file extensions. Override with:
```json
// .coco.config.json
{ "language": "react-typescript" }
```

## Language-Specific Analysis

### TypeScript / JavaScript

All 12 dimensions run automatically. Key tools:

- **Security** — OWASP pattern matching (SQLi, XSS, hardcoded secrets)
- **Complexity** — AST-based cyclomatic complexity
- **Coverage** — c8/v8 instrumentation
- **Style** — oxlint / ESLint integration

### React

In addition to TS/JS analysis, React projects get three extra analyzers:

**Component Quality (`style` dimension)**
- Missing `key` prop in `.map()` rendering → error
- Untyped props (`function X(props)` without interface) → error
- Missing JSDoc on exported components → warning
- Direct DOM manipulation → warning
- `dangerouslySetInnerHTML` without sanitization → error

**Accessibility (`robustness` dimension)**
- `<img>` without `alt` → error (WCAG 1.1.1)
- `<a>` without `href` → error (WCAG 2.1.1)
- `<div>`/`<span>` with `onClick` but no keyboard support → warning
- `<input>` without label association → warning

**React Hooks Rules (`correctness` dimension)**
- `useEffect` without dependency array → warning
- Hook called inside conditional or loop → error (Rules of Hooks)

### Java

**Complexity** — Cyclomatic complexity per method (branch keyword counting)

**Security** — OWASP Top 10 patterns:
- SQL injection (string concatenation in `.execute()`)
- Hardcoded credentials (password/secret variable assignments)
- Unsafe deserialization (`ObjectInputStream.readObject()`)
- Path traversal, command injection, XXE, insecure `Random`

**Style** — Java conventions:
- Class names must be PascalCase
- Method names must be camelCase (not PascalCase)
- Max 5 parameters per method
- Max 120 characters per line

**Documentation** — Javadoc coverage for `public` methods and classes

**Coverage** — Parses JaCoCo XML report (`target/site/jacoco/jacoco.xml` by default):
```json
{
  "analyzers": {
    "java": {
      "reportPath": "build/reports/jacoco/test/jacocoTestReport.xml"
    }
  }
}
```

## Customising Quality Thresholds

### Via `.coco.config.json` (recommended for teams)

```json
{
  "quality": {
    "minScore": 90,
    "minCoverage": 85,
    "securityThreshold": 100,
    "maxIterations": 8,
    "weights": {
      "security": 0.15,
      "correctness": 0.20
    },
    "ignoreRules": ["react/missing-jsdoc"],
    "ignoreFiles": ["**/generated/**"]
  }
}
```

Weights are **normalised automatically** — you only set the relative importance.

### Via `.coco/config.json` (personal/machine settings)

```json
{
  "quality": {
    "minScore": 85,
    "minCoverage": 80,
    "maxIterations": 10
  }
}
```

## Quality Reports

### Terminal Output

Coco prints a quality table after every evaluation:

```
╭─── Quality Report ───────────────────────────────╮
│  Dimension        Score  Bar                  Status │
├──────────────────────────────────────────────────────┤
│  Correctness        92  ████████████████████  ✓      │
│  Security          100  ████████████████████  ✓      │
│  Test Coverage      78  ███████████████░░░░░  ~      │
│  ...                                                  │
├──────────────────────────────────────────────────────┤
│  Overall            87  █████████████████░░░  ✓      │
╰──────────────────────────────────────────────────────╯
```

### Saved Reports

Reports are saved to `.coco/reports/` in three formats:

```bash
# JSON — machine-readable, use in CI pipelines
.coco/reports/quality-2026-02-19T12-00-00.json

# Markdown — GitHub PRs, wikis, READMEs
.coco/reports/quality-2026-02-19T12-00-00.md

# HTML — standalone browser report
.coco/reports/quality-2026-02-19T12-00-00.html
```

### GitHub Actions Integration

See [GITHUB-ACTIONS.md](GITHUB-ACTIONS.md) for posting quality reports as PR comments automatically.

## Convergence Loop

Coco iterates until quality converges:

1. Generate / modify code
2. Run tests and analyzers
3. Check score vs. threshold
4. If below threshold → identify issues → apply fixes → go to 2
5. If converged → done ✅

**Convergence conditions** (checked in order):
1. Hit `maxIterations` limit
2. Score ≥ target (95 by default)
3. Score stable — delta < 2 above minimum for 2 consecutive iterations

When using the `/coco-fix-iterate` skill, additional convergence guards run at the orchestration layer:
- Score stuck below minimum for 5 iterations → stops with "needs manual intervention"
- Score oscillating (delta < 3 for last 4 iterations) → stops with "oscillating"
- Diminishing returns (< 1pt gain for 3 iterations) → stops with "diminishing_returns"

Tune with:
```json
{ "quality": { "maxIterations": 5, "minScore": 80 } }
```

## Ignoring Rules and Files

### Ignore specific rules

```json
{
  "quality": {
    "ignoreRules": [
      "react/missing-jsdoc",
      "react-hooks/exhaustive-deps"
    ]
  }
}
```

> **Note**: `ignoreRules` and `ignoreFiles` are stored in the project config and available
> to analyzers at runtime, but enforcement (filtering issues before scoring) is planned for
> a future release. Currently these fields have no effect on analyzer output.

### Ignore files from analysis

```json
{
  "quality": {
    "ignoreFiles": [
      "**/generated/**",
      "**/vendor/**",
      "**/*.d.ts"
    ]
  }
}
```

---

See also:
- [Configuration Guide](CONFIGURATION.md)
- [GitHub Actions Integration](GITHUB-ACTIONS.md)
- [Providers Guide](PROVIDERS.md)

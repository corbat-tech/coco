# Changelog Format Guide

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## Section order

Always use this order for change categories:

1. **Added** - New features
2. **Changed** - Changes in existing functionality
3. **Improved** - Enhancements to existing features (performance, UX, etc.)
4. **Fixed** - Bug fixes
5. **Removed** - Removed features
6. **Documentation** - Documentation-only changes
7. **Security** - Security-related changes

Only include sections that have entries. Do not add empty sections.

## Writing style

- Start each entry with a bold summary: `- **Short description**`
- Add sub-bullets for details if needed (indented with 2 spaces)
- Write from the user's perspective, not the developer's
- Use present tense: "Add", "Fix", "Improve" (not "Added", "Fixed")
- Group related changes under a single entry with sub-bullets

## Example

```markdown
## [1.8.0] - 2026-02-18

### Added
- **Concurrent input processing**
  - Multiple inputs can be processed simultaneously without blocking
  - Auto-classification of input types (command, query, code)
  - Abort and rollback support for in-flight operations

### Improved
- **LLM response streaming performance**
  - 40% faster token rendering with batched updates
  - Reduced memory allocation during long responses

### Fixed
- **COCO mode timeout on slow providers**
  - Quality iteration loops no longer get interrupted prematurely
  - Unified 120s timeout across all providers
```

## Version links

At the bottom of CHANGELOG.md, maintain comparison links:

```markdown
[unreleased]: https://github.com/corbat/corbat-coco/compare/v1.8.0...HEAD
[1.8.0]: https://github.com/corbat/corbat-coco/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/corbat/corbat-coco/compare/v1.6.0...v1.7.0
```

## Mapping commits to categories

| Commit prefix | Changelog section |
|---------------|-------------------|
| `feat` | Added |
| `fix` | Fixed |
| `perf` | Improved |
| `refactor` | Changed |
| `docs` | Documentation |
| `security` | Security |
| `chore(release)` | Skip (meta) |
| `test` | Skip (internal) |
| `ci` | Skip (internal) |

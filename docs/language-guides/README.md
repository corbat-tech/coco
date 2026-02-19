# Language Guides

These guides contain coding standards and patterns for projects *built with* corbat-coco.

**They are NOT loaded automatically by Claude Code** — they live here as reference material, not in `rules/`.

## Usage

When corbat-coco generates a project in one of these languages, it applies these guides. If you are working on a user project manually with Claude Code, include the relevant guide in your project's `CLAUDE.md`:

```markdown
# CLAUDE.md (in your project root)
@docs/language-guides/python/style.md
@docs/language-guides/python/testing.md
```

Or copy the relevant files into your project's own `rules/` directory.

## Available Guides

| Language | Directory | Key frameworks |
|----------|-----------|----------------|
| Python | `python/` | FastAPI, pytest, Pydantic, async/await |
| Java | `java/` | Spring Boot, Gradle/Maven, JUnit 5, Java 21+ |
| Go | `golang/` | Go 1.21+, slog, table-driven tests, interface-driven design |

## corbat-coco Development

The TypeScript rules that govern corbat-coco's own development live in `rules/typescript/`, not here. Those ARE loaded automatically by Claude Code when working on corbat-coco itself.

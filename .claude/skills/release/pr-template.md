# PR Template for Release

Use this template when creating the release PR. Replace placeholders with actual values.

```markdown
## Release v{{VERSION}}

### Changes included

{{CHANGELOG_SECTION}}

### Checklist

- [x] CHANGELOG.md updated
- [x] README.md reviewed (updated if needed)
- [x] Version bumped in package.json
- [x] `pnpm check` passing (typecheck + lint + test)
- [ ] CI checks passing
- [ ] Merged to main
- [ ] Tag created and pushed
- [ ] npm publish triggered

### Post-merge

After merging, a tag `v{{VERSION}}` will be created and pushed, triggering the release workflow that publishes to npm and creates a GitHub Release.
```

## Instructions for filling the template

- `{{VERSION}}`: The new version number (e.g., `1.8.0`)
- `{{CHANGELOG_SECTION}}`: Copy the content from the new version section in CHANGELOG.md, formatted as bullet points
- Keep the checklist as-is; items will be checked as the workflow progresses

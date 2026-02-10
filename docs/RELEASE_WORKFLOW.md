# Release Workflow (Sube Versión)

This document describes the complete workflow for releasing a new version of Coco to npm.

## Overview

The release process is fully automated through a series of steps that ensure code quality, proper versioning, and safe deployment.

## Prerequisites

- Clean git working directory (no uncommitted changes)
- All tests passing (`pnpm test`)
- Proper npm authentication configured
- GitHub CLI (`gh`) installed and authenticated
- Write access to the repository

## Release Steps

### 1. Create Feature Branch

```bash
git checkout -b feat/v1.x.x-description
```

### 2. Implement Changes

Make your code changes, following the project's coding standards:

- TypeScript with strict mode
- ESM modules only
- Comprehensive tests (coverage > 80%)
- oxlint + oxfmt for linting/formatting

### 3. Run Quality Checks

```bash
# Type check
pnpm typecheck

# Lint
pnpm lint

# Format check
pnpm format

# Run tests
pnpm test

# Full check (all of the above)
pnpm check
```

Fix any issues before proceeding.

### 4. Run Test Coverage

```bash
pnpm test:coverage
```

Ensure coverage is above 80% for all metrics (lines, functions, branches, statements).

### 5. Update Version

Edit `package.json` to bump the version following [Semantic Versioning](https://semver.org/):

- **Patch** (x.x.1): Bug fixes, minor changes
- **Minor** (x.1.0): New features, backward-compatible
- **Major** (1.0.0): Breaking changes

```json
{
  "version": "1.4.0"
}
```

### 6. Update CHANGELOG.md

Add a new section for your version following the [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
## [1.4.0] - 2026-02-10

### Added
- New feature X
- New command Y

### Changed
- Improved Z behavior

### Fixed
- Bug in W
```

Update the version links at the bottom of the changelog.

### 7. Commit Changes

```bash
git add .
git commit -m "feat(release): v1.4.0 - description

- Feature 1
- Feature 2
- Improvement 3"
```

**Important:** Do NOT include `Co-Authored-By: Claude` or similar in release commits.

### 8. Push Branch

```bash
git push -u origin feat/v1.x.x-description
```

### 9. Create Pull Request

```bash
gh pr create --title "Release v1.4.0: Description" --body "$(cat <<'EOF'
## Summary
- New feature X with comprehensive tests
- Improved Y for better UX
- Fixed bug in Z

## Changes
- Added `/full-access` command with safety guards
- Enabled `/coco` mode by default
- Redesigned README for better clarity

## Quality
- Test coverage: 82%
- All checks passing
- No security vulnerabilities

## Breaking Changes
None

## Test Plan
- [x] Manual testing of new features
- [x] All unit tests passing
- [x] Integration tests verified
- [x] Documentation updated

🤖 Generated with [Coco](https://github.com/corbat/corbat-coco)
EOF
)"
```

### 10. Wait for CI Checks

GitHub Actions will automatically run:

- TypeScript compilation
- Linting (oxlint)
- Tests (Vitest)
- Coverage report
- Security scan (CodeQL)

Monitor the checks:

```bash
gh pr checks
```

If checks fail, fix the issues, commit, and push again.

### 11. Merge Pull Request

Once all checks pass and you've reviewed the changes:

```bash
gh pr merge --squash --delete-branch
```

Or use the GitHub web interface to merge.

### 12. Create and Push Tag

After merging to main:

```bash
git checkout main
git pull
git tag -a v1.4.0 -m "Release v1.4.0"
git push origin v1.4.0
```

### 13. Publish to npm

The tag push will trigger automatic npm publishing via GitHub Actions.

Alternatively, publish manually:

```bash
pnpm build
npm publish --access public
```

### 14. Verify Publication

Check that the package is available:

```bash
npm view @corbat-tech/coco version
```

Test installation:

```bash
npm install -g @corbat-tech/coco@latest
coco --version
```

## Quick Reference

### One-Command Release Checklist

```bash
# 1. Create branch
git checkout -b feat/v1.x.x-description

# 2. Make changes
# ... (edit files)

# 3. Run quality checks
pnpm check
pnpm test:coverage

# 4. Update version in package.json
# ... (edit package.json)

# 5. Update CHANGELOG.md
# ... (edit CHANGELOG.md)

# 6. Commit and push
git add .
git commit -m "feat(release): v1.x.x - description"
git push -u origin feat/v1.x.x-description

# 7. Create PR
gh pr create --title "Release v1.x.x" --body "..."

# 8. Wait for checks
gh pr checks

# 9. Merge
gh pr merge --squash --delete-branch

# 10. Tag and publish
git checkout main
git pull
git tag -a v1.x.x -m "Release v1.x.x"
git push origin v1.x.x

# 11. Verify
npm view @corbat-tech/coco version
```

## Common Issues

### npm Publish Fails

**Error:** Permission denied

**Solution:**
```bash
npm login
# Or use npm token
npm config set //registry.npmjs.org/:_authToken YOUR_TOKEN
```

### Tests Fail in CI

**Error:** Tests pass locally but fail in CI

**Solution:**
- Check for environment-specific issues
- Ensure all dependencies are in `package.json`
- Review CI logs for specific failures
- Run tests in a clean environment: `rm -rf node_modules && pnpm install && pnpm test`

### Version Conflict

**Error:** Version already exists on npm

**Solution:**
- Bump the version number again
- Update CHANGELOG.md
- Create a new commit and tag

### Tag Already Exists

**Error:** Tag v1.x.x already exists

**Solution:**
```bash
# Delete local tag
git tag -d v1.x.x

# Delete remote tag
git push origin :refs/tags/v1.x.x

# Create new tag
git tag -a v1.x.x -m "Release v1.x.x"
git push origin v1.x.x
```

## Rollback Procedure

If a release has critical issues:

### 1. Deprecate the Version

```bash
npm deprecate @corbat-tech/coco@1.4.0 "Critical bug - use 1.3.0 instead"
```

### 2. Publish a Patch

```bash
# Create hotfix branch
git checkout -b hotfix/v1.4.1

# Make fixes
# ... (edit files)

# Follow the release process for v1.4.1
```

### 3. Notify Users

- Update GitHub release notes
- Post in discussions/issues
- Update README if needed

## Automated Release (Future)

We're working on automating this process with:

- Automatic version bumping based on conventional commits
- Automated CHANGELOG generation
- One-command releases with `/ship`

Stay tuned!

---

For questions or issues with the release process, open an issue on [GitHub](https://github.com/corbat/corbat-coco/issues).

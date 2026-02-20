#!/bin/bash
set -euo pipefail

# =============================================================================
# release-pr.sh - Create a PR and tag for merged feature changes
# =============================================================================
# Usage: release-pr.sh [bump-type] [project-dir]
#
# Creates a Pull Request from the current merge branch to main,
# determines the version bump, creates a git tag, and pushes.
#
# Arguments:
#   bump-type    Version bump type: patch|minor|major (default: auto-detect)
#   project-dir  Project directory (default: current directory)
#
# Auto-detection rules:
#   - "feat:" commits -> minor
#   - "fix:" commits -> patch
#   - "BREAKING CHANGE" or "!:" -> major
#   - Default -> patch
# =============================================================================

BUMP_TYPE="${1:-auto}"
PROJECT_DIR="${2:-$(pwd)}"

# Resolve absolute path
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
cd "$PROJECT_DIR"

# --- Validations ---

if [ ! -d ".git" ]; then
  echo "Error: $PROJECT_DIR is not a git repository"
  exit 1
fi

# Check we're on a merge branch
CURRENT_BRANCH=$(git branch --show-current)
if [[ ! "$CURRENT_BRANCH" =~ ^merge/ ]]; then
  echo "Error: expected to be on a merge/* branch, but on '$CURRENT_BRANCH'"
  echo "Run /merge-back first to create a merge branch."
  exit 1
fi

FEATURE_NAME="${CURRENT_BRANCH#merge/}"

# Check gh CLI is available
if ! command -v gh &> /dev/null; then
  echo "Error: GitHub CLI (gh) is not installed."
  echo "Install it: https://cli.github.com/"
  exit 1
fi

# Check we have a remote
if ! git remote get-url origin &> /dev/null; then
  echo "Error: no 'origin' remote configured."
  exit 1
fi

echo "=== Release PR ==="
echo "Feature: $FEATURE_NAME"
echo "Branch:  $CURRENT_BRANCH"
echo ""

# --- Phase 1: Determine version bump ---

echo "[1/6] Analyzing commits for version bump..."

COMMITS=$(git log --oneline main.."$CURRENT_BRANCH" 2>/dev/null || echo "")
if [ -z "$COMMITS" ]; then
  echo "Error: no commits found between main and $CURRENT_BRANCH"
  exit 1
fi

echo "  Commits to include:"
echo "$COMMITS" | sed 's/^/    /'
echo ""

if [ "$BUMP_TYPE" = "auto" ]; then
  if echo "$COMMITS" | grep -qiE "BREAKING CHANGE|!:"; then
    BUMP_TYPE="major"
  elif echo "$COMMITS" | grep -qiE "^[a-f0-9]+ feat"; then
    BUMP_TYPE="minor"
  else
    BUMP_TYPE="patch"
  fi
  echo "  Auto-detected bump type: $BUMP_TYPE"
else
  echo "  Manual bump type: $BUMP_TYPE"
fi

# --- Phase 2: Calculate new version ---

echo "[2/6] Calculating new version..."

# Get latest tag or default to 0.0.0
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
LATEST_VERSION="${LATEST_TAG#v}"

# Also check package.json version
if [ -f "package.json" ]; then
  PKG_VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "")
  if [ -n "$PKG_VERSION" ]; then
    # Use the higher version between tag and package.json
    if [ "$(printf '%s\n' "$LATEST_VERSION" "$PKG_VERSION" | sort -V | tail -1)" = "$PKG_VERSION" ]; then
      LATEST_VERSION="$PKG_VERSION"
    fi
  fi
fi

IFS='.' read -r MAJOR MINOR PATCH <<< "$LATEST_VERSION"
MAJOR=${MAJOR:-0}
MINOR=${MINOR:-0}
PATCH=${PATCH:-0}

case "$BUMP_TYPE" in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
NEW_TAG="v${NEW_VERSION}"

echo "  Current version: $LATEST_VERSION"
echo "  New version:     $NEW_VERSION ($BUMP_TYPE bump)"
echo ""

# --- Phase 3: Update package.json version if exists ---

echo "[3/6] Updating version references..."

if [ -f "package.json" ]; then
  # Use node to update version safely (preserves formatting)
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = '${NEW_VERSION}';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "  Updated package.json version to $NEW_VERSION"
  HAS_FORMAT=$(node -e "const p=require('./package.json'); console.log(p.scripts?.['format:fix'] ? 'yes' : 'no')" 2>/dev/null || echo "no")
  if [ "$HAS_FORMAT" = "yes" ]; then
    echo "  Running 'pnpm format:fix'..."
    pnpm format:fix 2>&1 || true
  fi
  git add -u && git commit -m "chore: bump version to $NEW_VERSION" --no-verify
fi

# --- Phase 4: Merge to main ---

echo "[4/6] Merging to main..."
git checkout main
git merge "$CURRENT_BRANCH" --no-edit -m "feat($FEATURE_NAME): merge feature $FEATURE_NAME ($NEW_TAG)"

# --- Phase 5: Create tag ---

echo "[5/6] Creating tag $NEW_TAG..."
git tag -a "$NEW_TAG" -m "Release $NEW_TAG - $FEATURE_NAME"

# --- Phase 6: Push and create PR ---

echo "[6/6] Pushing to remote..."
git push origin main
git push origin "$NEW_TAG"

# Clean up merge branch
git branch -D "$CURRENT_BRANCH" 2>/dev/null || true

echo ""

# --- Summary ---

echo "=== Release Complete ==="
echo ""
echo "Version: $NEW_VERSION"
echo "Tag:     $NEW_TAG"
echo "Branch:  main (updated)"
echo ""
echo "Changes pushed to remote. If there's a CI/CD pipeline configured,"
echo "it should pick up the new tag automatically."
echo ""
echo "Commits included:"
echo "$COMMITS" | sed 's/^/  /'
echo ""

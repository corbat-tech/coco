#!/bin/bash
set -euo pipefail

# =============================================================================
# merge-back.sh - Merge changes from an isolated copy back to the original
# =============================================================================
# Usage: merge-back.sh <feature-name> [original-dir]
#
# Brings changes from a forked copy back to the original project using
# standard git merge (possible because we used git clone, so histories share
# a common ancestor).
#
# Arguments:
#   feature-name  Name of the feature/copy (e.g., "auth-refactor")
#   original-dir  Original project directory (default: current directory)
#
# What it does:
#   1. Validates the copy exists and has committed changes
#   2. Runs checks (tests, lint) in the copy
#   3. Adds the copy as a temporary remote
#   4. Fetches and merges into a new branch
#   5. Removes the temporary remote
# =============================================================================

FEATURE_NAME="${1:?Error: feature name required. Usage: merge-back.sh <feature-name> [original-dir]}"
ORIGINAL_DIR="${2:-$(pwd)}"

# Resolve absolute path
ORIGINAL_DIR="$(cd "$ORIGINAL_DIR" && pwd)"
PROJECT_NAME="$(basename "$ORIGINAL_DIR")"
PARENT_DIR="$(dirname "$ORIGINAL_DIR")"
COPY_DIR="${PARENT_DIR}/${PROJECT_NAME}_copy_${FEATURE_NAME}"
REMOTE_NAME="copy_${FEATURE_NAME}"
MERGE_BRANCH="merge/${FEATURE_NAME}"

# --- Validations ---

if [ ! -d "$COPY_DIR" ]; then
  echo "Error: copy not found at $COPY_DIR"
  echo "Available copies:"
  ls -d "${PARENT_DIR}/${PROJECT_NAME}_copy_"* 2>/dev/null || echo "  (none)"
  exit 1
fi

if [ ! -d "$COPY_DIR/.git" ]; then
  echo "Error: $COPY_DIR is not a git repository"
  exit 1
fi

if [ ! -d "$ORIGINAL_DIR/.git" ]; then
  echo "Error: $ORIGINAL_DIR is not a git repository"
  exit 1
fi

# Check copy has no uncommitted changes
cd "$COPY_DIR"
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet HEAD 2>/dev/null; then
  echo "Error: there are uncommitted changes in the copy at $COPY_DIR"
  echo "Please commit or stash all changes in the copy before merging back."
  exit 1
fi

# Check copy branch exists
COPY_BRANCH="work/${FEATURE_NAME}"
if ! git rev-parse --verify "$COPY_BRANCH" >/dev/null 2>&1; then
  echo "Warning: branch $COPY_BRANCH not found in copy."
  COPY_BRANCH=$(git branch --show-current)
  echo "Using current branch: $COPY_BRANCH"
fi

echo "=== Merge Back ==="
echo "Copy:     $COPY_DIR"
echo "Original: $ORIGINAL_DIR"
echo "Branch:   $COPY_BRANCH -> $MERGE_BRANCH"
echo ""

# --- Phase 1: Pre-merge checks in the copy ---

echo "[1/5] Running pre-merge checks in the copy..."
cd "$COPY_DIR"

# Check if there are actual changes compared to the base
COMMIT_COUNT=$(git rev-list --count main..HEAD 2>/dev/null || echo "0")
if [ "$COMMIT_COUNT" = "0" ]; then
  echo "Warning: no commits found on top of main in the copy."
  echo "Are you sure there are changes to merge?"
  echo ""
fi

# Run tests if available
if [ -f "package.json" ]; then
  HAS_CHECK=$(node -e "const p=require('./package.json'); console.log(p.scripts?.check ? 'yes' : 'no')" 2>/dev/null || echo "no")
  HAS_TEST=$(node -e "const p=require('./package.json'); console.log(p.scripts?.test ? 'yes' : 'no')" 2>/dev/null || echo "no")

  # Always auto-fix formatting first — prevents CI Lint & Format failures
  HAS_FORMAT=$(node -e "const p=require('./package.json'); console.log(p.scripts?.['format:fix'] ? 'yes' : 'no')" 2>/dev/null || echo "no")
  if [ "$HAS_FORMAT" = "yes" ]; then
    echo "  Running 'pnpm format:fix' in copy..."
    pnpm format:fix 2>&1 || true
    git add -u 2>/dev/null || true
    if ! git diff --cached --quiet 2>/dev/null; then
      git commit -m "fix(format): apply formatter before merge-back" --no-verify
      echo "  Formatter applied and committed."
    fi
  fi

  if [ "$HAS_CHECK" = "yes" ]; then
    echo "  Running 'pnpm check' in copy..."
    if ! pnpm check 2>&1; then
      echo ""
      echo "Error: checks failed in the copy. Fix issues before merging."
      exit 1
    fi
    echo "  Checks passed."
  elif [ "$HAS_TEST" = "yes" ]; then
    echo "  Running 'pnpm test' in copy..."
    if ! pnpm test 2>&1; then
      echo ""
      echo "Error: tests failed in the copy. Fix issues before merging."
      exit 1
    fi
    echo "  Tests passed."
  else
    echo "  No test/check script found, skipping."
  fi
fi
echo ""

# --- Phase 2: Add remote and fetch ---

cd "$ORIGINAL_DIR"

echo "[2/5] Ensuring clean state in original..."
if ! git diff --quiet HEAD 2>/dev/null; then
  echo "Warning: there are uncommitted changes in the original."
  echo "Stashing them before merge..."
  git stash push -m "auto-stash before merge-back ${FEATURE_NAME}"
  STASHED=true
else
  STASHED=false
fi

echo "[3/5] Adding copy as temporary remote..."
# Remove remote if it already exists (from a previous failed attempt)
git remote remove "$REMOTE_NAME" 2>/dev/null || true
git remote add "$REMOTE_NAME" "$COPY_DIR"
git fetch "$REMOTE_NAME"

# --- Phase 3: Create merge branch and merge ---

echo "[4/5] Creating merge branch and merging..."

# Ensure we're on main
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "  Switching to main..."
  git checkout main
fi

# Delete merge branch if it exists (from a previous attempt)
git branch -D "$MERGE_BRANCH" 2>/dev/null || true

# Create merge branch from main
git checkout -b "$MERGE_BRANCH"

# Merge the copy's work branch
if ! git merge "${REMOTE_NAME}/${COPY_BRANCH}" --no-edit -m "feat: merge ${FEATURE_NAME} from isolated copy"; then
  echo ""
  echo "=== MERGE CONFLICT ==="
  echo "There are merge conflicts. Please resolve them manually:"
  echo "  1. Fix the conflicts in the files listed above"
  echo "  2. Run: git add . && git commit"
  echo "  3. Then run: /cleanup-copy $FEATURE_NAME"
  echo ""
  echo "The temporary remote '$REMOTE_NAME' is still configured."
  exit 1
fi

# --- Phase 4: Cleanup remote ---

echo "[5/5] Cleaning up temporary remote..."
git remote remove "$REMOTE_NAME"

# Restore stash if needed
if [ "$STASHED" = "true" ]; then
  echo "  Restoring stashed changes..."
  git stash pop || echo "  Warning: could not restore stash automatically"
fi

# Post-merge: auto-fix formatting in the original and run lint
# Merge conflicts or cross-branch diffs can leave format issues
cd "$ORIGINAL_DIR"
if [ -f "package.json" ]; then
  HAS_FORMAT=$(node -e "const p=require('./package.json'); console.log(p.scripts?.['format:fix'] ? 'yes' : 'no')" 2>/dev/null || echo "no")
  HAS_LINT=$(node -e "const p=require('./package.json'); console.log(p.scripts?.lint ? 'yes' : 'no')" 2>/dev/null || echo "no")
  if [ "$HAS_FORMAT" = "yes" ]; then
    echo ""
    echo "[post-merge] Running 'pnpm format:fix' in original..."
    pnpm format:fix 2>&1 || true
    git add -u 2>/dev/null || true
    if ! git diff --cached --quiet 2>/dev/null; then
      git commit -m "fix(format): apply formatter after merge-back" --no-verify
      echo "  Formatter applied and committed."
    fi
  fi
  if [ "$HAS_LINT" = "yes" ]; then
    echo "[post-merge] Running 'pnpm lint'..."
    if ! pnpm lint 2>&1; then
      echo ""
      echo "Warning: lint errors found after merge. Fix before pushing."
    fi
  fi
fi

echo ""

# --- Summary ---

echo "=== Merge Complete ==="
echo ""
echo "Changes merged into branch: $MERGE_BRANCH"
echo "Commits merged: $COMMIT_COUNT"
echo ""
echo "You are now on branch '$MERGE_BRANCH'. Review the changes:"
echo "  git log --oneline main..$MERGE_BRANCH"
echo "  git diff main..$MERGE_BRANCH --stat"
echo ""
echo "Next steps:"
echo "  1. Review the merged changes"
echo "  2. Run /cleanup-copy $FEATURE_NAME to delete the copy"
echo "  3. Run /release-pr to create a PR and tag"
echo ""
echo "Or to undo the merge:"
echo "  git checkout main && git branch -D $MERGE_BRANCH"
echo ""

#!/bin/bash
set -euo pipefail

# =============================================================================
# worktree-finish.sh - Merge a worktree feature branch into main and clean up
# =============================================================================
# Usage: worktree-finish.sh <feature-name> [project-dir]
#
# Brings changes from a git worktree back to main using a native git merge.
# Because the branch is local (no clone involved), no temporary remotes are
# needed — the merge is simpler and cleaner than merge-back.sh.
#
# Arguments:
#   feature-name  Name of the feature (e.g., "auth-refactor")
#   project-dir   Original project directory (default: current directory)
#
# What it does:
#   1. Validates the worktree exists and has committed changes
#   2. Runs checks (tests, lint) in the worktree
#   3. Merges work/<feature-name> into main
#   4. Removes the worktree and deletes the branch
# =============================================================================

FEATURE_NAME="${1:?Error: feature name required. Usage: worktree-finish.sh <feature-name> [project-dir]}"

# Validate feature name: only allow alphanumeric, hyphens, underscores, and dots
if [[ ! "$FEATURE_NAME" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  echo "Error: invalid feature name '$FEATURE_NAME'"
  echo "Only alphanumeric characters, hyphens, underscores, and dots are allowed."
  exit 1
fi

PROJECT_DIR="${2:-$(pwd)}"
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
WORKTREE_PATH="${PROJECT_DIR}/.worktrees/${FEATURE_NAME}"
BRANCH_NAME="work/${FEATURE_NAME}"

# --- Validations ---

if [ ! -d "$PROJECT_DIR/.git" ]; then
  echo "Error: $PROJECT_DIR is not a git repository"
  exit 1
fi

if [ ! -d "$WORKTREE_PATH" ]; then
  echo "Error: worktree not found at $WORKTREE_PATH"
  echo ""
  echo "Active worktrees:"
  git -C "$PROJECT_DIR" worktree list
  exit 1
fi

# Check worktree has no uncommitted changes
cd "$WORKTREE_PATH"
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet HEAD 2>/dev/null; then
  echo "Error: there are uncommitted changes in the worktree at $WORKTREE_PATH"
  echo "Please commit or stash all changes in the worktree before finishing."
  exit 1
fi

# Check there are actual commits on the branch
cd "$PROJECT_DIR"
COMMIT_COUNT=$(git rev-list --count "main..${BRANCH_NAME}" 2>/dev/null || echo "0")
if [ "$COMMIT_COUNT" = "0" ]; then
  echo "Warning: no commits found on top of main in branch $BRANCH_NAME."
  echo "Are you sure there are changes to merge?"
  echo ""
fi

echo "=== Worktree Finish ==="
echo "Worktree: $WORKTREE_PATH"
echo "Branch:   $BRANCH_NAME -> main"
echo "Commits:  $COMMIT_COUNT"
echo ""

# --- Phase 1: Pre-merge checks in the worktree ---

echo "[1/4] Running pre-merge checks in worktree..."
cd "$WORKTREE_PATH"

detect_pkg_manager() {
  if [ -f "pnpm-lock.yaml" ]; then echo "pnpm"
  elif [ -f "yarn.lock" ]; then echo "yarn"
  elif [ -f "package-lock.json" ]; then echo "npm"
  elif [ -f "package.json" ]; then echo "npm"
  else echo ""
  fi
}

if [ -f "package.json" ]; then
  PKG_MGR=$(detect_pkg_manager)

  # Returns 0 if the script exists in package.json, 1 otherwise
  has_script() {
    node --input-type=commonjs \
      -e "try{const p=require('./package.json');process.exit(p.scripts&&p.scripts['$1']?0:1);}catch(e){process.exit(1);}" \
      2>/dev/null
  }

  if has_script "check"; then
    # `check` is treated as a superset (lint + typecheck + test)
    echo "  Running $PKG_MGR run check (lint + typecheck + test)..."
    if ! "$PKG_MGR" run check 2>&1; then
      echo ""
      echo "Error: check failed in the worktree. Fix issues before finishing."
      exit 1
    fi
    echo "  check passed."
  else
    FOUND_SCRIPTS=0
    CHECKS_FAILED=0

    if has_script "lint"; then
      FOUND_SCRIPTS=$((FOUND_SCRIPTS + 1))
      echo "  Running $PKG_MGR run lint..."
      if ! "$PKG_MGR" run lint 2>&1; then
        echo "  lint failed."
        CHECKS_FAILED=$((CHECKS_FAILED + 1))
      else
        echo "  lint passed."
      fi
    fi

    TYPECHECK_SCRIPT=""
    if has_script "typecheck"; then
      TYPECHECK_SCRIPT="typecheck"
    elif has_script "type-check"; then
      TYPECHECK_SCRIPT="type-check"
    fi
    if [ -n "$TYPECHECK_SCRIPT" ]; then
      FOUND_SCRIPTS=$((FOUND_SCRIPTS + 1))
      echo "  Running $PKG_MGR run $TYPECHECK_SCRIPT..."
      if ! "$PKG_MGR" run "$TYPECHECK_SCRIPT" 2>&1; then
        echo "  $TYPECHECK_SCRIPT failed."
        CHECKS_FAILED=$((CHECKS_FAILED + 1))
      else
        echo "  $TYPECHECK_SCRIPT passed."
      fi
    fi

    if has_script "test"; then
      FOUND_SCRIPTS=$((FOUND_SCRIPTS + 1))
      echo "  Running $PKG_MGR test..."
      if ! "$PKG_MGR" test 2>&1; then
        echo "  test failed."
        CHECKS_FAILED=$((CHECKS_FAILED + 1))
      else
        echo "  test passed."
      fi
    fi

    if [ "$FOUND_SCRIPTS" -eq 0 ]; then
      echo "  No check/lint/typecheck/test scripts found, skipping."
    fi

    if [ "$CHECKS_FAILED" -gt 0 ]; then
      echo ""
      echo "Error: $CHECKS_FAILED check(s) failed in the worktree. Fix issues before finishing."
      exit 1
    fi
  fi
elif [ -f "Cargo.toml" ]; then
  echo "  Running cargo test..."
  if ! cargo test 2>&1; then
    echo ""
    echo "Error: tests failed. Fix issues before finishing."
    exit 1
  fi
  echo "  Tests passed."
elif [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
  echo "  Running pytest..."
  if ! pytest 2>&1; then
    echo ""
    echo "Error: tests failed. Fix issues before finishing."
    exit 1
  fi
  echo "  Tests passed."
else
  echo "  No test runner detected, skipping."
fi
echo ""

# --- Phase 2: Prepare main branch ---

cd "$PROJECT_DIR"

echo "[2/4] Preparing main branch..."
STASHED=false

if ! git diff --quiet HEAD 2>/dev/null; then
  echo "  Uncommitted changes detected — stashing..."
  git stash push -m "auto-stash before worktree-finish ${FEATURE_NAME}"
  STASHED=true
fi

cleanup_stash() {
  if [ "$STASHED" = "true" ]; then
    cd "$PROJECT_DIR" 2>/dev/null || true
    git stash pop 2>/dev/null || true
  fi
}
trap cleanup_stash EXIT

CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "  Switching to main..."
  git checkout main
fi
echo ""

# --- Phase 3: Merge ---

echo "[3/4] Merging $BRANCH_NAME into main..."
if ! git merge "$BRANCH_NAME" --no-edit -m "feat: merge ${FEATURE_NAME} from worktree"; then
  echo ""
  echo "=== MERGE CONFLICT ==="
  echo "Please resolve conflicts manually:"
  echo "  1. Fix conflicts in the files listed above"
  echo "  2. Run: git add . && git commit"
  echo "  3. Then clean up:"
  echo "     git worktree remove .worktrees/${FEATURE_NAME} --force"
  echo "     git branch -d ${BRANCH_NAME}"
  echo ""
  echo "To abort the merge entirely:"
  echo "  git merge --abort"
  exit 1
fi
echo ""

# --- Phase 4: Remove worktree and branch ---

echo "[4/4] Cleaning up worktree..."
git worktree remove "$WORKTREE_PATH" --force
git branch -d "$BRANCH_NAME"
echo "  Worktree removed: $WORKTREE_PATH"
echo "  Branch deleted:   $BRANCH_NAME"

# Remove .worktrees dir if now empty
WORKTREES_DIR="${PROJECT_DIR}/.worktrees"
if [ -d "$WORKTREES_DIR" ] && [ -z "$(ls -A "$WORKTREES_DIR")" ]; then
  rmdir "$WORKTREES_DIR"
  echo "  .worktrees/ cleaned up (was empty)"
fi
echo ""

# --- Summary ---

echo "=== Finish Complete ==="
echo ""
echo "Merged into: main"
echo "Commits:     $COMMIT_COUNT"
echo ""
echo "Review:"
echo "  git log --oneline ORIG_HEAD..HEAD"
echo "  git diff ORIG_HEAD..HEAD --stat"
echo ""
echo "To undo the merge:"
echo "  git reset --hard ORIG_HEAD"
echo ""
echo "Next steps:"
echo "  1. Run /release-pr to create a release"
echo ""

# Show remaining worktrees if any
REMAINING=$(git worktree list | grep -c "\.worktrees/" 2>/dev/null || echo "0")
if [ "$REMAINING" -gt "0" ]; then
  echo "Active worktrees still running:"
  git worktree list | grep "\.worktrees/" || true
  echo ""
fi

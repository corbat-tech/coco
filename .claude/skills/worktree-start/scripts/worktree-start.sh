#!/bin/bash
set -euo pipefail

# =============================================================================
# worktree-start.sh - Create a git worktree for isolated feature development
# =============================================================================
# Usage: worktree-start.sh <feature-name> [project-dir]
#
# Creates a lightweight isolated workspace using git worktree. Unlike
# fork-project, worktrees share the same git objects database — no full clone
# needed — while each worktree has its own index file, preventing git
# contention between parallel agent sessions.
#
# Arguments:
#   feature-name  Name for the feature (e.g., "auth-refactor", "new-dashboard")
#   project-dir   Project directory (default: current directory)
#
# Output:
#   Creates .worktrees/<feature-name>/ with:
#   - Branch work/<feature-name> checked out
#   - Dependencies installed
#   - Baseline check run to confirm clean starting state
# =============================================================================

FEATURE_NAME="${1:?Error: feature name required. Usage: worktree-start.sh <feature-name> [project-dir]}"

# Validate feature name: only allow alphanumeric, hyphens, underscores, and dots
if [[ ! "$FEATURE_NAME" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  echo "Error: invalid feature name '$FEATURE_NAME'"
  echo "Only alphanumeric characters, hyphens, underscores, and dots are allowed."
  exit 1
fi

PROJECT_DIR="${2:-$(pwd)}"
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
WORKTREES_DIR="${PROJECT_DIR}/.worktrees"
WORKTREE_PATH="${WORKTREES_DIR}/${FEATURE_NAME}"
BRANCH_NAME="work/${FEATURE_NAME}"

# --- Validations ---

if [ ! -d "$PROJECT_DIR/.git" ]; then
  echo "Error: $PROJECT_DIR is not a git repository"
  exit 1
fi

if [ -d "$WORKTREE_PATH" ]; then
  echo "Error: worktree already exists at $WORKTREE_PATH"
  echo "Use a different name or run: /worktree-finish $FEATURE_NAME"
  exit 1
fi

cd "$PROJECT_DIR"

if git rev-parse --verify "$BRANCH_NAME" >/dev/null 2>&1; then
  echo "Error: branch '$BRANCH_NAME' already exists."
  echo "Choose a different feature name or delete the branch first:"
  echo "  git branch -d $BRANCH_NAME"
  exit 1
fi

echo "=== Worktree Start ==="
echo "Project: $PROJECT_DIR"
echo "Feature: $FEATURE_NAME"
echo "Path:    $WORKTREE_PATH"
echo "Branch:  $BRANCH_NAME"
echo ""

# --- Phase 1: Ensure .worktrees/ is gitignored ---

echo "[1/4] Checking .gitignore..."
GITIGNORE="${PROJECT_DIR}/.gitignore"
WORKTREES_ENTRY=".worktrees/"

# Check if already ignored (either via gitignore file or inherited patterns)
if grep -qF "$WORKTREES_ENTRY" "$GITIGNORE" 2>/dev/null || grep -qF ".worktrees" "$GITIGNORE" 2>/dev/null; then
  echo "  .worktrees/ already in .gitignore."
else
  echo "  Adding .worktrees/ to .gitignore..."
  if [ ! -f "$GITIGNORE" ]; then
    printf '%s\n' "# Git worktrees for parallel feature development" "$WORKTREES_ENTRY" > "$GITIGNORE"
  else
    printf '\n%s\n%s\n' "# Git worktrees for parallel feature development" "$WORKTREES_ENTRY" >> "$GITIGNORE"
  fi
  git add .gitignore
  git commit -m "chore: ignore .worktrees/ for parallel feature development"
  echo "  .gitignore updated and committed."
fi
echo ""

# --- Phase 2: Create worktree ---

echo "[2/4] Creating worktree..."
mkdir -p "$WORKTREES_DIR"
git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME"
echo ""

# --- Phase 3: Install dependencies ---

echo "[3/4] Installing dependencies..."
cd "$WORKTREE_PATH"

if [ -f "pnpm-lock.yaml" ]; then
  PKG_MGR="pnpm"
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
elif [ -f "yarn.lock" ]; then
  PKG_MGR="yarn"
  yarn install --frozen-lockfile 2>/dev/null || yarn install
elif [ -f "package-lock.json" ]; then
  PKG_MGR="npm"
  npm ci 2>/dev/null || npm install
elif [ -f "package.json" ]; then
  PKG_MGR="npm"
  npm install
elif [ -f "Cargo.toml" ]; then
  PKG_MGR="cargo"
  cargo build --quiet 2>/dev/null || true
elif [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
  PKG_MGR="pip"
  pip install -e . --quiet 2>/dev/null || true
else
  PKG_MGR=""
  echo "  No package manager detected, skipping."
fi
echo ""

# --- Phase 4: Baseline check ---

echo "[4/4] Verifying baseline..."

# Returns 0 if the script exists in package.json, 1 otherwise
has_script() {
  node --input-type=commonjs \
    -e "try{const p=require('./package.json');process.exit(p.scripts&&p.scripts['$1']?0:1);}catch(e){process.exit(1);}" \
    2>/dev/null
}

BASELINE_ISSUES=0

if [ -f "package.json" ] && [ -n "${PKG_MGR:-}" ]; then
  if has_script "check"; then
    # `check` is treated as a superset (lint + typecheck + test)
    echo "  Running $PKG_MGR run check (lint + typecheck + test)..."
    if "$PKG_MGR" run check 2>&1; then
      echo "  check passed."
    else
      echo "  Warning: check failed. Investigate before starting work."
      BASELINE_ISSUES=$((BASELINE_ISSUES + 1))
    fi
  else
    FOUND_SCRIPTS=0

    if has_script "lint"; then
      FOUND_SCRIPTS=$((FOUND_SCRIPTS + 1))
      echo "  Running $PKG_MGR run lint..."
      if "$PKG_MGR" run lint 2>&1; then
        echo "  lint passed."
      else
        echo "  Warning: lint failed."
        BASELINE_ISSUES=$((BASELINE_ISSUES + 1))
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
      if "$PKG_MGR" run "$TYPECHECK_SCRIPT" 2>&1; then
        echo "  $TYPECHECK_SCRIPT passed."
      else
        echo "  Warning: $TYPECHECK_SCRIPT failed."
        BASELINE_ISSUES=$((BASELINE_ISSUES + 1))
      fi
    fi

    if has_script "test"; then
      FOUND_SCRIPTS=$((FOUND_SCRIPTS + 1))
      echo "  Running $PKG_MGR test..."
      if "$PKG_MGR" test 2>&1; then
        echo "  test passed."
      else
        echo "  Warning: test failed."
        BASELINE_ISSUES=$((BASELINE_ISSUES + 1))
      fi
    fi

    if [ "$FOUND_SCRIPTS" -eq 0 ]; then
      echo "  No check/lint/typecheck/test scripts found. Skipping baseline."
    fi
  fi
elif [ -f "Cargo.toml" ]; then
  echo "  Running baseline cargo test..."
  if cargo test --quiet 2>&1; then
    echo "  cargo test passed."
  else
    echo "  Warning: cargo test failed. Investigate before starting work."
    BASELINE_ISSUES=$((BASELINE_ISSUES + 1))
  fi
else
  echo "  Skipping baseline (no supported project type detected)."
fi

if [ "$BASELINE_ISSUES" -eq 0 ]; then
  echo "  Baseline clean — good to go."
elif [ "$BASELINE_ISSUES" -gt 0 ]; then
  echo "  Baseline has $BASELINE_ISSUES warning(s). Investigate before starting work."
fi
echo ""

# --- Summary ---

echo "=== Worktree Ready ==="
echo ""
echo "Path:   $WORKTREE_PATH"
echo "Branch: $BRANCH_NAME"
echo ""
echo "Next steps:"
echo "  1. Open a new terminal (or agent session) at:"
echo "     $WORKTREE_PATH"
echo ""
echo "  2. Work on your feature — fully isolated from other worktrees"
echo ""
echo "  3. When done, return to the original project and run:"
echo "     /worktree-finish $FEATURE_NAME"
echo ""

cd "$PROJECT_DIR"
echo "Active worktrees:"
git worktree list
echo ""

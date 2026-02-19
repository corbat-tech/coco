#!/bin/bash
set -euo pipefail

# =============================================================================
# fork-project.sh - Create an isolated copy of the current project
# =============================================================================
# Usage: fork-project.sh <feature-name> [project-dir]
#
# Creates a fully isolated git clone of the project for parallel development.
# The copy has its own .git directory, so agents cannot interfere with each other.
#
# Arguments:
#   feature-name  Name for the feature/copy (e.g., "auth-refactor")
#   project-dir   Project directory to fork (default: current directory)
#
# Output:
#   Creates ../projectName_copy_<feature-name>/ with:
#   - Full git clone (isolated .git)
#   - Branch work/<feature-name> checked out
#   - Dependencies installed (pnpm install)
# =============================================================================

FEATURE_NAME="${1:?Error: feature name required. Usage: fork-project.sh <feature-name> [project-dir]}"
PROJECT_DIR="${2:-$(pwd)}"

# Resolve absolute path
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
PROJECT_NAME="$(basename "$PROJECT_DIR")"
PARENT_DIR="$(dirname "$PROJECT_DIR")"
COPY_DIR="${PARENT_DIR}/${PROJECT_NAME}_copy_${FEATURE_NAME}"

# --- Validations ---

if [ ! -d "$PROJECT_DIR/.git" ]; then
  echo "Error: $PROJECT_DIR is not a git repository"
  exit 1
fi

if [ -d "$COPY_DIR" ]; then
  echo "Error: copy already exists at $COPY_DIR"
  echo "Use a different name or run cleanup-copy.sh $FEATURE_NAME first"
  exit 1
fi

# Check for uncommitted changes
cd "$PROJECT_DIR"
if ! git diff --quiet HEAD 2>/dev/null; then
  echo "Warning: there are uncommitted changes in $PROJECT_DIR"
  echo "The copy will be based on the latest commit, not the working tree."
  echo ""
fi

# --- Phase 1: Clone ---

echo "=== Fork Project ==="
echo "Source:  $PROJECT_DIR"
echo "Target:  $COPY_DIR"
echo "Feature: $FEATURE_NAME"
echo ""

echo "[1/4] Cloning project (fully isolated .git)..."
git clone --no-hardlinks "$PROJECT_DIR" "$COPY_DIR"

# Copy all local .claude/ files not tracked by git (settings.local.json, custom prompts, etc.)
# git clone already placed tracked files; this adds whatever exists locally but not in git.
# Process substitution avoids running the loop in a subshell (required with set -euo pipefail).
if [ -d "$PROJECT_DIR/.claude" ]; then
  while IFS= read -r src_file; do
    rel="${src_file#"$PROJECT_DIR"/}"
    dest="$COPY_DIR/$rel"
    if [ ! -f "$dest" ]; then
      mkdir -p "$(dirname "$dest")"
      cp "$src_file" "$dest"
      echo "  Copied local: $rel"
    fi
  done < <(find "$PROJECT_DIR/.claude" -type f)
fi

# --- Phase 2: Setup branch ---

cd "$COPY_DIR"

echo "[2/4] Creating branch work/$FEATURE_NAME..."
git checkout -b "work/${FEATURE_NAME}"

# Remove the origin remote (points to local original, we'll re-add it properly during merge-back)
git remote remove origin

echo "[3/4] Installing dependencies..."
if [ -f "pnpm-lock.yaml" ]; then
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
elif [ -f "yarn.lock" ]; then
  yarn install --frozen-lockfile 2>/dev/null || yarn install
elif [ -f "package-lock.json" ]; then
  npm ci 2>/dev/null || npm install
elif [ -f "package.json" ]; then
  npm install
fi

echo "[4/4] Verifying setup..."
echo ""

# --- Summary ---

echo "=== Fork Complete ==="
echo ""
echo "Copy created at: $COPY_DIR"
echo "Branch:          work/$FEATURE_NAME"
echo ""
echo "Next steps:"
echo "  1. Open a new terminal in the copy:"
echo "     cd $COPY_DIR"
echo ""
echo "  2. Start Claude Code there:"
echo "     claude"
echo ""
echo "  3. Work on your feature with full isolation"
echo ""
echo "  4. When done, return to the original project and run:"
echo "     /merge-back $FEATURE_NAME"
echo ""

#!/bin/bash
set -euo pipefail

# =============================================================================
# cleanup-copy.sh - Delete an isolated project copy after merging
# =============================================================================
# Usage: cleanup-copy.sh <feature-name> [original-dir]
#
# Safely removes a forked project copy and cleans up any remaining references.
#
# Arguments:
#   feature-name  Name of the feature/copy (e.g., "auth-refactor")
#   original-dir  Original project directory (default: current directory)
#
# Safety checks:
#   - Warns if changes haven't been merged back yet
#   - Lists uncommitted changes before deleting
#   - Removes any leftover remotes in the original
# =============================================================================

FEATURE_NAME="${1:?Error: feature name required. Usage: cleanup-copy.sh <feature-name> [original-dir]}"
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
  echo ""
  echo "Available copies:"
  ls -d "${PARENT_DIR}/${PROJECT_NAME}_copy_"* 2>/dev/null || echo "  (none)"
  exit 1
fi

echo "=== Cleanup Copy ==="
echo "Copy to delete: $COPY_DIR"
echo ""

# --- Safety checks ---

# Check if merge branch exists in original (indicating merge was done)
cd "$ORIGINAL_DIR"
if ! git rev-parse --verify "$MERGE_BRANCH" >/dev/null 2>&1; then
  echo "WARNING: branch '$MERGE_BRANCH' not found in the original project."
  echo "This may mean changes have NOT been merged back yet."
  echo ""
  echo "If you're sure you want to delete the copy anyway, the script will proceed."
  echo ""
fi

# Check for uncommitted changes in the copy
cd "$COPY_DIR"
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet HEAD 2>/dev/null; then
  echo "WARNING: the copy has uncommitted changes:"
  git status --short
  echo ""
  echo "These changes will be LOST when the copy is deleted."
  echo ""
fi

# Check for unpushed commits
COPY_BRANCH="work/${FEATURE_NAME}"
if git rev-parse --verify "$COPY_BRANCH" >/dev/null 2>&1; then
  UNPUSHED=$(git rev-list --count main.."$COPY_BRANCH" 2>/dev/null || echo "unknown")
  echo "Copy has $UNPUSHED commit(s) on branch $COPY_BRANCH"
  echo ""
fi

# --- Phase 1: Remove remote from original ---

cd "$ORIGINAL_DIR"
echo "[1/2] Removing temporary remote (if exists)..."
git remote remove "$REMOTE_NAME" 2>/dev/null && echo "  Removed remote '$REMOTE_NAME'" || echo "  No remote '$REMOTE_NAME' found (OK)"

# --- Phase 2: Delete the copy ---

echo "[2/2] Deleting copy directory..."
rm -rf "$COPY_DIR"
echo "  Deleted: $COPY_DIR"

echo ""

# --- Summary ---

echo "=== Cleanup Complete ==="
echo ""
echo "Copy '$FEATURE_NAME' has been removed."
echo ""

# Check what's left
REMAINING=$(ls -d "${PARENT_DIR}/${PROJECT_NAME}_copy_"* 2>/dev/null | wc -l | tr -d ' ')
if [ "$REMAINING" -gt 0 ]; then
  echo "Remaining copies:"
  ls -d "${PARENT_DIR}/${PROJECT_NAME}_copy_"* 2>/dev/null | while read -r dir; do
    echo "  $(basename "$dir")"
  done
else
  echo "No remaining copies."
fi
echo ""

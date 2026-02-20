#!/bin/bash
set -euo pipefail

# =============================================================================
# worktree-list.sh - List active feature worktrees with status
# =============================================================================
# Usage: worktree-list.sh [project-dir]
#
# Shows a summary of all active worktrees in .worktrees/ with:
#   - Branch name
#   - Commits ahead of main
#   - Dirty status (uncommitted files)
#   - Last commit message and timestamp
# =============================================================================

PROJECT_DIR="${1:-$(pwd)}"
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
WORKTREES_DIR="${PROJECT_DIR}/.worktrees"

if [ ! -d "$PROJECT_DIR/.git" ]; then
  echo "Error: $PROJECT_DIR is not a git repository"
  exit 1
fi

# Check if .worktrees/ exists and has entries
if [ ! -d "$WORKTREES_DIR" ] || [ -z "$(ls -A "$WORKTREES_DIR" 2>/dev/null)" ]; then
  echo "No active worktrees in .worktrees/"
  echo ""
  echo "Start one with: /worktree-start <feature-name>"
  exit 0
fi

echo "=== Active Worktrees ==="
echo ""

COUNT=0
for WORKTREE_PATH in "$WORKTREES_DIR"/*/; do
  [ -d "$WORKTREE_PATH/.git" ] || continue

  FEATURE_NAME=$(basename "$WORKTREE_PATH")
  BRANCH=$(git -C "$WORKTREE_PATH" branch --show-current 2>/dev/null || echo "detached")

  # Commits ahead of main
  COMMITS_AHEAD=$(git -C "$WORKTREE_PATH" rev-list --count "main..HEAD" 2>/dev/null || echo "?")

  # Dirty status
  DIRTY_COUNT=$(git -C "$WORKTREE_PATH" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if [ "$DIRTY_COUNT" -eq 0 ]; then
    STATUS="clean"
    STATUS_COLOR=""
  else
    STATUS="${DIRTY_COUNT} uncommitted file(s)"
  fi

  # Last commit
  LAST_COMMIT=$(git -C "$WORKTREE_PATH" log -1 --format="%cr — %s" 2>/dev/null || echo "no commits yet")

  printf "  %-22s  %-30s  +%s commit(s)  %s\n" \
    "$FEATURE_NAME" "$BRANCH" "$COMMITS_AHEAD" "$STATUS"
  printf "  %-22s  Last: %s\n" "" "$LAST_COMMIT"
  echo ""

  COUNT=$((COUNT + 1))
done

if [ "$COUNT" -eq 0 ]; then
  echo "  No valid worktrees found in .worktrees/ (directories without .git are ignored)"
  echo ""
  echo "Start one with: /worktree-start <feature-name>"
  exit 0
fi

echo "${COUNT} active worktree(s)"
echo ""
echo "Commands:"
echo "  /worktree-start <name>   Start a new feature worktree"
echo "  /worktree-finish <name>  Merge and clean up a worktree"
echo ""

# Changelog

All notable changes to the COCO VS Code extension are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] — 2026-02-20

### Added
- Keyboard shortcut `Ctrl+Shift+O` / `Cmd+Shift+O` to open COCO
- Editor title bar button for quick access
- `coco.newSession` command available in Command Palette
- `galleryBanner` dark theme for Marketplace listing
- `qna` link pointing to GitHub Discussions

### Changed
- Updated to coco CLI v2.1.0 (REPL with `/mcp`, `/intent`, parallel startup)
- Improved `coco.cliPath` setting with markdown description and examples
- Extension icon refined for better dark/light theme contrast

### Fixed
- Terminal reuse logic now correctly detects closed terminals on all platforms

## [2.0.0] — 2025-12-01

### Added
- Initial VS Code extension release
- Terminal-first UX: runs `coco` CLI inside a dedicated VS Code terminal panel
- Status bar item `$(robot) COCO` — click to open, persists across sessions
- `coco.open` command: opens or focuses the COCO terminal
- `coco.newSession` command: destroys current session and starts a fresh one
- `coco.cliPath` configuration setting for non-standard binary locations
- Automatic workspace folder detection — passes `-p <path>` to CLI
- Terminal lifecycle management — reference cleared on terminal close

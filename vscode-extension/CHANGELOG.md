# Changelog

## [2.42.1] - 2026-10-28

- Upgrade packaging to VSCE 4, esbuild 0.28 and TypeScript 6; refresh the independent lockfile.
- Declare Node types explicitly and pin VS Code API declarations to the supported editor minimum.
- Use pnpm 12 with an independent workspace and verify packaging and Extension Host behavior in CI.
- One upstream MSAL advisory remains in development-only VSCE dependencies; it is not bundled into the VSIX.

## 2.42.0

- Start the CLI through an executable and argument array; no shell-interpolated command text.
- Respect Workspace Trust, choose the active workspace root and own one transient terminal per project.
- Handle missing executables, manual terminal close, new sessions and extension deactivation.
- Verify actual terminal launches in VS Code Extension Host and publish a verified VSIX on GitHub.
- Clarify quality evidence and platform limits; Windows command wrappers remain unsupported.


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

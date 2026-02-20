/**
 * COCO VSCode Extension — Terminal Mode
 *
 * Opens a dedicated terminal panel and runs `coco` inside it,
 * mirroring the Claude Code UX: the agent lives in the terminal,
 * not in a custom webview.
 */

import * as vscode from "vscode";

/** Persistent terminal reference (reused across open calls) */
let cocoTerminal: vscode.Terminal | undefined;

/** Status bar item shown in the bottom bar */
let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // Status bar item — bottom-left, clickable to open COCO
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text = "$(robot) COCO";
  statusBarItem.tooltip = "Open COCO Agent";
  statusBarItem.command = "coco.open";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Command: open (or focus) the COCO terminal
  context.subscriptions.push(
    vscode.commands.registerCommand("coco.open", () => {
      openCocoTerminal(context);
    }),
  );

  // Command: destroy current terminal and start a fresh session
  context.subscriptions.push(
    vscode.commands.registerCommand("coco.newSession", () => {
      if (cocoTerminal) {
        cocoTerminal.dispose();
        cocoTerminal = undefined;
      }
      openCocoTerminal(context);
    }),
  );

  // Detect terminal close to reset internal reference
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      if (terminal === cocoTerminal) {
        cocoTerminal = undefined;
      }
    }),
  );
}

export function deactivate(): void {
  cocoTerminal = undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openCocoTerminal(context: vscode.ExtensionContext): void {
  // Reuse existing terminal if it is still alive
  if (cocoTerminal) {
    cocoTerminal.show(false); // false = do not steal focus from editor
    return;
  }

  const workspaceFolder = getWorkspaceFolder();
  const cliPath = getCliPath();

  cocoTerminal = vscode.window.createTerminal({
    name: "COCO",
    iconPath: new vscode.ThemeIcon("robot"),
    cwd: workspaceFolder,
  });

  cocoTerminal.show(false);

  // Launch coco with an explicit project path for precision
  const cmd = workspaceFolder
    ? `${cliPath} -p "${workspaceFolder}"`
    : cliPath;

  cocoTerminal.sendText(cmd);
}

/** First workspace folder path, or undefined when no folder is open */
function getWorkspaceFolder(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Reads coco.cliPath from settings, falling back to "coco" on $PATH */
function getCliPath(): string {
  return vscode.workspace.getConfiguration("coco").get<string>("cliPath") ?? "coco";
}

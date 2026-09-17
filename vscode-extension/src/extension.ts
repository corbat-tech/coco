/** Terminal host: explicit executable/argv, project-scoped terminals and user trust. */
import * as vscode from "vscode";
import { resolveExecutable } from "./launch";

const terminals = new Map<string, vscode.Terminal>();
let opening: Promise<void> | undefined;
let generation = 0;
let active = false;

export function activate(context: vscode.ExtensionContext): void {
  active = true;
  const activation = ++generation;
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("coco.welcome", {
      getTreeItem: (item: vscode.TreeItem) => item,
      getChildren: () => [],
    }),
  );
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = "$(robot) COCO";
  status.tooltip = "Open COCO Agent";
  status.command = "coco.open";
  status.show();
  context.subscriptions.push(status);
  const open = (fresh: boolean) => {
    if (opening) return opening;
    opening = openCocoTerminal(fresh, activation)
      .catch((error: unknown) => {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (activation === generation) opening = undefined;
      });
    return opening;
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("coco.open", () => open(false)),
    vscode.commands.registerCommand("coco.newSession", () => open(true)),
    vscode.window.onDidCloseTerminal((terminal) => {
      for (const [key, owned] of terminals) if (owned === terminal) terminals.delete(key);
    }),
  );
}

export function deactivate(): void {
  active = false;
  generation++;
  opening = undefined;
  for (const terminal of terminals.values()) terminal.dispose();
  terminals.clear();
}

async function openCocoTerminal(fresh: boolean, activation: number): Promise<void> {
  if (!active || activation !== generation) return;
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage("Trust this workspace before running COCO.");
    return;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  const activeDocument = vscode.window.activeTextEditor?.document.uri;
  const folder =
    (activeDocument && vscode.workspace.getWorkspaceFolder(activeDocument)) ||
    (folders.length === 1
      ? folders[0]
      : await vscode.window.showWorkspaceFolderPick({
          placeHolder: "Choose the project for COCO",
        }));
  if (!folder || !active || activation !== generation) return;
  if (folder.uri.scheme !== "file")
    throw new Error("COCO requires a filesystem workspace on the extension host.");
  const key = folder.uri.toString();
  const existing = terminals.get(key);
  if (existing && existing.exitStatus === undefined && !fresh) {
    existing.show(false);
    return;
  }
  const executable = await resolveExecutable(
    vscode.workspace.getConfiguration("coco").get<string>("cliPath") ?? "coco",
  );
  if (
    !active ||
    activation !== generation ||
    !vscode.workspace.isTrusted ||
    !vscode.workspace.workspaceFolders?.some((current) => current.uri.toString() === key)
  )
    return;
  if (existing) existing.dispose();
  const terminal = vscode.window.createTerminal({
    name: `COCO — ${folder.name}`,
    iconPath: new vscode.ThemeIcon("robot"),
    cwd: folder.uri,
    shellPath: executable,
    shellArgs: ["-p", folder.uri.fsPath],
    isTransient: true,
  });
  terminals.set(key, terminal);
  terminal.show(false);
}

/** Deterministic lifecycle/trust checks; actual terminal behavior is tested by test:host. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
const requireNative = createRequire(import.meta.url);
const source = await readFile(new URL("../dist/extension.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(manifest.capabilities.untrustedWorkspaces.supported, false);
assert.equal(manifest.contributes.configuration.properties["coco.cliPath"].scope, "machine");
const commands = new Map();
let starts = 0;
let pick;
const disposable = { dispose() {} };
const vscode = {
  workspace: {
    isTrusted: false,
    workspaceFolders: [],
    getWorkspaceFolder() {},
    getConfiguration() {
      return {
        get() {
          return "coco";
        },
      };
    },
  },
  StatusBarAlignment: { Left: 1 },
  window: {
    registerTreeDataProvider() {
      return disposable;
    },
    createStatusBarItem() {
      return { show() {}, dispose() {} };
    },
    onDidCloseTerminal() {
      return disposable;
    },
    showWarningMessage: async () => {},
    showErrorMessage: async () => {},
    showWorkspaceFolderPick: () =>
      new Promise((resolve) => {
        pick = resolve;
      }),
    createTerminal() {
      starts++;
      throw new Error("Unexpected terminal");
    },
  },
  commands: {
    registerCommand(name, fn) {
      commands.set(name, fn);
      return disposable;
    },
  },
};
const module = { exports: {} };
vm.runInNewContext(source, {
  module,
  exports: module.exports,
  require: (name) => (name === "vscode" ? vscode : requireNative(name)),
  process,
  console,
  setTimeout,
  clearTimeout,
});
const context = { subscriptions: [] };
module.exports.activate(context);
await commands.get("coco.open")();
assert.equal(starts, 0, "untrusted workspace must not start a terminal");
vscode.workspace.isTrusted = true;
const pending = commands.get("coco.open")();
module.exports.deactivate();
pick({ uri: { scheme: "file", fsPath: "/tmp", toString: () => "file:///tmp" }, name: "fixture" });
await pending;
assert.equal(starts, 0, "late workspace picker cannot resurrect a deactivated extension");
console.log("COCO extension contract: trust refusal, machine-only executable, no late launch PASS");

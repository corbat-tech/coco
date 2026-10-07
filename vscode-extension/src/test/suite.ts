import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { resolveExecutable } from "../launch";

async function waitFor(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Runs in a real Extension Host with an isolated user profile and synthetic workspaces. */
export async function run(): Promise<void> {
  const root = process.env.COCO_EXTENSION_TEST_ROOT!;
  const binary = join(root, "fake coco");
  const record = join(root, "argv.jsonl");
  const folders = vscode.workspace.workspaceFolders!;
  assert.equal(folders.length, 2);
  await assert.rejects(resolveExecutable("coco --inject"));
  await assert.rejects(resolveExecutable(join(root, "missing-coco")));
  await writeFile(
    binary,
    `#!${process.env.COCO_EXTENSION_TEST_NODE}\nrequire('node:fs').appendFileSync(${JSON.stringify(record)},JSON.stringify(process.argv.slice(2))+'\\n');setInterval(()=>{},1000);\n`,
    { mode: 0o755 },
  );
  assert.equal(await resolveExecutable(binary), binary);
  await vscode.workspace
    .getConfiguration("coco")
    .update("cliPath", binary, vscode.ConfigurationTarget.Global);
  const extension = vscode.extensions.getExtension("corbat-tech.corbat-coco");
  assert.ok(extension);
  await extension.activate();
  const note = join(folders[1]!.uri.fsPath, "note.txt");
  await writeFile(note, "synthetic project");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(note));
  const records = async (): Promise<string[][]> => {
    try {
      return (await readFile(record, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  };
  try {
    await vscode.commands.executeCommand("coco.open");
    await waitFor(async () => (await records()).length === 1, "first process");
    assert.deepEqual((await records())[0], ["-p", folders[1]!.uri.fsPath]);
    const original = vscode.window.terminals.find((terminal) => terminal.name.startsWith("COCO"))!;
    assert.ok(original);
    assert.equal((original.creationOptions as vscode.TerminalOptions).shellPath, binary);
    await vscode.commands.executeCommand("coco.open");
    assert.equal(vscode.window.terminals.filter((t) => t.name.startsWith("COCO")).length, 1);
    await vscode.commands.executeCommand("coco.newSession");
    await waitFor(async () => (await records()).length === 2, "fresh session");
    await waitFor(async () => !vscode.window.terminals.includes(original), "old terminal disposed");
    const current = vscode.window.terminals.find((terminal) => terminal.name.startsWith("COCO"))!;
    current.dispose();
    await waitFor(async () => !vscode.window.terminals.includes(current), "manual close");
    await vscode.commands.executeCommand("coco.open");
    await waitFor(async () => (await records()).length === 3, "reopen after close");
    const firstNote = join(folders[0]!.uri.fsPath, "note.txt");
    await writeFile(firstNote, "other project");
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(firstNote));
    await vscode.commands.executeCommand("coco.open");
    await waitFor(async () => (await records()).length === 4, "second root process");
    assert.deepEqual((await records())[3], ["-p", folders[0]!.uri.fsPath]);
    assert.equal(vscode.window.terminals.filter((t) => t.name.startsWith("COCO")).length, 2);
    await assert.rejects(access(join(root, "INJECTED")));
    for (const folder of folders) await assert.rejects(access(join(folder.uri.fsPath, "INJECTED")));
    console.log(
      "COCO Extension Host: executable argv, special paths, multiroot, reuse, new session, close and missing executable PASS",
    );
  } finally {
    for (const terminal of vscode.window.terminals.filter((t) => t.name.startsWith("COCO")))
      terminal.dispose();
  }
}

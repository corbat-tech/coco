import { runTests } from "@vscode/test-electron";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const root = await mkdtemp(
  path.join(process.platform === "darwin" ? "/tmp" : tmpdir(), "coco-vsc-"),
);
const extension = path.resolve(import.meta.dirname, "..");
const first = path.join(root, "project one");
const second = path.join(root, 'project $(touch INJECTED); "quoted"');
await mkdir(first);
await mkdir(second);
const workspace = path.join(root, "fixture.code-workspace");
await writeFile(workspace, JSON.stringify({ folders: [{ path: first }, { path: second }] }));
try {
  const profile = path.join(root, "profile");
  await mkdir(path.join(profile, "User"), { recursive: true });
  await writeFile(
    path.join(profile, "User/settings.json"),
    JSON.stringify({
      "security.workspace.trust.startupPrompt": "never",
      "security.workspace.trust.banner": "never",
      "update.mode": "none",
      "telemetry.telemetryLevel": "off",
    }),
  );
  await runTests({
    version: "1.137.0",
    ...(process.env.COCO_VSCODE_EXECUTABLE
      ? { vscodeExecutablePath: process.env.COCO_VSCODE_EXECUTABLE }
      : {}),
    extensionDevelopmentPath: extension,
    extensionTestsPath: path.join(extension, ".test-dist/test/suite.js"),
    extensionTestsEnv: {
      COCO_EXTENSION_TEST_ROOT: root,
      COCO_EXTENSION_TEST_NODE: process.execPath,
    },
    launchArgs: [
      workspace,
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-extensions",
      "--no-sandbox",
      "--user-data-dir",
      profile,
      "--extensions-dir",
      path.join(root, "extensions"),
    ],
  });
} finally {
  await rm(root, { recursive: true, force: true });
}

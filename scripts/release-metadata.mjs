#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const tag = process.argv[2] ?? "";
const extension = tag.startsWith("vscode-v");
const prefix = extension ? "vscode-v" : "v";
const version = tag.slice(prefix.length);
if (!tag.startsWith(prefix) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Expected v<version> or vscode-v<version> release tag");
}
if (extension && version.includes("-")) {
  throw new Error("VSIX prereleases require a separate validated release policy");
}
const metadata = JSON.parse(
  await readFile(extension ? "vscode-extension/package.json" : "package.json", "utf8"),
);
if (metadata.version !== version) throw new Error("Release tag does not match package version");
if (metadata.name !== (extension ? "corbat-coco" : "@corbat-tech/coco")) {
  throw new Error("Unexpected package identity");
}
console.log(`version=${version}`);
console.log(`channel=${version.includes("-") ? "next" : "latest"}`);

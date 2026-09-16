#!/usr/bin/env node
/** Linux release workflow: reconcile immutable versions before publishing. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const npm = (args) => spawnSync("npm", args, { encoding: "utf8", shell: false });

export async function publishNpm(artifactDir, channel, run = npm) {
  if (!["next", "latest"].includes(channel)) throw new Error("Unsupported dist-tag");
  const [packed] = JSON.parse(await readFile(path.join(artifactDir, "pack.json"), "utf8"));
  if (packed.name !== "@corbat-tech/coco" || path.basename(packed.filename) !== packed.filename) {
    throw new Error("Unexpected artifact identity/path");
  }
  const archive = path.resolve(artifactDir, packed.filename);
  const integrity =
    "sha512-" +
    createHash("sha512")
      .update(await readFile(archive))
      .digest("base64");
  if (integrity !== packed.integrity) throw new Error("Artifact changed after packing");
  const query = run(["view", `${packed.name}@${packed.version}`, "dist.integrity", "--json"]);
  if (query.error || query.signal) throw new Error("Registry state unknown; publication stopped");
  if (query.status === 0) {
    if (JSON.parse(query.stdout) !== integrity)
      throw new Error("Version already exists with different integrity");
    console.log(
      "Identical version already published; continuing verification without republishing.",
    );
    return "already-published";
  }
  let code;
  try {
    code = JSON.parse(query.stdout).error?.code;
  } catch {
    // An unparseable response is not evidence that the version is absent.
  }
  if (code !== "E404") throw new Error("Registry lookup failed; publication stopped");
  const result = run([
    "publish",
    archive,
    "--ignore-scripts",
    "--access",
    "public",
    "--tag",
    channel,
  ]);
  if (result.error || result.signal || result.status !== 0) {
    throw new Error("Publication failed or outcome uncertain; reconcile registry before retrying");
  }
  console.log("Published verified tarball; registry verification is still required.");
  return "published";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await publishNpm(process.argv[2] ?? "artifacts", process.argv[3]);
}

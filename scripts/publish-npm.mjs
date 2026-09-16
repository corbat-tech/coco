#!/usr/bin/env node
/** Linux release workflow: reconcile immutable versions before publishing. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const npm = (args) => spawnSync("npm", args, { encoding: "utf8", shell: false });

// Never echo npm output: messages may include credentials, URLs or configuration.
const diagnostics = {
  E401: "authentication rejected; renew the npm credential",
  ENEEDAUTH: "authentication required; configure an npm publish credential",
  E403: "publication forbidden; check package permissions and 2FA policy",
  EOTP: "one-time password required; use an approved npm authentication flow",
  EPUBLISHCONFLICT: "immutable version conflict; reconcile registry integrity",
  E404: "registry resource not found; check package identity and access",
  ETIMEDOUT: "registry request timed out",
  ECONNRESET: "registry connection reset",
  ENOTFOUND: "registry DNS lookup failed",
  EAI_AGAIN: "registry DNS temporarily unavailable",
};

function npmCode(result) {
  try {
    const code = JSON.parse(result.stdout).error?.code;
    if (Object.hasOwn(diagnostics, code)) return code;
  } catch {
    // npm versions may report the code on stderr instead of JSON stdout.
  }
  const match = String(result.stderr ?? "").match(
    /(?:npm (?:error|ERR!) code) ([A-Z0-9_]+)(?:\s|$)/,
  );
  return match && Object.hasOwn(diagnostics, match[1]) ? match[1] : undefined;
}

function failure(stage, result) {
  const code = npmCode(result);
  const status = Number.isInteger(result.status) ? result.status : "unavailable";
  return new Error(
    `${stage}: ${code ? `${code}: ${diagnostics[code]}` : "unknown npm failure"} (exit ${status}). Outcome uncertain; reconcile registry before retrying`,
  );
}

function verifyChannel(run, name, version, channel) {
  const tags = run(["view", name, "dist-tags", "--json"]);
  if (tags.error || tags.signal || tags.status !== 0)
    throw failure("Channel verification failed", tags);
  let matches = false;
  try {
    matches = JSON.parse(tags.stdout)?.[channel] === version;
  } catch {
    /* Unknown state. */
  }
  if (!matches)
    throw new Error(
      "Published version does not match requested dist-tag; reconcile manually without changing latest",
    );
}

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
  if (query.error || query.signal)
    throw failure("Registry state unknown; publication stopped", query);
  if (query.status === 0) {
    let publishedIntegrity;
    try {
      publishedIntegrity = JSON.parse(query.stdout);
    } catch {
      throw failure("Registry state unknown; publication stopped", query);
    }
    if (publishedIntegrity !== integrity)
      throw new Error("Version already exists with different integrity");
    verifyChannel(run, packed.name, packed.version, channel);
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
  if (code !== "E404") throw failure("Registry lookup failed; publication stopped", query);
  const auth = run(["whoami", "--json"]);
  if (auth.error || auth.signal || auth.status !== 0)
    throw failure("Authentication preflight failed; no publish attempted", auth);
  const result = run([
    "publish",
    archive,
    "--json",
    "--ignore-scripts",
    "--access",
    "public",
    "--tag",
    channel,
  ]);
  if (result.error || result.signal || result.status !== 0) {
    throw failure("Publication failed", result);
  }
  verifyChannel(run, packed.name, packed.version, channel);
  console.log("Published verified tarball; registry verification is still required.");
  return "published";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await publishNpm(process.argv[2] ?? "artifacts", process.argv[3]);
}

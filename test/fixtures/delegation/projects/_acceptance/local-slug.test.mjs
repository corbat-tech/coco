import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.PROJECT_UNDER_TEST;
if (!root) throw new Error("PROJECT_UNDER_TEST is required");
const load = (name) => import(pathToFileURL(path.join(root, "src", name)).href);
test("local-slug external acceptance", async () => {
  const { slug } = await load("slug.mjs");
  assert.equal(slug("  Alpha   Beta\tGAMMA\nDelta  "), "alpha-beta-gamma-delta");
  assert.equal(slug("\t\n"), "");
  assert.equal(slug("A_B"), "a_b");
});

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.PROJECT_UNDER_TEST;
if (!root) throw new Error("PROJECT_UNDER_TEST is required");
const load = (name) => import(pathToFileURL(path.join(root, "src", name)).href);
test("local-clamp external acceptance", async () => {
  const { clamp } = await load("clamp.mjs");
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(-9, -5, -1), -5);
  assert.equal(clamp(2, 2, 2), 2);
  assert.equal(clamp(4, 0, 10), 4);
  assert.equal(clamp(99, 0, 10), 10);
});

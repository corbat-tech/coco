import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.PROJECT_UNDER_TEST;
if (!root) throw new Error("PROJECT_UNDER_TEST is required");
const load = (name) => import(pathToFileURL(path.join(root, "src", name)).href);
test("parallel-statistics external acceptance", async () => {
  const { mean } = await load("mean.mjs");
  const { maximum } = await load("maximum.mjs");
  assert.equal(mean([]), 0);
  assert.equal(mean([-4, -2]), -3);
  assert.equal(maximum([]), null);
  assert.equal(maximum([-7, -2, -9]), -2);
  assert.equal(maximum([0]), 0);
});

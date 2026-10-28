import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.PROJECT_UNDER_TEST;
if (!root) throw new Error("PROJECT_UNDER_TEST is required");
const load = (name) => import(pathToFileURL(path.join(root, "src", name)).href);
test("local-discount external acceptance", async () => {
  const { discountedTotal } = await load("discount.mjs");
  assert.equal(discountedTotal(100, 0), 100);
  assert.equal(discountedTotal(100, undefined), 90);
  assert.equal(discountedTotal(100, 1), 0);
  assert.equal(discountedTotal(0, 0), 0);
});

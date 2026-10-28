import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.PROJECT_UNDER_TEST;
if (!root) throw new Error("PROJECT_UNDER_TEST is required");
const load = (name) => import(pathToFileURL(path.join(root, "src", name)).href);
test("local-pagination external acceptance", async () => {
  const { paginate } = await load("paginate.mjs");
  const source = [1, 2, 3, 4, 5];
  assert.deepEqual(paginate(source, 1, 2), [1, 2]);
  assert.deepEqual(paginate(source, 2, 2), [3, 4]);
  assert.deepEqual(paginate(source, 3, 2), [5]);
  assert.deepEqual(paginate(source, 4, 2), []);
  assert.deepEqual(source, [1, 2, 3, 4, 5]);
  assert.throws(() => paginate(source, 0, 2), RangeError);
});

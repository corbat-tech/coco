import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.PROJECT_UNDER_TEST;
if (!root) throw new Error("PROJECT_UNDER_TEST is required");
const load = (name) => import(pathToFileURL(path.join(root, "src", name)).href);
test("parallel-collections external acceptance", async () => {
  const { unique } = await load("unique.mjs");
  const { countOccurrences } = await load("counts.mjs");
  const source = ["b", "a", "b", "c", "a"];
  assert.deepEqual(unique(source), ["b", "a", "c"]);
  assert.deepEqual(source, ["b", "a", "b", "c", "a"]);
  assert.deepEqual(countOccurrences(source), { b: 2, a: 2, c: 1 });
  assert.deepEqual(
    countOccurrences(["__proto__", "constructor", "__proto__"]),
    Object.fromEntries([
      ["__proto__", 2],
      ["constructor", 1],
    ]),
  );
});

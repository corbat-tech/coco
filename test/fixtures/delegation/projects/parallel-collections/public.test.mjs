import test from "node:test";
import assert from "node:assert/strict";
import { unique } from "./src/unique.mjs";
import { countOccurrences } from "./src/counts.mjs";
test("single values", () => {
  assert.deepEqual(unique(["a"]), ["a"]);
  assert.deepEqual(countOccurrences(["a"]), { a: 1 });
});

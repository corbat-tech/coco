import test from "node:test";
import assert from "node:assert/strict";
import { clamp } from "./src/clamp.mjs";
test("upper bound and interior", () => {
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(5, 0, 10), 5);
});

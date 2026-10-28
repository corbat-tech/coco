import test from "node:test";
import assert from "node:assert/strict";
import { mean } from "./src/mean.mjs";
import { maximum } from "./src/maximum.mjs";
test("ordinary positive values", () => {
  assert.equal(mean([2, 4]), 3);
  assert.equal(maximum([2, 4]), 4);
});

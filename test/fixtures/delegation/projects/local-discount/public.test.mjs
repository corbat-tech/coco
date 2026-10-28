import test from "node:test";
import assert from "node:assert/strict";
import { discountedTotal } from "./src/discount.mjs";
test("default and nonzero discount", () => {
  assert.equal(discountedTotal(100), 90);
  assert.equal(discountedTotal(100, 0.2), 80);
});

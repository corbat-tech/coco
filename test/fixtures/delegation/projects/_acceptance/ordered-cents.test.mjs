import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.PROJECT_UNDER_TEST;
if (!root) throw new Error("PROJECT_UNDER_TEST is required");
const load = (name) => import(pathToFileURL(path.join(root, "src", name)).href);
test("ordered-cents external acceptance", async () => {
  const { parseAmount } = await load("amount.mjs");
  const { invoiceLabel } = await load("invoice.mjs");
  assert.equal(parseAmount("12.34"), 1234);
  assert.equal(parseAmount("0.01"), 1);
  assert.equal(parseAmount("0"), 0);
  assert.equal(invoiceLabel("12.34"), "EUR 12.34");
  assert.equal(invoiceLabel("0.01"), "EUR 0.01");
});

import test from "node:test";
import assert from "node:assert/strict";
import { invoiceLabel } from "./src/invoice.mjs";
test("display remains stable", () => assert.equal(invoiceLabel("12.34"), "EUR 12.34"));

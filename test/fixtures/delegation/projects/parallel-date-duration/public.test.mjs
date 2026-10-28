import test from "node:test";
import assert from "node:assert/strict";
import { duration } from "./src/duration.mjs";
test("two-digit remainder", () => assert.equal(duration(135), "2:15"));

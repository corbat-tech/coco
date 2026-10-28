import test from "node:test";
import assert from "node:assert/strict";
import { greeting } from "./src/greeting.mjs";
test("greeting remains stable", () =>
  assert.equal(greeting([{ id: 1, name: "Ada" }], 1), "Hello Ada"));

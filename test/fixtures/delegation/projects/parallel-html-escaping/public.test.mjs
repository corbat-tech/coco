import test from "node:test";
import assert from "node:assert/strict";
import { escapeText } from "./src/text.mjs";
import { escapeAttribute } from "./src/attribute.mjs";
test("ordinary text and attribute", () => {
  assert.equal(escapeText("<a>"), "&lt;a&gt;");
  assert.equal(escapeAttribute("hello"), "hello");
});

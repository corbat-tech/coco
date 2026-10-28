import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.PROJECT_UNDER_TEST;
if (!root) throw new Error("PROJECT_UNDER_TEST is required");
const load = (name) => import(pathToFileURL(path.join(root, "src", name)).href);
test("ordered-token-result external acceptance", async () => {
  const { tokenize } = await load("tokens.mjs");
  const { wordCount } = await load("count.mjs");
  assert.deepEqual(tokenize(" a\tb  "), { tokens: ["a", "b"], count: 2 });
  assert.deepEqual(tokenize("  "), { tokens: [], count: 0 });
  assert.equal(wordCount("a b c"), 3);
  assert.equal(wordCount(""), 0);
});

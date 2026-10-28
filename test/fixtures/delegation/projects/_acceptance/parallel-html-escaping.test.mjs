import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.PROJECT_UNDER_TEST;
if (!root) throw new Error("PROJECT_UNDER_TEST is required");
const load = (name) => import(pathToFileURL(path.join(root, "src", name)).href);
test("parallel-html-escaping external acceptance", async () => {
  const { escapeText } = await load("text.mjs");
  const { escapeAttribute } = await load("attribute.mjs");
  assert.equal(escapeText("A&B&C <x>"), "A&amp;B&amp;C &lt;x&gt;");
  assert.equal(escapeText('"x"'), '"x"');
  assert.equal(escapeAttribute('a"b"&c'), "a&quot;b&quot;&amp;c");
  assert.equal(escapeAttribute(""), "");
});

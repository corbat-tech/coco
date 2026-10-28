import test from "node:test";
import assert from "node:assert/strict";
import { wordCount } from "./src/count.mjs";
test("word count remains stable", () => assert.equal(wordCount("hello world"), 2));

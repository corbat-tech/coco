import test from "node:test";
import assert from "node:assert/strict";
import { baseUrl } from "./src/url.mjs";
test("URL remains stable", () => assert.equal(baseUrl({}), "http://localhost:3000"));

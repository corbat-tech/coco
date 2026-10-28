import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.PROJECT_UNDER_TEST;
if (!root) throw new Error("PROJECT_UNDER_TEST is required");
const load = (name) => import(pathToFileURL(path.join(root, "src", name)).href);
test("ordered-user-result external acceptance", async () => {
  const { findUser } = await load("users.mjs");
  const { greeting } = await load("greeting.mjs");
  const user = { id: 1, name: "Ada" };
  assert.deepEqual(findUser([user], 1), { found: true, item: user });
  assert.deepEqual(findUser([user], "1"), { found: false, item: null });
  assert.equal(greeting([user], 1), "Hello Ada");
  assert.equal(greeting([], 1), "Unknown user");
});

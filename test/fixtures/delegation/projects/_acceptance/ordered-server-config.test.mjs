import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.PROJECT_UNDER_TEST;
if (!root) throw new Error("PROJECT_UNDER_TEST is required");
const load = (name) => import(pathToFileURL(path.join(root, "src", name)).href);
test("ordered-server-config external acceptance", async () => {
  const { loadConfig } = await load("config.mjs");
  const { baseUrl } = await load("url.mjs");
  assert.deepEqual(loadConfig({}), { server: { host: "localhost", port: 3000 } });
  assert.deepEqual(loadConfig({ HOST: "example.test", PORT: "8080" }), {
    server: { host: "example.test", port: 8080 },
  });
  assert.equal(baseUrl({ HOST: "example.test", PORT: "8080" }), "http://example.test:8080");
});

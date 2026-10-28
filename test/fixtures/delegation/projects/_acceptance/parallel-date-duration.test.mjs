import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.PROJECT_UNDER_TEST;
if (!root) throw new Error("PROJECT_UNDER_TEST is required");
const load = (name) => import(pathToFileURL(path.join(root, "src", name)).href);
test("parallel-date-duration external acceptance", async () => {
  const { utcDate } = await load("date.mjs");
  const { duration } = await load("duration.mjs");
  assert.equal(utcDate(new Date("2024-01-02T23:30:00Z")), "2024-01-02");
  assert.equal(utcDate(new Date("2026-12-31T00:00:00Z")), "2026-12-31");
  assert.equal(duration(0), "0:00");
  assert.equal(duration(65), "1:05");
  assert.equal(duration(600), "10:00");
});

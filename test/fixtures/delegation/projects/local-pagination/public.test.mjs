import test from "node:test";
import assert from "node:assert/strict";
import { paginate } from "./src/paginate.mjs";
test("single full page", () => assert.deepEqual(paginate([1, 2], 1, 2), [1, 2]));

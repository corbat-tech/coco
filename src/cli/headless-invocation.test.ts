import { describe, expect, it } from "vitest";
import { requestsHeadlessJson } from "./headless-invocation.js";
describe("headless parse error encoding", () => {
  it.each([
    [["-Ptask", "--output", "json", "--bad"], true],
    [["--print=task", "--output=json"], true],
    [["-P", "task", "--output", "json"], true],
    [["-P", "--output", "json", "--output=text"], false],
    [["--", "-P", "--output", "json"], false],
    [["--model", "-Ptask", "--output=json"], false],
    [["-P", "--output=json", "--", "--output=text"], true],
  ] as const)("handles %j", (args, expected) => {
    expect(requestsHeadlessJson([...args])).toBe(expected);
  });
});

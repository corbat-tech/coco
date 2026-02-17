/**
 * Tests for Interruption Processor
 */

import { describe, it, expect } from "vitest";
import { processInterruptions, formatInterruptionContext } from "./processor.js";
import { InterruptionType, type ClassifiedInterruption } from "./types.js";

function makeClassified(
  text: string,
  type: InterruptionType,
  confidence = 0.9,
): ClassifiedInterruption {
  return { text, type, confidence, timestamp: Date.now() };
}

describe("processInterruptions", () => {
  it("returns no-op for empty input", () => {
    const result = processInterruptions([]);
    expect(result.shouldAbort).toBe(false);
    expect(result.contextMessages).toHaveLength(0);
  });

  it("signals abort when Abort interruption is present", () => {
    const interruptions = [makeClassified("stop", InterruptionType.Abort)];
    const result = processInterruptions(interruptions);
    expect(result.shouldAbort).toBe(true);
    expect(result.summary).toContain("Abort");
  });

  it("does not signal abort for non-abort interruptions", () => {
    const interruptions = [
      makeClassified("add tests", InterruptionType.Modify),
      makeClassified("the file is here", InterruptionType.Info),
    ];
    const result = processInterruptions(interruptions);
    expect(result.shouldAbort).toBe(false);
  });

  it("groups corrections as high priority context", () => {
    const interruptions = [makeClassified("fix the import", InterruptionType.Correct)];
    const result = processInterruptions(interruptions);
    expect(result.contextMessages[0]).toContain("Corrections");
    expect(result.contextMessages[0]).toContain("high priority");
    expect(result.contextMessages[0]).toContain("fix the import");
  });

  it("groups modifications separately", () => {
    const interruptions = [makeClassified("add emojis", InterruptionType.Modify)];
    const result = processInterruptions(interruptions);
    expect(result.contextMessages[0]).toContain("Modifications");
    expect(result.contextMessages[0]).toContain("add emojis");
  });

  it("groups info messages separately", () => {
    const interruptions = [makeClassified("the API is v3", InterruptionType.Info)];
    const result = processInterruptions(interruptions);
    expect(result.contextMessages[0]).toContain("Additional context");
  });

  it("handles mixed types correctly", () => {
    const interruptions = [
      makeClassified("stop", InterruptionType.Abort),
      makeClassified("fix the import", InterruptionType.Correct),
      makeClassified("add tests", InterruptionType.Modify),
      makeClassified("file is in src/", InterruptionType.Info),
    ];

    const result = processInterruptions(interruptions);
    expect(result.shouldAbort).toBe(true);
    // Non-abort messages should still generate context
    expect(result.contextMessages).toHaveLength(3); // corrections, modifications, info
    expect(result.summary).toContain("Abort");
    expect(result.summary).toContain("1 correction(s)");
    expect(result.summary).toContain("1 modification(s)");
    expect(result.summary).toContain("1 info message(s)");
  });

  it("numbers multiple messages within a group", () => {
    const interruptions = [
      makeClassified("add emojis", InterruptionType.Modify),
      makeClassified("add colors", InterruptionType.Modify),
    ];

    const result = processInterruptions(interruptions);
    expect(result.contextMessages[0]).toContain("1. add emojis");
    expect(result.contextMessages[0]).toContain("2. add colors");
  });
});

describe("formatInterruptionContext", () => {
  it("returns empty string when no context messages", () => {
    const result = processInterruptions([]);
    expect(formatInterruptionContext(result)).toBe("");
  });

  it("formats context messages with header", () => {
    const result = processInterruptions([
      makeClassified("add tests", InterruptionType.Modify),
    ]);
    const formatted = formatInterruptionContext(result);
    expect(formatted).toContain("User provided additional instructions");
    expect(formatted).toContain("add tests");
    expect(formatted).toContain("incorporate this feedback");
  });

  it("includes all context groups", () => {
    const result = processInterruptions([
      makeClassified("fix the bug", InterruptionType.Correct),
      makeClassified("the file is in src/", InterruptionType.Info),
    ]);
    const formatted = formatInterruptionContext(result);
    expect(formatted).toContain("Corrections");
    expect(formatted).toContain("Additional context");
  });
});

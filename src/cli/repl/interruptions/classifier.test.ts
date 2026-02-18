/**
 * Tests for Interruption Classifier
 */

import { describe, it, expect } from "vitest";
import { classifyInterruption, classifyAll } from "./classifier.js";
import { InterruptionType } from "./types.js";
import type { QueuedMessage } from "../input/types.js";

function makeMsg(text: string, timestamp?: number): QueuedMessage {
  return { text, timestamp: timestamp ?? Date.now() };
}

describe("classifyInterruption", () => {
  describe("Abort detection", () => {
    it("classifies 'para' as Abort", () => {
      const result = classifyInterruption(makeMsg("para"));
      expect(result.type).toBe(InterruptionType.Abort);
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it("classifies 'stop' as Abort", () => {
      const result = classifyInterruption(makeMsg("stop"));
      expect(result.type).toBe(InterruptionType.Abort);
    });

    it("classifies 'cancel' as Abort", () => {
      const result = classifyInterruption(makeMsg("cancel"));
      expect(result.type).toBe(InterruptionType.Abort);
    });

    it("classifies 'abort' as Abort", () => {
      const result = classifyInterruption(makeMsg("abort"));
      expect(result.type).toBe(InterruptionType.Abort);
    });

    it("classifies 'detente' as Abort", () => {
      const result = classifyInterruption(makeMsg("detente"));
      expect(result.type).toBe(InterruptionType.Abort);
    });

    it("classifies 'para ya' as Abort", () => {
      const result = classifyInterruption(makeMsg("para ya"));
      expect(result.type).toBe(InterruptionType.Abort);
    });

    it("is case insensitive", () => {
      const result = classifyInterruption(makeMsg("STOP"));
      expect(result.type).toBe(InterruptionType.Abort);
    });
  });

  describe("Modify detection", () => {
    it("classifies 'añade emojis' as Modify", () => {
      const result = classifyInterruption(makeMsg("añade emojis"));
      expect(result.type).toBe(InterruptionType.Modify);
    });

    it("classifies 'add more details' as Modify", () => {
      const result = classifyInterruption(makeMsg("add more details"));
      expect(result.type).toBe(InterruptionType.Modify);
    });

    it("classifies 'cambia el color a azul' as Modify", () => {
      const result = classifyInterruption(makeMsg("cambia el color a azul"));
      expect(result.type).toBe(InterruptionType.Modify);
    });

    it("classifies 'usa colores azules' as Modify", () => {
      const result = classifyInterruption(makeMsg("usa colores azules"));
      expect(result.type).toBe(InterruptionType.Modify);
    });

    it("classifies 'make it shorter' as Modify", () => {
      const result = classifyInterruption(makeMsg("make it shorter"));
      expect(result.type).toBe(InterruptionType.Modify);
    });

    it("classifies 'más corto' as Modify", () => {
      const result = classifyInterruption(makeMsg("más corto"));
      expect(result.type).toBe(InterruptionType.Modify);
    });

    it("classifies 'también incluye tests' as Modify", () => {
      const result = classifyInterruption(makeMsg("también incluye tests"));
      expect(result.type).toBe(InterruptionType.Modify);
    });
  });

  describe("Correct detection", () => {
    it("classifies 'error en la función X' as Correct", () => {
      const result = classifyInterruption(makeMsg("error en la función X"));
      expect(result.type).toBe(InterruptionType.Correct);
    });

    it("classifies 'fix the import' as Correct", () => {
      const result = classifyInterruption(makeMsg("fix the import"));
      expect(result.type).toBe(InterruptionType.Correct);
    });

    it("classifies 'está mal el path' as Correct", () => {
      const result = classifyInterruption(makeMsg("está mal el path"));
      expect(result.type).toBe(InterruptionType.Correct);
    });

    it("classifies 'arregla el typo' as Correct", () => {
      const result = classifyInterruption(makeMsg("arregla el typo"));
      expect(result.type).toBe(InterruptionType.Correct);
    });

    it("classifies 'it doesn't work' as Correct", () => {
      const result = classifyInterruption(makeMsg("it doesn't work"));
      expect(result.type).toBe(InterruptionType.Correct);
    });
  });

  describe("Info detection (default)", () => {
    it("classifies generic text as Info", () => {
      const result = classifyInterruption(makeMsg("the API key is stored in .env"));
      expect(result.type).toBe(InterruptionType.Info);
    });

    it("classifies supplementary info as Info", () => {
      const result = classifyInterruption(makeMsg("the API key is in .env file"));
      expect(result.type).toBe(InterruptionType.Info);
    });

    it("gives Info a moderate confidence", () => {
      const result = classifyInterruption(makeMsg("random extra context"));
      expect(result.confidence).toBe(0.5);
    });
  });

  it("preserves the original text", () => {
    const result = classifyInterruption(makeMsg("add some tests please"));
    expect(result.text).toBe("add some tests please");
  });

  it("preserves the timestamp", () => {
    const ts = 1700000000000;
    const result = classifyInterruption(makeMsg("stop", ts));
    expect(result.timestamp).toBe(ts);
  });
});

describe("classifyAll", () => {
  it("returns empty array for empty input", () => {
    expect(classifyAll([])).toEqual([]);
  });

  it("sorts Abort messages first", () => {
    const messages = [
      makeMsg("add emojis", 100),
      makeMsg("stop", 200),
      makeMsg("more details", 300),
    ];

    const classified = classifyAll(messages);
    expect(classified[0]?.type).toBe(InterruptionType.Abort);
  });

  it("preserves timestamp order for same-type messages", () => {
    const messages = [makeMsg("add emojis", 200), makeMsg("add colors", 100)];

    const classified = classifyAll(messages);
    expect(classified[0]?.timestamp).toBe(100);
    expect(classified[1]?.timestamp).toBe(200);
  });

  it("classifies multiple messages correctly", () => {
    const messages = [
      makeMsg("add tests"),
      makeMsg("fix the typo"),
      makeMsg("the file is in src/"),
    ];

    const classified = classifyAll(messages);
    const types = classified.map((c) => c.type);
    expect(types).toContain(InterruptionType.Modify);
    expect(types).toContain(InterruptionType.Correct);
    expect(types).toContain(InterruptionType.Info);
  });
});

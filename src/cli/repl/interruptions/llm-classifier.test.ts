import { describe, it, expect, vi } from "vitest";
import { createLLMClassifier } from "./llm-classifier.js";
import { InterruptionAction } from "./types.js";
import type { LLMProvider, ChatResponse } from "../../../providers/types.js";
import type { QueuedMessage } from "../input/types.js";

/** Create a mock provider */
function createMockProvider(response: string, delay = 0): LLMProvider {
  return {
    id: "test",
    name: "Test Provider",
    initialize: vi.fn(),
    chat: vi.fn().mockImplementation(
      () =>
        new Promise<ChatResponse>((resolve) =>
          setTimeout(
            () =>
              resolve({
                id: "test-id",
                content: response,
                stopReason: "end_turn" as const,
                usage: { inputTokens: 50, outputTokens: 1 },
                model: "test-model",
              }),
            delay,
          ),
        ),
    ),
    chatWithTools: vi.fn(),
    stream: vi.fn(),
    streamWithTools: vi.fn(),
    countTokens: vi.fn().mockReturnValue(10),
    getContextWindow: vi.fn().mockReturnValue(128000),
    isAvailable: vi.fn().mockResolvedValue(true),
  } as unknown as LLMProvider;
}

/** Create a mock queued message */
function createMessage(text: string): QueuedMessage {
  return { text, timestamp: Date.now() };
}

describe("LLM Classifier", () => {
  describe("classify with LLM responses", () => {
    it("should classify MODIFY response correctly", async () => {
      const provider = createMockProvider("MODIFY");
      const classifier = createLLMClassifier(provider);

      const result = await classifier.classify(
        createMessage("no, mejor de la griega"),
        "haz una poesía de la mitología vikinga",
      );

      expect(result.action).toBe(InterruptionAction.Modify);
      expect(result.source).toBe("llm");
    });

    it("should classify QUEUE response correctly", async () => {
      const provider = createMockProvider("QUEUE");
      const classifier = createLLMClassifier(provider);

      const result = await classifier.classify(
        createMessage("cuanto es 2+2"),
        "crea un archivo HTML con el tiempo",
      );

      expect(result.action).toBe(InterruptionAction.Queue);
      expect(result.source).toBe("llm");
    });

    it("should classify ABORT response correctly", async () => {
      const provider = createMockProvider("ABORT");
      const classifier = createLLMClassifier(provider);

      const result = await classifier.classify(
        createMessage("déjalo, no quiero nada"),
        "escribe un poema largo",
      );

      expect(result.action).toBe(InterruptionAction.Abort);
      expect(result.source).toBe("llm");
    });

    it("should handle LLM response with extra whitespace", async () => {
      const provider = createMockProvider("  MODIFY  \n");
      const classifier = createLLMClassifier(provider);

      const result = await classifier.classify(
        createMessage("hazlo en python"),
        "crea un script en javascript",
      );

      expect(result.action).toBe(InterruptionAction.Modify);
      expect(result.source).toBe("llm");
    });

    it("should handle LLM response with surrounding text", async () => {
      const provider = createMockProvider("I think this is QUEUE");
      const classifier = createLLMClassifier(provider);

      const result = await classifier.classify(
        createMessage("dime el tiempo en madrid"),
        "crea un archivo HTML",
      );

      expect(result.action).toBe(InterruptionAction.Queue);
      expect(result.source).toBe("llm");
    });
  });

  describe("timeout fallback to keywords", () => {
    it("should fall back to keywords when LLM times out", async () => {
      // LLM takes 5 seconds, timeout is 100ms
      const provider = createMockProvider("MODIFY", 5000);
      const classifier = createLLMClassifier(provider, { timeoutMs: 100 });

      const result = await classifier.classify(createMessage("para"), "escribe un poema");

      // "para" matches abort keywords → should fall back to Abort
      expect(result.action).toBe(InterruptionAction.Abort);
      expect(result.source).toBe("keywords");
    });

    it("should fall back to keywords when LLM returns unrecognized response", async () => {
      const provider = createMockProvider("I don't know what to do");
      const classifier = createLLMClassifier(provider);

      const result = await classifier.classify(createMessage("cambia el color"), "crea una web");

      // LLM response doesn't contain MODIFY/QUEUE/ABORT → null → keywords fallback
      // "cambia" matches modify keywords
      expect(result.action).toBe(InterruptionAction.Modify);
      expect(result.source).toBe("keywords");
    });
  });

  describe("error handling", () => {
    it("should fall back to keywords when LLM throws an error", async () => {
      const provider = {
        ...createMockProvider(""),
        chat: vi.fn().mockRejectedValue(new Error("Network error")),
      } as unknown as LLMProvider;
      const classifier = createLLMClassifier(provider, { timeoutMs: 1000 });

      const result = await classifier.classify(
        createMessage("cambia el color a azul"),
        "crea una página web",
      );

      // LLM fails → null → timeout wins → keywords fallback
      // "cambia" matches modify keywords
      expect(result.source).toBe("keywords");
      expect(result.action).toBe(InterruptionAction.Modify);
    });
  });

  describe("context passing", () => {
    it("should pass the current task to the LLM for context", async () => {
      const provider = createMockProvider("MODIFY");
      const classifier = createLLMClassifier(provider);

      await classifier.classify(createMessage("hazlo más grande"), "crea un botón rojo");

      expect(provider.chat).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(provider.chat).mock.calls[0]!;
      const userMessage = callArgs[0][0]!.content as string;
      expect(userMessage).toContain("crea un botón rojo");
      expect(userMessage).toContain("hazlo más grande");
    });

    it("should handle null current task", async () => {
      const provider = createMockProvider("QUEUE");
      const classifier = createLLMClassifier(provider);

      await classifier.classify(createMessage("dime algo"), null);

      const callArgs = vi.mocked(provider.chat).mock.calls[0]!;
      const userMessage = callArgs[0][0]!.content as string;
      expect(userMessage).toContain("dime algo");
      expect(userMessage).not.toContain("Current task");
    });
  });

  describe("LLM call options", () => {
    it("should use low maxTokens and temperature 0", async () => {
      const provider = createMockProvider("MODIFY");
      const classifier = createLLMClassifier(provider);

      await classifier.classify(createMessage("test"), "task");

      const callArgs = vi.mocked(provider.chat).mock.calls[0]!;
      const options = callArgs[1]!;
      expect(options.maxTokens).toBe(10);
      expect(options.temperature).toBe(0);
      expect(options.system).toContain("MODIFY");
      expect(options.system).toContain("QUEUE");
      expect(options.system).toContain("ABORT");
    });
  });
});

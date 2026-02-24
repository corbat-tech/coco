/**
 * Intent Recognizer Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createIntentRecognizer,
  getIntentRecognizer,
  DEFAULT_INTENT_CONFIG,
} from "./recognizer.js";
import type { IntentConfig, Intent, IntentType } from "./types.js";

describe("Intent Recognizer", () => {
  describe("createIntentRecognizer", () => {
    it("should create recognizer with default config", () => {
      const recognizer = createIntentRecognizer();
      expect(recognizer).toBeDefined();
      expect(recognizer.recognize).toBeDefined();
      expect(recognizer.resolve).toBeDefined();
    });

    it("should merge custom config with defaults", () => {
      const customConfig: Partial<IntentConfig> = {
        autoExecute: true,
        minConfidence: 0.8,
      };
      const recognizer = createIntentRecognizer(customConfig);
      const config = recognizer.getConfig();
      expect(config.autoExecute).toBe(true);
      expect(config.minConfidence).toBe(0.8);
      expect(config.autoExecuteThreshold).toBe(DEFAULT_INTENT_CONFIG.autoExecuteThreshold);
    });
  });

  describe("recognize", () => {
    let recognizer: ReturnType<typeof createIntentRecognizer>;

    beforeEach(() => {
      recognizer = createIntentRecognizer();
    });

    // Phase commands (plan, build, task, init, output, ship) are intentionally
    // excluded from pattern matching to prevent false positives on natural language.
    // They fall through to "chat" so the LLM handles them via its registered tools.
    describe("phase commands fall through to chat", () => {
      it('"create a plan" → chat (handled by LLM)', async () => {
        const intent = await recognizer.recognize("create a plan");
        expect(intent.type).toBe("chat");
      });

      it('"build the project" → chat (handled by LLM)', async () => {
        const intent = await recognizer.recognize("build the project");
        expect(intent.type).toBe("chat");
      });

      it('"init a new project" → chat (handled by LLM)', async () => {
        const intent = await recognizer.recognize("init a new project");
        expect(intent.type).toBe("chat");
      });

      it('"task 3" → chat (handled by LLM)', async () => {
        const intent = await recognizer.recognize("task 3");
        expect(intent.type).toBe("chat");
      });

      it('"ship it" → chat (handled by LLM)', async () => {
        const intent = await recognizer.recognize("ship it");
        expect(intent.type).toBe("chat");
      });

      // Regression: natural language that previously false-matched /task
      it('"implementa la tarea de instructions.md" → chat', async () => {
        const intent = await recognizer.recognize(
          "implementa la tarea de instructions.md y ten en cuenta resumen.md",
        );
        expect(intent.type).toBe("chat");
      });

      it('"construye el proyecto" → chat', async () => {
        const intent = await recognizer.recognize("construye el proyecto");
        expect(intent.type).toBe("chat");
      });

      it('"haz un plan" → chat', async () => {
        const intent = await recognizer.recognize("haz un plan");
        expect(intent.type).toBe("chat");
      });
    });

    describe("status intent", () => {
      it('should recognize "/status"', async () => {
        const intent = await recognizer.recognize("/status");
        expect(intent.type).toBe("status");
        expect(intent.confidence).toBeGreaterThan(0.6);
      });

      // Natural language no longer triggers commands — goes to LLM agent instead
      it('"status" without slash → chat (handled by LLM)', async () => {
        const intent = await recognizer.recognize("status");
        expect(intent.type).toBe("chat");
      });

      it('"what\'s the status" → chat (handled by LLM)', async () => {
        const intent = await recognizer.recognize("what's the status");
        expect(intent.type).toBe("chat");
      });

      it('"qué pasó no hiciste nada" → chat (regression: must not match /status)', async () => {
        const intent = await recognizer.recognize("qué pasó no hiciste nada");
        expect(intent.type).toBe("chat");
      });
    });

    describe("help intent", () => {
      it('should recognize "/help"', async () => {
        const intent = await recognizer.recognize("/help");
        expect(intent.type).toBe("help");
        expect(intent.confidence).toBeGreaterThan(0.6);
      });

      it('"help" without slash → chat (handled by LLM)', async () => {
        const intent = await recognizer.recognize("help");
        expect(intent.type).toBe("chat");
      });
    });

    describe("exit intent", () => {
      it('should recognize "/exit"', async () => {
        const intent = await recognizer.recognize("/exit");
        expect(intent.type).toBe("exit");
        expect(intent.confidence).toBeGreaterThan(0.6);
      });

      it('should recognize "/quit"', async () => {
        const intent = await recognizer.recognize("/quit");
        expect(intent.type).toBe("exit");
        expect(intent.confidence).toBeGreaterThan(0.6);
      });

      it('"exit" without slash → chat (handled by LLM)', async () => {
        const intent = await recognizer.recognize("exit");
        expect(intent.type).toBe("chat");
      });
    });

    describe("chat intent (fallback)", () => {
      it("should fallback to chat for unclear input", async () => {
        const intent = await recognizer.recognize("tell me about this file");
        expect(intent.type).toBe("chat");
      });

      it("should fallback to chat for generic questions", async () => {
        const intent = await recognizer.recognize("what is the weather today?");
        expect(intent.type).toBe("chat");
      });

      it("should handle empty input", async () => {
        const intent = await recognizer.recognize("");
        expect(intent.type).toBe("chat");
        expect(intent.confidence).toBe(1);
      });
    });
  });

  describe("entity extraction", () => {
    let recognizer: ReturnType<typeof createIntentRecognizer>;

    beforeEach(() => {
      recognizer = createIntentRecognizer();
    });

    // Entity extraction only runs for slash commands (non-slash inputs return chat with empty entities)
    it("should extract sprint number from /build command", async () => {
      const intent = await recognizer.recognize("/build sprint 5");
      expect(intent.entities.sprint).toBe(5);
    });

    it("should extract flags from /plan command", async () => {
      const intent = await recognizer.recognize("/plan --dry-run");
      expect(intent.entities.flags).toContain("dry-run");
    });

    it("should return empty entities for natural language (chat fallback)", async () => {
      const intent = await recognizer.recognize("init a new project with react and docker");
      expect(intent.type).toBe("chat");
      expect(intent.entities).toEqual({});
    });

    it("should extract quoted args from slash command", async () => {
      const intent = await recognizer.recognize('/init "my awesome project"');
      expect(intent.entities.args).toContain("my awesome project");
    });
  });

  describe("intentToCommand", () => {
    let recognizer: ReturnType<typeof createIntentRecognizer>;

    beforeEach(() => {
      recognizer = createIntentRecognizer();
    });

    // intentToCommand is a pure converter — tested directly with constructed intents
    function makeIntent(type: IntentType, entities: Intent["entities"] = {}): Intent {
      return { type, confidence: 0.9, entities, raw: "" };
    }

    it("should convert plan intent to command", () => {
      const cmd = recognizer.intentToCommand(makeIntent("plan", { flags: ["dry-run"] }));
      expect(cmd).toEqual({ command: "plan", args: ["--dry-run"] });
    });

    it("should convert build intent with sprint", () => {
      const cmd = recognizer.intentToCommand(makeIntent("build", { sprint: 3 }));
      expect(cmd).toEqual({ command: "build", args: ["--sprint=3"] });
    });

    it("should convert init intent with project name and flag", () => {
      const cmd = recognizer.intentToCommand(
        makeIntent("init", { projectName: "my-app", flags: ["yes"] }),
      );
      expect(cmd?.command).toBe("init");
      expect(cmd?.args).toContain("my-app");
      expect(cmd?.args).toContain("--yes");
    });

    it("should convert status intent", () => {
      const cmd = recognizer.intentToCommand(makeIntent("status"));
      expect(cmd).toEqual({ command: "status", args: [] });
    });

    it("should convert exit intent", () => {
      const cmd = recognizer.intentToCommand(makeIntent("exit"));
      expect(cmd).toEqual({ command: "exit", args: [] });
    });

    it("should return null for chat intent", () => {
      const cmd = recognizer.intentToCommand(makeIntent("chat"));
      expect(cmd).toBeNull();
    });
  });

  describe("shouldAutoExecute", () => {
    it("should NOT auto-execute /status (in alwaysConfirm)", async () => {
      const recognizer = createIntentRecognizer({
        autoExecute: true,
        autoExecuteThreshold: 0.8,
      });
      const intent = await recognizer.recognize("/status");
      expect(recognizer.shouldAutoExecute(intent)).toBe(false);
    });

    it("should auto-execute /exit immediately (no confirmation needed)", async () => {
      const recognizer = createIntentRecognizer();
      // autoExecute is false by default but exit has autoExecutePreferences: true
      const intent = await recognizer.recognize("/exit");
      expect(recognizer.shouldAutoExecute(intent)).toBe(true);
    });

    it("should auto-execute /quit immediately", async () => {
      const recognizer = createIntentRecognizer();
      const intent = await recognizer.recognize("/quit");
      expect(recognizer.shouldAutoExecute(intent)).toBe(true);
    });

    it("should respect alwaysConfirm list", async () => {
      const recognizer = createIntentRecognizer({
        autoExecute: true,
        alwaysConfirm: ["help"],
      });
      const intent = await recognizer.recognize("/help");
      expect(recognizer.shouldAutoExecute(intent)).toBe(false);
    });

    it("should respect user preference overriding global autoExecute=false", async () => {
      const recognizer = createIntentRecognizer({ autoExecute: false });
      recognizer.setAutoExecutePreference("help", true);
      const intent = await recognizer.recognize("/help");
      expect(recognizer.shouldAutoExecute(intent)).toBe(true);
    });
  });

  describe("resolve", () => {
    let recognizer: ReturnType<typeof createIntentRecognizer>;

    beforeEach(() => {
      recognizer = createIntentRecognizer();
    });

    it("should resolve chat intent to not execute", async () => {
      const intent = await recognizer.recognize("hello");
      const resolution = await recognizer.resolve(intent);
      expect(resolution.execute).toBe(false);
    });

    it("should resolve /status to command (not auto-execute)", async () => {
      const intent = await recognizer.recognize("/status");
      const resolution = await recognizer.resolve(intent);
      expect(resolution.command).toBe("status");
      expect(resolution.execute).toBe(false);
    });

    it("should auto-execute /exit without confirmation", async () => {
      const intent = await recognizer.recognize("/exit");
      const resolution = await recognizer.resolve(intent);
      expect(resolution.execute).toBe(true);
      expect(resolution.command).toBe("exit");
    });
  });

  describe("getIntentRecognizer singleton", () => {
    it("should return same instance", () => {
      const r1 = getIntentRecognizer();
      const r2 = getIntentRecognizer();
      expect(r1).toBe(r2);
    });

    it("should create new instance with config", () => {
      const r1 = getIntentRecognizer();
      const r2 = getIntentRecognizer({ autoExecute: true });
      expect(r1).not.toBe(r2);
      expect(r2.getConfig().autoExecute).toBe(true);
    });
  });
});

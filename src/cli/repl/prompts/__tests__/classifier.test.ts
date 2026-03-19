import { describe, it, expect } from "vitest";
import { classifyRequest } from "../classifier.js";

describe("classifyRequest", () => {
  describe("bugfix", () => {
    it("should classify 'fix the login bug' as bugfix", () => {
      expect(classifyRequest("fix the login bug")).toBe("bugfix");
    });

    it("should classify 'this is broken' as bugfix", () => {
      expect(classifyRequest("this is broken")).toBe("bugfix");
    });

    it("should classify 'the app crashes on startup' as bugfix", () => {
      expect(classifyRequest("the app crashes on startup")).toBe("bugfix");
    });

    it("should classify 'tests are failing' as bugfix", () => {
      expect(classifyRequest("tests are failing")).toBe("bugfix");
    });

    it("should classify 'not working correctly' as bugfix", () => {
      expect(classifyRequest("the function is not working correctly")).toBe("bugfix");
    });

    it("should classify Spanish 'arregla este error' as bugfix", () => {
      expect(classifyRequest("arregla este error")).toBe("bugfix");
    });

    it("should classify Spanish 'no funciona' as bugfix", () => {
      expect(classifyRequest("la funcion no funciona")).toBe("bugfix");
    });
  });

  describe("debug", () => {
    it("should classify 'debug the auth flow' as debug", () => {
      expect(classifyRequest("debug the auth flow")).toBe("debug");
    });

    it("should classify 'investigate the memory leak' as debug", () => {
      expect(classifyRequest("investigate the memory leak")).toBe("debug");
    });

    it("should classify 'trace the request through the middleware' as debug", () => {
      expect(classifyRequest("trace the request through the middleware")).toBe("debug");
    });
  });

  describe("test", () => {
    it("should classify 'write tests for the user service' as test", () => {
      expect(classifyRequest("write tests for the user service")).toBe("test");
    });

    it("should classify 'check coverage' as test", () => {
      expect(classifyRequest("check coverage")).toBe("test");
    });

    it("should classify 'add unit test for parser' as test", () => {
      expect(classifyRequest("add unit test for parser")).toBe("test");
    });
  });

  describe("review", () => {
    it("should classify 'review this code' as review", () => {
      expect(classifyRequest("review this code")).toBe("review");
    });

    it("should classify 'do a security review' as review", () => {
      expect(classifyRequest("do a security review")).toBe("review");
    });

    it("should classify 'audit the authentication module' as review", () => {
      expect(classifyRequest("audit the authentication module")).toBe("review");
    });
  });

  describe("refactor", () => {
    it("should classify 'refactor the database layer' as refactor", () => {
      expect(classifyRequest("refactor the database layer")).toBe("refactor");
    });

    it("should classify 'simplify this function' as refactor", () => {
      expect(classifyRequest("simplify this function")).toBe("refactor");
    });

    it("should classify 'optimize the query performance' as refactor", () => {
      expect(classifyRequest("optimize the query performance")).toBe("refactor");
    });

    it("should classify Spanish 'refactoriza el modulo' as refactor", () => {
      expect(classifyRequest("refactoriza el modulo")).toBe("refactor");
    });
  });

  describe("plan", () => {
    it("should classify 'create a plan for the migration' as plan", () => {
      expect(classifyRequest("create a plan for the migration")).toBe("plan");
    });

    it("should classify 'design the API architecture' as plan", () => {
      expect(classifyRequest("design the API architecture")).toBe("plan");
    });

    it("should classify Spanish 'planifica la migracion' as plan", () => {
      expect(classifyRequest("planifica la migracion")).toBe("plan");
    });
  });

  describe("question", () => {
    it("should classify 'what does this function do?' as question", () => {
      expect(classifyRequest("what does this function do?")).toBe("question");
    });

    it("should classify 'how does the auth work?' as question", () => {
      expect(classifyRequest("how does the auth work?")).toBe("question");
    });

    it("should classify 'explain the caching strategy' as question", () => {
      expect(classifyRequest("explain the caching strategy")).toBe("question");
    });

    it("should classify Spanish 'qué hace esta función?' as question", () => {
      expect(classifyRequest("qué hace esta función?")).toBe("question");
    });

    it("should classify 'can you fix this bug?' as bugfix not question", () => {
      // Action-oriented question should match the action type
      expect(classifyRequest("can you fix this bug?")).toBe("bugfix");
    });
  });

  describe("feature", () => {
    it("should classify 'implement user authentication' as feature", () => {
      expect(classifyRequest("implement user authentication")).toBe("feature");
    });

    it("should classify 'create a new API endpoint' as feature", () => {
      expect(classifyRequest("create a new API endpoint")).toBe("feature");
    });

    it("should classify 'add support for webhooks' as feature", () => {
      expect(classifyRequest("add support for webhooks")).toBe("feature");
    });

    it("should classify 'generate a migration script' as feature", () => {
      expect(classifyRequest("generate a migration script")).toBe("feature");
    });

    it("should classify Spanish 'implementa la autenticacion' as feature", () => {
      expect(classifyRequest("implementa la autenticacion")).toBe("feature");
    });
  });

  describe("general (fallback)", () => {
    it("should classify empty string as general", () => {
      expect(classifyRequest("")).toBe("general");
    });

    it("should classify single character as general", () => {
      expect(classifyRequest("x")).toBe("general");
    });

    it("should classify unrecognized input as general", () => {
      expect(classifyRequest("hello there")).toBe("general");
    });

    it("should classify ambiguous input as general", () => {
      expect(classifyRequest("ok sounds good")).toBe("general");
    });
  });

  describe("edge cases", () => {
    it("should handle very long input (>1000 chars) without performance issues", () => {
      const longInput = "implement " + "x".repeat(2000);
      expect(classifyRequest(longInput)).toBe("feature");
    });

    it("should classify a long question (>200 chars) starting with 'how'", () => {
      const longQuestion = "how " + "x".repeat(300) + "?";
      // Falls through to main loop where ^ anchor on 'how' still matches
      expect(classifyRequest(longQuestion)).toBe("question");
    });
  });

  describe("priority ordering", () => {
    it("should prioritize bugfix over feature for 'fix by creating a new handler'", () => {
      expect(classifyRequest("fix by creating a new handler")).toBe("bugfix");
    });

    it("should prioritize debug over bugfix for 'debug this error'", () => {
      expect(classifyRequest("debug this error")).toBe("debug");
    });

    it("should prioritize test over feature for 'write tests and implement'", () => {
      expect(classifyRequest("write tests and implement the feature")).toBe("test");
    });
  });
});

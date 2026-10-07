import { describe, expect, it } from "vitest";
import { isConversationalOnlyTurn } from "./conversational-turn.js";

describe("isolated conversational turns", () => {
  it.each(["hola", "¡Hola!", " HELLO. ", "Muchas gracias!", "thank you", "hasta luego", "bye"])(
    "keeps %s conversational",
    (content) => expect(isConversationalOnlyTurn(content)).toBe(true),
  );
  it.each([
    "hola, ejecuta los tests",
    "thanks, now commit",
    "hi there, inspect main.ts",
    "printf 'hola\\n'",
    "continúa",
    "sí",
    "",
    "explain this code",
  ])("preserves tools for %s", (content) => {
    expect(isConversationalOnlyTurn(content)).toBe(false);
  });
  it("recognizes a single text block", () => {
    expect(isConversationalOnlyTurn([{ type: "text", text: "hola" }])).toBe(true);
  });
  it("does not discard attached context or multiple blocks", () => {
    expect(
      isConversationalOnlyTurn([
        { type: "text", text: "hola" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "fixture" } },
      ]),
    ).toBe(false);
    expect(
      isConversationalOnlyTurn([
        { type: "text", text: "hola" },
        { type: "text", text: "run tests" },
      ]),
    ).toBe(false);
  });
});

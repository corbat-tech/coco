/** OpenAI-compatible providers may return typed text/thinking chunks (Mistral). */
export function visibleChatText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (!Array.isArray(content))
    throw new Error("Invalid chat content: expected text or content blocks.");
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        block !== null &&
        typeof block === "object" &&
        block.type === "text" &&
        typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("");
}

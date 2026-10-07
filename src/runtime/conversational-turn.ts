import type { MessageContent } from "../providers/types.js";

/** Only isolated social messages qualify; mixed requests and attachments keep tools. */
export function isConversationalOnlyTurn(content: string | MessageContent): boolean {
  if (typeof content !== "string") {
    if (content.length !== 1 || content[0]?.type !== "text") return false;
    content = content[0].text;
  }
  if (content.length > 128) return false;
  const text = content.trim().toLowerCase();
  let start = 0;
  let end = text.length;
  const punctuation = ".!?¡¿ \t\r\n";
  while (start < end && punctuation.includes(text.charAt(start))) start++;
  while (end > start && punctuation.includes(text.charAt(end - 1))) end--;
  const normalized = text.slice(start, end);
  return /^(hola|hello|hi|hey|buenos días|buenas tardes|buenas noches|good morning|good afternoon|good evening|gracias|muchas gracias|thank you|thanks|adiós|adios|hasta luego|bye|goodbye)$/u.test(
    normalized,
  );
}

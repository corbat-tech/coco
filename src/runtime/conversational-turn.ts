import type { MessageContent } from "../providers/types.js";

/** Only isolated social messages qualify; mixed requests and attachments keep tools. */
export function isConversationalOnlyTurn(content: string | MessageContent): boolean {
  if (typeof content !== "string") {
    if (content.length !== 1 || content[0]?.type !== "text") return false;
    content = content[0].text;
  }
  const normalized = content
    .trim()
    .toLowerCase()
    .replace(/^[¡!¿?\s]+|[.!?¡¿\s]+$/gu, "");
  return /^(hola|hello|hi|hey|buenos días|buenas tardes|buenas noches|good morning|good afternoon|good evening|gracias|muchas gracias|thank you|thanks|adiós|adios|hasta luego|bye|goodbye)$/u.test(
    normalized,
  );
}

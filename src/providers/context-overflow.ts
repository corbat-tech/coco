/** Scan each line once rather than backtracking across repeated provider phrases. */
function hasOrderedPhrases(text: string, start: RegExp, end: RegExp): boolean {
  return text.split("\n").some((line) => {
    const match = start.exec(line);
    return match !== null && end.test(line.slice(match.index + match[0].length));
  });
}

/** Recognize explicit input-context overflow without treating generic request errors as recoverable. */
export function isContextOverflowError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  let overflow = false;
  for (let examined = 0; queue.length && examined < 48; examined++) {
    const value = queue.shift();
    if (value === null || value === undefined || seen.has(value)) continue;
    seen.add(value);
    if (typeof value === "string") {
      if (value.trim().startsWith("{")) {
        try {
          queue.push(JSON.parse(value));
        } catch {
          /* Provider bodies can be plain text. */
        }
      }
      if (
        /^(?:context_length_exceeded|context_window_exceeded|prompt_too_long|input_too_long)$/i.test(
          value,
        ) ||
        hasOrderedPhrases(
          value,
          /(?:input|prompt) token count/i,
          /exceeds (?:the )?(?:maximum|limit)/i,
        ) ||
        hasOrderedPhrases(
          value,
          /(?:maximum context length|context (?:window|length))/i,
          /(?:exceeded|exceeds|too (?:long|large))/i,
        ) ||
        hasOrderedPhrases(
          value,
          /(?:input|prompt) (?:is )?too long/i,
          /(?:tokens|context|maximum)/i,
        )
      )
        overflow = true;
      continue;
    }
    if (typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (
      String(record.status) === "429" ||
      String(record.statusCode) === "429" ||
      /(?:abort|timeout)error$/i.test(String(record.name)) ||
      /^(?:ETIMEDOUT|ECONNABORTED|ABORT_ERR|rate_limit_exceeded|timeout|max_tokens)$/i.test(
        String(record.code),
      ) ||
      /timeout/i.test(String(record.code)) ||
      record.stopReason === "max_tokens"
    )
      return false;
    for (const key of ["code", "type", "message", "cause", "error", "body", "data", "response"])
      if (record[key] !== undefined) queue.push(record[key]);
  }
  return overflow;
}

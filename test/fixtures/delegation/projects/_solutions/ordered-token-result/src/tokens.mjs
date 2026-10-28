export function tokenize(text) {
  const tokens = text.trim() ? text.trim().split(/\s+/) : [];
  return { tokens, count: tokens.length };
}

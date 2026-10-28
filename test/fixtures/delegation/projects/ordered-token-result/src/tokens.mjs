export function tokenize(text) {
  return text.trim() ? text.trim().split(/\s+/) : [];
}

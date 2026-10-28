export function escapeAttribute(text) {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

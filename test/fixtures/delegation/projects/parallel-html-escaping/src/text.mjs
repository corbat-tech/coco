export function escapeText(text) {
  return text.replace("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

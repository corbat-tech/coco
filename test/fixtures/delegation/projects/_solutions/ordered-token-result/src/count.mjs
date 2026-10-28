import { tokenize } from "./tokens.mjs";
export function wordCount(text) {
  return tokenize(text).count;
}

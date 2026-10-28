import { parseAmount } from "./amount.mjs";
export function invoiceLabel(text) {
  return `EUR ${(parseAmount(text) / 100).toFixed(2)}`;
}

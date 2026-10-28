import { parseAmount } from "./amount.mjs";
export function invoiceLabel(text) {
  return `EUR ${parseAmount(text).toFixed(2)}`;
}

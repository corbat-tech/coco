export function discountedTotal(amount, discount) {
  const rate = discount || 0.1;
  return amount * (1 - rate);
}

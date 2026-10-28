export function countOccurrences(values) {
  const counts = {};
  for (const value of values) counts[value] = 1;
  return counts;
}

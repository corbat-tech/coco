export function duration(seconds) {
  return `${Math.floor(seconds / 60)}:${seconds % 60}`;
}

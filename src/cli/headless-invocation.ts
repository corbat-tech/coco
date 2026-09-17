/** Identify requested error encoding before Commander can reject an invocation. */
export function requestsHeadlessJson(args: string[]): boolean {
  let headless = false;
  let format: string | undefined;
  const valued = new Set([
    "-p",
    "--path",
    "-m",
    "--model",
    "--provider",
    "--editor-model",
    "--weak-model",
  ]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") break;
    if (valued.has(arg)) {
      index++;
      continue;
    }
    if (arg === "--output") {
      format = args[++index];
      continue;
    }
    if (arg.startsWith("--output=")) {
      format = arg.slice("--output=".length);
      continue;
    }
    if (arg === "-P" || arg === "--print") {
      headless = true;
      if (args[index + 1] && !args[index + 1]!.startsWith("-")) index++;
    } else if (arg.startsWith("--print=") || /^-P.+/.test(arg)) headless = true;
  }
  return headless && format === "json";
}

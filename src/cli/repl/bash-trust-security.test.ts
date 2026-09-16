import { describe, expect, it } from "vitest";
import { getTrustPattern, isBashCommandTrusted } from "./bash-patterns.js";
import { requiresConfirmation } from "./confirmation.js";

// Commands are inert strings: no shell process or filesystem operation is run.
describe("shell trust binds to the complete approved invocation", () => {
  const approved = { command: "git status" };

  it("permits an exact repeat of the approved command-only bash_exec invocation", () => {
    const token = getTrustPattern("bash_exec", approved);
    expect(getTrustPattern("bash_exec", { ...approved })).toBe(token);
    expect(isBashCommandTrusted("git status", new Set([token]))).toBe(true);
  });

  it.each([
    "git status > sentinel.txt",
    "git status >> sentinel.txt",
    "git status < input.txt",
    "git status; printf changed",
    "git status && printf changed",
    "git status || printf changed",
    "git status | sh",
    "git status\nprintf changed",
    "(git status; printf changed)",
    "git status $(printf changed)",
    "git status `printf changed`",
    "git status ${EXTERNAL_ARGUMENT}",
    "git status <(printf changed)",
    "git status; printf changed --help",
    "git status --porcelain",
  ])("does not extend git status approval to %s", (command) => {
    const token = getTrustPattern("bash_exec", approved);
    expect(getTrustPattern("bash_exec", { command })).not.toBe(token);
    expect(isBashCommandTrusted(command, new Set([token]))).toBe(false);
    expect(requiresConfirmation("bash_exec", { command })).toBe(true);
  });

  it.each([
    { command: "git status", cwd: "/project-a" },
    { command: "git status", env: { GIT_DIR: "/other/repository" } },
    { command: "git status", timeout: 999 },
  ])("changing any invocation field requires a different approval: %j", (input) => {
    expect(getTrustPattern("bash_exec", input)).not.toBe(getTrustPattern("bash_exec", approved));
  });

  it("binds nested environment values and cwd, retaining an exact repeat", () => {
    const input = { command: "git status", cwd: "/project-a", env: { MODE: "safe" } };
    const token = getTrustPattern("bash_exec", input);
    expect(getTrustPattern("bash_exec", structuredClone(input))).toBe(token);
    expect(getTrustPattern("bash_exec", { ...input, cwd: "/project-b" })).not.toBe(token);
    input.env.MODE = "changed";
    expect(getTrustPattern("bash_exec", input)).not.toBe(token);
    // The command-only compatibility API must not consume contextual approval.
    expect(isBashCommandTrusted(input.command, new Set([token]))).toBe(false);
  });

  it("does not transfer approval between foreground and background shell tools", () => {
    const foreground = getTrustPattern("bash_exec", approved);
    const background = getTrustPattern("bash_background", approved);
    expect(background).not.toBe(foreground);
    expect(isBashCommandTrusted(approved.command, new Set([background]))).toBe(false);
    expect(getTrustPattern("bash_background", { ...approved })).toBe(background);
  });

  it.each([
    ["python -c 'print(1)'", "python -c 'print(2)'"],
    ["node -e 'console.log(1)'", "node -e 'console.log(2)'"],
    ["sh -c 'printf one'", "sh -c 'printf two'"],
  ])(
    "does not reuse interpreter approval when inline code changes: %s",
    (approvedCommand, changedCommand) => {
      const token = getTrustPattern("bash_exec", { command: approvedCommand });
      expect(isBashCommandTrusted(approvedCommand, new Set([token]))).toBe(true);
      expect(isBashCommandTrusted(changedCommand, new Set([token]))).toBe(false);
    },
  );

  it("rejects legacy executable/subcommand and bare shell-tool trust entries", () => {
    const legacy = new Set(["bash:git:status", "bash:git", "bash_exec", "bash_background"]);
    expect(isBashCommandTrusted("git status", legacy)).toBe(false);
    expect(isBashCommandTrusted("git status; printf changed", legacy)).toBe(false);
    expect(legacy.has(getTrustPattern("bash_exec", approved))).toBe(false);
  });

  it.each(["bash_exec", "bash_background"])(
    "requires confirmation for every %s invocation",
    (toolName) => {
      for (const command of [
        "git status",
        "ls",
        "echo hello",
        "git --help",
        "git --version",
        "unknown -h",
        "unknown -v",
        "printf changed; git --help",
      ]) {
        expect(requiresConfirmation(toolName, { command })).toBe(true);
      }
      expect(requiresConfirmation(toolName)).toBe(true);
      expect(requiresConfirmation(toolName, { command: 42 })).toBe(true);
    },
  );

  it("preserves non-shell tool-name trust behavior", () => {
    expect(getTrustPattern("write_file", { path: "a.txt", content: "a" })).toBe("write_file");
    expect(getTrustPattern("write_file", { path: "b.txt", content: "b" })).toBe("write_file");
    expect(getTrustPattern("git_push")).toBe("git_push");
    expect(requiresConfirmation("read_file", { path: "a.txt" })).toBe(false);
  });
});

/**
 * Clipboard utility for copying markdown content
 * Cross-platform support: macOS (pbcopy), Linux (xclip/xsel), Windows (clip)
 */

import { spawn } from "node:child_process";

/**
 * Detect available clipboard command based on platform
 */
function getClipboardCommand(): { command: string; args: string[] } | null {
  const platform = process.platform;

  if (platform === "darwin") {
    return { command: "pbcopy", args: [] };
  }

  if (platform === "linux") {
    return { command: "xclip", args: ["-selection", "clipboard"] };
  }

  if (platform === "win32") {
    return { command: "clip", args: [] };
  }

  return null;
}

/**
 * Copy text to system clipboard using spawn with stdin
 * This avoids shell escaping issues with special characters
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const clipboardCmd = getClipboardCommand();

  if (!clipboardCmd) {
    return false;
  }

  return new Promise((resolve) => {
    try {
      const proc = spawn(clipboardCmd.command, clipboardCmd.args, {
        stdio: ["pipe", "ignore", "ignore"],
      });

      let resolved = false;

      proc.on("error", (err) => {
        if (resolved) return;
        resolved = true;

        // Try xsel on Linux if xclip fails
        if (process.platform === "linux") {
          try {
            const xselProc = spawn("xsel", ["--clipboard", "--input"], {
              stdio: ["pipe", "ignore", "ignore"],
            });

            xselProc.on("error", () => resolve(false));
            xselProc.on("close", (code) => resolve(code === 0));

            xselProc.stdin.write(text);
            xselProc.stdin.end();
          } catch {
            resolve(false);
          }
        } else {
          resolve(false);
        }
      });

      proc.on("close", (code) => {
        if (resolved) return;
        resolved = true;
        resolve(code === 0);
      });

      proc.stdin.on("error", () => {
        // Ignore stdin errors, they'll be caught by close
      });

      proc.stdin.write(text);
      proc.stdin.end();
    } catch {
      resolve(false);
    }
  });
}

/**
 * Check if clipboard is available on this system
 */
export async function isClipboardAvailable(): Promise<boolean> {
  const clipboardCmd = getClipboardCommand();
  if (!clipboardCmd) return false;

  return new Promise((resolve) => {
    const testCmd = process.platform === "win32" ? "where" : "which";
    const proc = spawn(testCmd, [clipboardCmd.command], {
      stdio: ["ignore", "ignore", "ignore"],
    });

    proc.on("error", () => {
      // Try xsel on Linux
      if (process.platform === "linux") {
        const xselProc = spawn("which", ["xsel"], {
          stdio: ["ignore", "ignore", "ignore"],
        });
        xselProc.on("error", () => resolve(false));
        xselProc.on("close", (code) => resolve(code === 0));
      } else {
        resolve(false);
      }
    });

    proc.on("close", (code) => resolve(code === 0));
  });
}

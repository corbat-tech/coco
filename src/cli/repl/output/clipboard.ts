/**
 * Clipboard utility for copying markdown content and reading images
 * Cross-platform support: macOS (pbcopy/osascript), Linux (xclip/xsel), Windows (clip/PowerShell)
 */

import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

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

      proc.on("error", () => {
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

/**
 * Clipboard image data
 */
export interface ClipboardImageData {
  data: string; // base64
  media_type: string; // e.g. "image/png"
}

/**
 * Read image data from system clipboard.
 * Returns base64-encoded image data and MIME type, or null if no image in clipboard.
 *
 * - macOS: Uses osascript to extract PNGf data from clipboard
 * - Linux: Uses xclip with image/png target
 * - Windows: Uses PowerShell to access clipboard image
 */
export async function readClipboardImage(): Promise<ClipboardImageData | null> {
  const platform = process.platform;

  if (platform === "darwin") {
    return readClipboardImageMacOS();
  }
  if (platform === "linux") {
    return readClipboardImageLinux();
  }
  if (platform === "win32") {
    return readClipboardImageWindows();
  }

  return null;
}

/**
 * macOS: Read image from clipboard using osascript.
 * Writes clipboard PNG data to a temp file, then reads it as base64.
 */
async function readClipboardImageMacOS(): Promise<ClipboardImageData | null> {
  const tmpFile = path.join(os.tmpdir(), `coco-clipboard-${Date.now()}.png`);

  try {
    // Use osascript to write clipboard image (PNGf class) to temp file
    const script = `
set theFile to POSIX file "${tmpFile}"
try
  set theImage to the clipboard as «class PNGf»
  set fileRef to open for access theFile with write permission
  write theImage to fileRef
  close access fileRef
  return "ok"
on error errMsg
  return "error: " & errMsg
end try
`;
    const result = execFileSync("osascript", ["-e", script], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"], // suppress stderr (JP2 color space warnings from macOS ImageIO)
    }).trim();

    if (!result.startsWith("ok")) {
      return null;
    }

    // Read file as base64
    const buffer = await fs.readFile(tmpFile);
    return {
      data: buffer.toString("base64"),
      media_type: "image/png",
    };
  } catch {
    return null;
  } finally {
    // Clean up temp file
    try {
      await fs.unlink(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Linux: Read clipboard image using xclip
 */
async function readClipboardImageLinux(): Promise<ClipboardImageData | null> {
  try {
    // Check available clipboard targets
    const targets = execFileSync("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"], // suppress stderr
    });

    if (!targets.includes("image/png")) {
      return null;
    }

    // Read PNG data
    const buffer = execFileSync("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"], {
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"], // suppress stderr
    });

    return {
      data: Buffer.from(buffer).toString("base64"),
      media_type: "image/png",
    };
  } catch {
    return null;
  }
}

/**
 * Windows: Read clipboard image using PowerShell
 */
async function readClipboardImageWindows(): Promise<ClipboardImageData | null> {
  const tmpFile = path.join(os.tmpdir(), `coco-clipboard-${Date.now()}.png`);

  try {
    const escapedPath = tmpFile.replace(/'/g, "''");
    const script = `
Add-Type -AssemblyName System.Windows.Forms;
$img = [System.Windows.Forms.Clipboard]::GetImage();
if ($img -ne $null) {
  $img.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png);
  Write-Output 'ok';
} else {
  Write-Output 'no-image';
}
`;
    const result = execFileSync("powershell", ["-Command", script], {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();

    if (result !== "ok") return null;

    const buffer = await fs.readFile(tmpFile);
    return {
      data: buffer.toString("base64"),
      media_type: "image/png",
    };
  } catch {
    return null;
  } finally {
    try {
      await fs.unlink(tmpFile);
    } catch {
      // Ignore
    }
  }
}

/**
 * Check if clipboard image reading is available on this system
 */
export function isClipboardImageAvailable(): boolean {
  const platform = process.platform;
  // macOS: osascript always available
  // Windows: PowerShell always available
  // Linux: requires xclip
  return platform === "darwin" || platform === "win32" || platform === "linux";
}

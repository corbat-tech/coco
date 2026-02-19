/**
 * Platform detection utilities for Corbat-Coco
 */

import { readFileSync } from "node:fs";

function detectWSL(): boolean {
  // Primary: env vars set by WSL itself
  if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) return true;
  // Fallback: kernel version string (covers WSL1 and cases where env vars are stripped)
  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf-8"));
  } catch {
    return false;
  }
}

/**
 * True if the process is running inside Windows Subsystem for Linux.
 * WSL reports platform as "linux" but has no display server;
 * use Windows commands (cmd.exe) to open browser or files.
 *
 * Memoized — computed once at module load, never changes during process lifetime.
 */
export const isWSL: boolean = detectWSL();

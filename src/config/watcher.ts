/**
 * Configuration file watcher for hot reload
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { loadConfig } from "./loader.js";
import type { CocoConfig } from "./schema.js";

/**
 * Config watcher events
 */
export interface ConfigWatcherEvents {
  change: (config: CocoConfig) => void;
  error: (error: Error) => void;
}

/**
 * Config watcher options
 */
export interface ConfigWatcherOptions {
  /** Debounce time in ms (default: 100) */
  debounceMs?: number;
  /** Auto-reload on change (default: true) */
  autoReload?: boolean;
}

/**
 * Configuration file watcher
 */
export class ConfigWatcher extends EventEmitter {
  private watcher: fs.FSWatcher | null = null;
  private configPath: string;
  private options: Required<ConfigWatcherOptions>;
  private debounceTimer: NodeJS.Timeout | null = null;
  private currentConfig: CocoConfig | null = null;
  private isWatching = false;

  constructor(configPath: string, options: ConfigWatcherOptions = {}) {
    super();
    this.configPath = configPath;
    this.options = {
      debounceMs: options.debounceMs ?? 100,
      autoReload: options.autoReload ?? true,
    };
  }

  /**
   * Start watching the config file
   */
  async start(): Promise<void> {
    if (this.isWatching) return;

    // Load initial config
    try {
      this.currentConfig = await loadConfig(this.configPath);
    } catch (error) {
      // Config might not exist yet
      this.currentConfig = null;
    }

    // Ensure directory exists
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Watch the directory (more reliable than watching file directly)
    this.watcher = fs.watch(dir, (_eventType, filename) => {
      if (filename === path.basename(this.configPath)) {
        this.handleChange();
      }
    });

    this.watcher.on("error", (error) => {
      this.emit("error", error);
    });

    this.isWatching = true;
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.isWatching = false;
  }

  /**
   * Get current config
   */
  getConfig(): CocoConfig | null {
    return this.currentConfig;
  }

  /**
   * Check if watching
   */
  isActive(): boolean {
    return this.isWatching;
  }

  /**
   * Handle file change with debouncing
   */
  private handleChange(): void {
    if (!this.options.autoReload) return;

    // Debounce rapid changes
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      try {
        const newConfig = await loadConfig(this.configPath);

        // Only emit if config actually changed
        if (JSON.stringify(newConfig) !== JSON.stringify(this.currentConfig)) {
          this.currentConfig = newConfig;
          this.emit("change", newConfig);
        }
      } catch (error) {
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      }
    }, this.options.debounceMs);
  }
}

/**
 * Create a config watcher
 */
export function createConfigWatcher(
  configPath: string,
  options?: ConfigWatcherOptions
): ConfigWatcher {
  return new ConfigWatcher(configPath, options);
}

/**
 * Watch config with callback
 */
export async function watchConfig(
  configPath: string,
  onChange: (config: CocoConfig) => void,
  onError?: (error: Error) => void
): Promise<() => void> {
  const watcher = createConfigWatcher(configPath);

  watcher.on("change", onChange);
  if (onError) {
    watcher.on("error", onError);
  }

  await watcher.start();

  // Return stop function
  return () => watcher.stop();
}

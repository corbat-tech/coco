/**
 * Command Heartbeat Monitor
 *
 * Provides real-time feedback for long-running shell commands by:
 * - Tracking elapsed time since command started
 * - Tracking time since last activity (silence duration)
 * - Emitting periodic updates every 10 seconds
 * - Warning when command has been silent for >30 seconds
 */

export interface HeartbeatCallbacks {
  /** Called every updateIntervalSeconds with current statistics */
  onUpdate?: (stats: HeartbeatStats) => void;
  /** Called when command silent for >= warnThreshold seconds */
  onWarn?: (message: string) => void;
}

export interface HeartbeatStats {
  /** Total seconds since command started */
  elapsedSeconds: number;
  /** Seconds since last activity() call */
  silentSeconds: number;
}

/**
 * CommandHeartbeat monitors long-running commands and provides periodic feedback
 *
 * Usage:
 * ```typescript
 * const heartbeat = new CommandHeartbeat({
 *   onUpdate: (stats) => console.log(`⏱️  ${stats.elapsedSeconds}s elapsed`),
 *   onWarn: (msg) => console.warn(msg),
 * });
 *
 * heartbeat.start();
 *
 * // In stdout/stderr handlers:
 * subprocess.stdout.on('data', (chunk) => {
 *   heartbeat.activity(); // Reset silence timer
 * });
 *
 * // When done:
 * heartbeat.stop();
 * ```
 */
export class CommandHeartbeat {
  private startTime: number = 0;
  private lastActivityTime: number = 0;
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly warnThreshold: number = 30; // seconds
  private readonly updateIntervalSeconds: number = 10; // seconds
  private readonly callbacks: HeartbeatCallbacks;

  constructor(callbacks: HeartbeatCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * Start monitoring - begins periodic updates and silence warnings
   */
  start(): void {
    this.startTime = Date.now();
    this.lastActivityTime = Date.now();

    // Start periodic update interval
    this.updateInterval = setInterval(() => {
      const stats = this.getStats();
      this.callbacks.onUpdate?.(stats);

      // Warn if silent for too long
      if (stats.silentSeconds >= this.warnThreshold) {
        this.callbacks.onWarn?.(`⚠️  Command silent for ${stats.silentSeconds}s`);
      }
    }, this.updateIntervalSeconds * 1000);
  }

  /**
   * Register activity - call this when command produces output
   * Resets the silence timer
   */
  activity(): void {
    this.lastActivityTime = Date.now();
  }

  /**
   * Stop monitoring - clears periodic interval
   * Should be called in finally{} block to ensure cleanup
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Get current heartbeat statistics
   */
  getStats(): HeartbeatStats {
    const now = Date.now();
    return {
      elapsedSeconds: Math.floor((now - this.startTime) / 1000),
      silentSeconds: Math.floor((now - this.lastActivityTime) / 1000),
    };
  }
}

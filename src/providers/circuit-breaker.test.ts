/**
 * Tests for circuit breaker implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CircuitBreaker,
  CircuitOpenError,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  createCircuitBreaker,
} from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
  describe("DEFAULT_CIRCUIT_BREAKER_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold).toBe(5);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeout).toBe(30000);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.halfOpenRequests).toBe(1);
    });
  });

  describe("initial state", () => {
    it("should start in closed state", () => {
      const breaker = new CircuitBreaker();
      expect(breaker.getState()).toBe("closed");
    });

    it("should not be open initially", () => {
      const breaker = new CircuitBreaker();
      expect(breaker.isOpen()).toBe(false);
    });

    it("should have zero failure count initially", () => {
      const breaker = new CircuitBreaker();
      expect(breaker.getFailureCount()).toBe(0);
    });
  });

  describe("recording successes", () => {
    it("should keep circuit closed on success", () => {
      const breaker = new CircuitBreaker();
      breaker.recordSuccess();
      expect(breaker.getState()).toBe("closed");
    });

    it("should reset failure count on success in closed state", () => {
      const breaker = new CircuitBreaker();
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getFailureCount()).toBe(2);

      breaker.recordSuccess();
      expect(breaker.getFailureCount()).toBe(0);
    });
  });

  describe("recording failures", () => {
    it("should increment failure count", () => {
      const breaker = new CircuitBreaker();
      breaker.recordFailure();
      expect(breaker.getFailureCount()).toBe(1);

      breaker.recordFailure();
      expect(breaker.getFailureCount()).toBe(2);
    });

    it("should remain closed below failure threshold", () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe("closed");
      expect(breaker.isOpen()).toBe(false);
    });
  });

  describe("circuit opening", () => {
    it("should open after reaching failure threshold", () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });

      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe("closed");

      breaker.recordFailure();
      expect(breaker.getState()).toBe("open");
      expect(breaker.isOpen()).toBe(true);
    });

    it("should open with custom failure threshold", () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 });

      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(false);

      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(true);
    });
  });

  describe("circuit reset timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should transition to half-open after reset timeout", () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 1000,
      });

      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe("open");

      // Advance time past reset timeout
      vi.advanceTimersByTime(1001);

      // State should now be half-open
      expect(breaker.getState()).toBe("half-open");
    });

    it("should remain open before reset timeout", () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 1000,
      });

      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getState()).toBe("open");

      // Advance time but not past timeout
      vi.advanceTimersByTime(500);

      // State should still be open
      expect(breaker.getState()).toBe("open");
    });
  });

  describe("half-open state", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should close after enough successes in half-open state", () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 1000,
        halfOpenRequests: 2,
      });

      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();

      // Transition to half-open
      vi.advanceTimersByTime(1001);
      expect(breaker.getState()).toBe("half-open");

      // First success
      breaker.recordSuccess();
      expect(breaker.getState()).toBe("half-open");

      // Second success closes the circuit
      breaker.recordSuccess();
      expect(breaker.getState()).toBe("closed");
      expect(breaker.getFailureCount()).toBe(0);
    });

    it("should re-open on failure in half-open state", () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 1000,
      });

      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();

      // Transition to half-open
      vi.advanceTimersByTime(1001);
      expect(breaker.getState()).toBe("half-open");

      // Failure in half-open reopens the circuit
      breaker.recordFailure();
      expect(breaker.getState()).toBe("open");
    });
  });

  describe("execute method", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should execute function when circuit is closed", async () => {
      const breaker = new CircuitBreaker();
      const fn = vi.fn().mockResolvedValue("success");

      const result = await breaker.execute(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should record success on successful execution", async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3 });

      // Add some failures first
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.getFailureCount()).toBe(2);

      await breaker.execute(async () => "ok");

      expect(breaker.getFailureCount()).toBe(0);
    });

    it("should record failure and rethrow on failed execution", async () => {
      const breaker = new CircuitBreaker();
      const error = new Error("test error");
      const fn = vi.fn().mockRejectedValue(error);

      await expect(breaker.execute(fn)).rejects.toThrow("test error");
      expect(breaker.getFailureCount()).toBe(1);
    });

    it("should throw CircuitOpenError when circuit is open", async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 5000,
      }, "test-provider");

      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();

      const fn = vi.fn().mockResolvedValue("never called");

      await expect(breaker.execute(fn)).rejects.toThrow(CircuitOpenError);
      await expect(breaker.execute(fn)).rejects.toThrow(
        "Circuit breaker is open for provider: test-provider"
      );
      expect(fn).not.toHaveBeenCalled();
    });

    it("should allow execution in half-open state", async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 1000,
      });

      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();

      // Transition to half-open
      vi.advanceTimersByTime(1001);
      expect(breaker.getState()).toBe("half-open");

      // Should allow execution
      const fn = vi.fn().mockResolvedValue("success");
      const result = await breaker.execute(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should close circuit after successful execution in half-open", async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 1000,
        halfOpenRequests: 1,
      });

      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();

      // Transition to half-open
      vi.advanceTimersByTime(1001);

      // Execute successfully
      await breaker.execute(async () => "success");

      expect(breaker.getState()).toBe("closed");
    });

    it("should re-open circuit after failed execution in half-open", async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 1000,
      });

      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();

      // Transition to half-open
      vi.advanceTimersByTime(1001);
      expect(breaker.getState()).toBe("half-open");

      // Execute with failure
      await expect(
        breaker.execute(async () => {
          throw new Error("failure");
        })
      ).rejects.toThrow();

      expect(breaker.getState()).toBe("open");
    });
  });

  describe("reset method", () => {
    it("should reset circuit to closed state", () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2 });

      // Open the circuit
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(true);

      // Reset
      breaker.reset();

      expect(breaker.getState()).toBe("closed");
      expect(breaker.getFailureCount()).toBe(0);
      expect(breaker.isOpen()).toBe(false);
    });
  });

  describe("CircuitOpenError", () => {
    it("should contain remaining time information", () => {
      const error = new CircuitOpenError("test-provider", 5000);

      expect(error.name).toBe("CircuitOpenError");
      expect(error.remainingTime).toBe(5000);
      expect(error.provider).toBe("test-provider");
      expect(error.message).toContain("test-provider");
    });
  });

  describe("createCircuitBreaker factory", () => {
    it("should create circuit breaker with default config", () => {
      const breaker = createCircuitBreaker();
      expect(breaker.getState()).toBe("closed");
    });

    it("should create circuit breaker with custom config", () => {
      const breaker = createCircuitBreaker({ failureThreshold: 10 });

      // Add 9 failures - should still be closed
      for (let i = 0; i < 9; i++) {
        breaker.recordFailure();
      }
      expect(breaker.isOpen()).toBe(false);

      // 10th failure opens it
      breaker.recordFailure();
      expect(breaker.isOpen()).toBe(true);
    });

    it("should create circuit breaker with provider ID", () => {
      const breaker = createCircuitBreaker({ failureThreshold: 1 }, "my-provider");
      breaker.recordFailure();

      expect(breaker.isOpen()).toBe(true);
      // The provider ID is used in error messages
    });
  });

  describe("integration scenario", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should handle complete lifecycle: closed -> open -> half-open -> closed", async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 5000,
        halfOpenRequests: 1,
      });

      // Start closed
      expect(breaker.getState()).toBe("closed");

      // Failures open the circuit
      await expect(
        breaker.execute(async () => {
          throw new Error("fail 1");
        })
      ).rejects.toThrow();
      await expect(
        breaker.execute(async () => {
          throw new Error("fail 2");
        })
      ).rejects.toThrow();

      expect(breaker.getState()).toBe("open");

      // Calls are blocked while open
      await expect(breaker.execute(async () => "blocked")).rejects.toThrow(
        CircuitOpenError
      );

      // Time passes, circuit becomes half-open
      vi.advanceTimersByTime(5001);
      expect(breaker.getState()).toBe("half-open");

      // Successful call closes the circuit
      const result = await breaker.execute(async () => "success");
      expect(result).toBe("success");
      expect(breaker.getState()).toBe("closed");
    });

    it("should handle repeated failures with recovery", async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 1000,
        halfOpenRequests: 1,
      });

      const failingFn = async () => {
        throw new Error("service down");
      };
      const successFn = async () => "recovered";

      // First round of failures
      await expect(breaker.execute(failingFn)).rejects.toThrow();
      await expect(breaker.execute(failingFn)).rejects.toThrow();
      expect(breaker.getState()).toBe("open");

      // Wait for half-open
      vi.advanceTimersByTime(1001);

      // Failure in half-open reopens
      await expect(breaker.execute(failingFn)).rejects.toThrow();
      expect(breaker.getState()).toBe("open");

      // Wait for half-open again
      vi.advanceTimersByTime(1001);

      // Success this time closes the circuit
      const result = await breaker.execute(successFn);
      expect(result).toBe("recovered");
      expect(breaker.getState()).toBe("closed");
    });
  });
});

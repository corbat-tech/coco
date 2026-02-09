/**
 * Tests for Test Quality Analyzer
 */

import { describe, it, expect, afterAll } from "vitest";
import { TestQualityAnalyzer } from "./test-quality.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { glob } from "glob";

describe("TestQualityAnalyzer", () => {
  describe("Trivial Assertion Detection", () => {
    it("should report low trivialAssertionRatio when using substantive matchers", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "service.test.ts"),
        `
        import { describe, it, expect } from "vitest";

        describe("UserService", () => {
          it("should return user by id", () => {
            const user = getUser(1);
            expect(user.name).toBe("Alice");
            expect(user.age).toBe(30);
            expect(user.email).toBe("alice@example.com");
          });

          it("should filter users by role", () => {
            const admins = filterByRole("admin");
            expect(admins.length).toBe(2);
            expect(admins[0].role).toBe("admin");
          });

          it("should calculate total balance", () => {
            const total = calculateBalance([100, 200, 300]);
            expect(total).toBe(600);
          });
        });
      `,
      );

      const analyzer = new TestQualityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "service.test.ts")]);

      expect(result.trivialAssertionRatio).toBe(0);
      expect(result.totalAssertions).toBe(6);
      expect(result.trivialAssertions).toBe(0);
      expect(result.totalTests).toBe(3);
    });

    it("should report high trivialAssertionRatio for toBeDefined/toBeTruthy-only tests", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "weak.test.ts"),
        `
        import { describe, it, expect } from "vitest";

        describe("WeakTests", () => {
          it("should have a result", () => {
            const result = compute();
            expect(result).toBeDefined();
          });

          it("should be truthy", () => {
            const value = getValue();
            expect(value).toBeTruthy();
          });

          it("should not be null", () => {
            const item = findItem();
            expect(item).not.toBeNull();
          });

          it("should be a boolean", () => {
            const flag = getFlag();
            expect(flag).toBe(true);
          });

          it("should be an instance", () => {
            const obj = create();
            expect(obj).toBeInstanceOf(MyClass);
          });
        });
      `,
      );

      const analyzer = new TestQualityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "weak.test.ts")]);

      // All 5 assertions are trivial
      expect(result.trivialAssertions).toBe(5);
      expect(result.totalAssertions).toBe(5);
      expect(result.trivialAssertionRatio).toBe(100);
      // With 100% trivial ratio, penalty = 40, and 1 assertion/test density penalty = 10
      // score should be well below a test with zero trivials
      expect(result.score).toBeLessThan(60);
    });

    it("should produce lower score for all-trivial vs no-trivial tests", async () => {
      const tempDir = await createTempProject();

      await writeFile(
        join(tempDir, "good.test.ts"),
        `
        import { describe, it, expect } from "vitest";
        describe("Good", () => {
          it("adds numbers", () => {
            expect(add(1, 2)).toBe(3);
            expect(add(-1, 1)).toBe(0);
          });
          it("subtracts numbers", () => {
            expect(subtract(5, 3)).toBe(2);
            expect(subtract(0, 0)).toBe(0);
          });
        });
      `,
      );

      await writeFile(
        join(tempDir, "bad.test.ts"),
        `
        import { describe, it, expect } from "vitest";
        describe("Bad", () => {
          it("returns something", () => {
            expect(add(1, 2)).toBeDefined();
            expect(add(1, 2)).toBeTruthy();
          });
          it("returns something else", () => {
            expect(subtract(5, 3)).toBeDefined();
            expect(subtract(5, 3)).toBeTruthy();
          });
        });
      `,
      );

      const goodAnalyzer = new TestQualityAnalyzer(tempDir);
      const goodResult = await goodAnalyzer.analyze([join(tempDir, "good.test.ts")]);

      const badAnalyzer = new TestQualityAnalyzer(tempDir);
      const badResult = await badAnalyzer.analyze([join(tempDir, "bad.test.ts")]);

      expect(goodResult.score).toBeGreaterThan(badResult.score);
      expect(goodResult.trivialAssertionRatio).toBe(0);
      expect(badResult.trivialAssertionRatio).toBe(100);
    });
  });

  describe("Edge Case Detection", () => {
    it("should detect edge case tests by name patterns", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "edge.test.ts"),
        `
        import { describe, it, expect } from "vitest";

        describe("Parser", () => {
          it("should handle error when input is malformed", () => {
            expect(() => parse("<<<")).toThrow();
          });

          it("should handle invalid input gracefully", () => {
            expect(parse(null)).toEqual({ error: "invalid" });
          });

          it("should handle empty string", () => {
            expect(parse("")).toEqual({});
          });

          it("should reject negative numbers", () => {
            expect(() => parse(-1)).toThrow("negative");
          });

          it("should handle null values", () => {
            expect(parse(null)).toEqual({ error: "null" });
          });

          it("should parse valid json", () => {
            expect(parse('{"a":1}')).toEqual({ a: 1 });
          });
        });
      `,
      );

      const analyzer = new TestQualityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "edge.test.ts")]);

      // 5 of 6 tests match edge case patterns (error, invalid, empty, negative, null)
      expect(result.edgeCaseTests).toBe(5);
      expect(result.totalTests).toBe(6);
      expect(result.edgeCaseRatio).toBeCloseTo((5 / 6) * 100, 0);
      // High edge case ratio gives bonus points (ratio > 10%)
      expect(result.edgeCaseRatio).toBeGreaterThan(10);
    });

    it("should report zero edgeCaseTests when no names match patterns", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "plain.test.ts"),
        `
        import { describe, it, expect } from "vitest";

        describe("Calculator", () => {
          it("adds two numbers", () => {
            expect(add(1, 2)).toBe(3);
          });

          it("multiplies two numbers", () => {
            expect(multiply(3, 4)).toBe(12);
          });

          it("divides two numbers", () => {
            expect(divide(10, 2)).toBe(5);
          });
        });
      `,
      );

      const analyzer = new TestQualityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "plain.test.ts")]);

      expect(result.edgeCaseTests).toBe(0);
      expect(result.edgeCaseRatio).toBe(0);
    });
  });

  describe("Assertion Diversity", () => {
    it("should measure high diversity for diverse matchers", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "diverse.test.ts"),
        `
        import { describe, it, expect, vi } from "vitest";

        describe("Diverse", () => {
          it("uses toEqual", () => {
            expect({ a: 1 }).toEqual({ a: 1 });
          });

          it("uses toContain", () => {
            expect([1, 2, 3]).toContain(2);
          });

          it("uses toThrow", () => {
            expect(() => { throw new Error("oops"); }).toThrow("oops");
          });

          it("uses toHaveBeenCalledWith", () => {
            const fn = vi.fn();
            fn("arg1", "arg2");
            expect(fn).toHaveBeenCalledWith("arg1", "arg2");
          });

          it("uses toMatch", () => {
            expect("hello world").toMatch(/hello/);
          });

          it("uses toHaveLength", () => {
            expect([1, 2, 3]).toHaveLength(3);
          });

          it("uses toBeGreaterThan", () => {
            expect(10).toBeGreaterThan(5);
          });

          it("uses toBeLessThan", () => {
            expect(3).toBeLessThan(7);
          });
        });
      `,
      );

      const analyzer = new TestQualityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "diverse.test.ts")]);

      // 8 different matchers out of 16 = 50% diversity
      expect(result.assertionDiversity).toBeGreaterThanOrEqual(50);
      // Diversity > 30% gives a bonus, so score should be higher
      expect(result.score).toBeGreaterThanOrEqual(90);
    });

    it("should measure low diversity when only toBe is used", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "monotone.test.ts"),
        `
        import { describe, it, expect } from "vitest";

        describe("Monotone", () => {
          it("test 1", () => {
            expect(compute(1)).toBe(2);
            expect(compute(2)).toBe(4);
          });

          it("test 2", () => {
            expect(compute(3)).toBe(6);
            expect(compute(4)).toBe(8);
          });

          it("test 3", () => {
            expect(compute(5)).toBe(10);
            expect(compute(6)).toBe(12);
          });
        });
      `,
      );

      const analyzer = new TestQualityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "monotone.test.ts")]);

      // Only 1 matcher (toBe) out of 16 = ~6.25%
      expect(result.assertionDiversity).toBeCloseTo((1 / 16) * 100, 0);
      expect(result.assertionDiversity).toBeLessThan(30);
    });
  });

  describe("Assertion Density", () => {
    it("should calculate correct assertionDensity (assertions per test)", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "dense.test.ts"),
        `
        import { describe, it, expect } from "vitest";

        describe("Dense", () => {
          it("validates user object thoroughly", () => {
            const user = createUser("Alice", 30);
            expect(user.name).toBe("Alice");
            expect(user.age).toBe(30);
            expect(user.id).toMatch(/^usr_/);
            expect(user.createdAt).toBeInstanceOf(Date);
          });

          it("validates order creation", () => {
            const order = createOrder(user, [item1, item2]);
            expect(order.total).toBe(150);
            expect(order.items).toHaveLength(2);
            expect(order.status).toBe("pending");
          });
        });
      `,
      );

      const analyzer = new TestQualityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "dense.test.ts")]);

      // 7 assertions / 2 tests = 3.5
      expect(result.assertionDensity).toBe(3.5);
      expect(result.totalAssertions).toBe(7);
      expect(result.totalTests).toBe(2);
    });

    it("should penalize low assertion density (< 2 assertions per test)", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "sparse.test.ts"),
        `
        import { describe, it, expect } from "vitest";

        describe("Sparse", () => {
          it("test a", () => {
            expect(fn()).toBe(1);
          });

          it("test b", () => {
            expect(fn()).toBe(2);
          });

          it("test c", () => {
            expect(fn()).toBe(3);
          });
        });
      `,
      );

      const analyzer = new TestQualityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "sparse.test.ts")]);

      // density = 3/3 = 1.0, which is < 2
      expect(result.assertionDensity).toBe(1);
      // Penalty: (2 - 1) * 10 = 10 points off from 100
      expect(result.score).toBe(90);
    });
  });

  describe("No Test Files", () => {
    it("should return score 0 when no test files are found", async () => {
      const tempDir = await createTempProject();
      // Create a source file but no test file
      await writeFile(
        join(tempDir, "utils.ts"),
        `export function add(a: number, b: number): number { return a + b; }`,
      );

      const analyzer = new TestQualityAnalyzer(tempDir);
      const result = await analyzer.analyze([]);

      expect(result.score).toBe(0);
      expect(result.totalTests).toBe(0);
      expect(result.totalAssertions).toBe(0);
      expect(result.totalTestFiles).toBe(0);
    });

    it("should return score 0 when test file has no test declarations", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "helpers.test.ts"),
        `
        // This file has no it() or test() blocks
        import { describe } from "vitest";
        describe("Empty", () => {
          // nothing here
        });
      `,
      );

      const analyzer = new TestQualityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "helpers.test.ts")]);

      expect(result.score).toBe(0);
      expect(result.totalTests).toBe(0);
      expect(result.totalAssertions).toBe(0);
      expect(result.totalTestFiles).toBe(1);
    });
  });

  describe("Score Calculation", () => {
    it("should return 100 for ideal tests (high density, no trivials, some diversity)", async () => {
      const tempDir = await createTempProject();
      await writeFile(
        join(tempDir, "ideal.test.ts"),
        `
        import { describe, it, expect } from "vitest";

        describe("Ideal", () => {
          it("should handle valid input", () => {
            expect(process("hello")).toEqual({ result: "HELLO" });
            expect(process("world")).toEqual({ result: "WORLD" });
            expect(process("")).toEqual({ result: "" });
          });

          it("should handle error cases", () => {
            expect(() => process(null)).toThrow("invalid input");
            expect(() => process(undefined)).toThrow("invalid input");
          });

          it("should contain expected values", () => {
            const results = processMany(["a", "b", "c"]);
            expect(results).toContain("A");
            expect(results).toHaveLength(3);
          });
        });
      `,
      );

      const analyzer = new TestQualityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "ideal.test.ts")]);

      expect(result.trivialAssertionRatio).toBe(0);
      expect(result.assertionDensity).toBeGreaterThanOrEqual(2);
      // Score should be near or at 100 (no penalties, possibly small bonuses)
      expect(result.score).toBeGreaterThanOrEqual(95);
    });

    it("should cap score between 0 and 100", async () => {
      const tempDir = await createTempProject();
      // File with heavy edge cases and diverse matchers to test bonus caps
      await writeFile(
        join(tempDir, "bonus.test.ts"),
        `
        import { describe, it, expect, vi } from "vitest";

        describe("Bonus", () => {
          it("should handle error for null", () => {
            expect(() => fn(null)).toThrow("error");
            expect(fn.calls).toHaveLength(0);
          });
          it("should handle invalid empty boundary", () => {
            expect(validate("")).toEqual({ valid: false });
            expect(validate("x")).toContain("x");
          });
          it("should handle missing overflow reject", () => {
            const spy = vi.fn();
            spy();
            expect(spy).toHaveBeenCalled();
            expect(compute(999)).toBeGreaterThan(100);
          });
          it("should handle timeout negative fail", () => {
            expect(retry(-1)).toBeLessThan(0);
            expect(retry(0)).toMatch(/zero/);
          });
          it("should handle corrupt malformed throw", () => {
            expect(() => parse("bad")).toThrow();
            expect(parse("ok")).toHaveProperty("data");
          });
        });
      `,
      );

      const analyzer = new TestQualityAnalyzer(tempDir);
      const result = await analyzer.analyze([join(tempDir, "bonus.test.ts")]);

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe("Multiple File Aggregation", () => {
    it("should aggregate metrics across multiple test files", async () => {
      const tempDir = await createTempProject();

      await writeFile(
        join(tempDir, "a.test.ts"),
        `
        import { describe, it, expect } from "vitest";
        describe("A", () => {
          it("test 1", () => {
            expect(1).toBe(1);
            expect(2).toBe(2);
          });
        });
      `,
      );

      await writeFile(
        join(tempDir, "b.test.ts"),
        `
        import { describe, it, expect } from "vitest";
        describe("B", () => {
          it("test 2", () => {
            expect("a").toEqual("a");
            expect("b").toContain("b");
          });
          it("should handle error", () => {
            expect(() => {}).toThrow;
          });
        });
      `,
      );

      const analyzer = new TestQualityAnalyzer(tempDir);
      const result = await analyzer.analyze([
        join(tempDir, "a.test.ts"),
        join(tempDir, "b.test.ts"),
      ]);

      expect(result.totalTestFiles).toBe(2);
      // 1 test from a.test.ts + 2 tests from b.test.ts
      expect(result.totalTests).toBe(3);
      // 2 assertions from a + 3 from b (expect(() => {}).toThrow is still an expect call) = 5
      expect(result.totalAssertions).toBe(5);
      // 1 edge case test: "should handle error"
      expect(result.edgeCaseTests).toBe(1);
      // Matchers used: toBe, toEqual, toContain, toThrow => 4 unique
      expect(result.assertionDiversity).toBeCloseTo((4 / 16) * 100, 0);
    });
  });

  afterAll(async () => {
    const tempDirs = await glob(join(tmpdir(), "coco-testquality-test-*"));
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function createTempProject(): Promise<string> {
  const tempDir = join(
    tmpdir(),
    `coco-testquality-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tempDir, { recursive: true });
  return tempDir;
}

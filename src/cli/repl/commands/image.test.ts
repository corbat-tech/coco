/**
 * Tests for image command state management (multi-image support)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  hasPendingImage,
  setPendingImage,
  consumePendingImages,
  getPendingImageCount,
} from "./image.js";

// Reset state between tests
beforeEach(() => {
  // Consume any leftover images to reset state
  consumePendingImages();
});

describe("Multi-image state management", () => {
  describe("hasPendingImage", () => {
    it("returns false when no images pending", () => {
      expect(hasPendingImage()).toBe(false);
    });

    it("returns true after setPendingImage", () => {
      setPendingImage("data1", "image/png", "describe this");
      expect(hasPendingImage()).toBe(true);
    });

    it("returns false after consuming all images", () => {
      setPendingImage("data1", "image/png", "prompt");
      consumePendingImages();
      expect(hasPendingImage()).toBe(false);
    });
  });

  describe("getPendingImageCount", () => {
    it("returns 0 when no images pending", () => {
      expect(getPendingImageCount()).toBe(0);
    });

    it("returns 1 after one setPendingImage call", () => {
      setPendingImage("data1", "image/png", "prompt");
      expect(getPendingImageCount()).toBe(1);
    });

    it("returns 2 after two setPendingImage calls", () => {
      setPendingImage("data1", "image/png", "prompt 1");
      setPendingImage("data2", "image/jpeg", "prompt 2");
      expect(getPendingImageCount()).toBe(2);
    });

    it("returns 3 after three setPendingImage calls", () => {
      setPendingImage("data1", "image/png", "prompt 1");
      setPendingImage("data2", "image/png", "prompt 2");
      setPendingImage("data3", "image/png", "prompt 3");
      expect(getPendingImageCount()).toBe(3);
    });

    it("returns 0 after consuming images", () => {
      setPendingImage("data1", "image/png", "prompt");
      consumePendingImages();
      expect(getPendingImageCount()).toBe(0);
    });
  });

  describe("setPendingImage — appends instead of replacing", () => {
    it("accumulates multiple images", () => {
      setPendingImage("data1", "image/png", "first");
      setPendingImage("data2", "image/jpeg", "second");
      const images = consumePendingImages();
      expect(images).toHaveLength(2);
    });

    it("preserves insertion order", () => {
      setPendingImage("data1", "image/png", "first");
      setPendingImage("data2", "image/jpeg", "second");
      const images = consumePendingImages();
      expect(images[0]?.data).toBe("data1");
      expect(images[1]?.data).toBe("data2");
    });

    it("preserves media_type per image", () => {
      setPendingImage("data1", "image/png", "prompt");
      setPendingImage("data2", "image/jpeg", "prompt");
      const images = consumePendingImages();
      expect(images[0]?.media_type).toBe("image/png");
      expect(images[1]?.media_type).toBe("image/jpeg");
    });

    it("preserves prompt per image", () => {
      setPendingImage("data1", "image/png", "first prompt");
      setPendingImage("data2", "image/png", "second prompt");
      const images = consumePendingImages();
      expect(images[0]?.prompt).toBe("first prompt");
      expect(images[1]?.prompt).toBe("second prompt");
    });
  });

  describe("consumePendingImages", () => {
    it("returns empty array when no images pending", () => {
      const result = consumePendingImages();
      expect(result).toEqual([]);
    });

    it("returns all pending images", () => {
      setPendingImage("data1", "image/png", "prompt 1");
      setPendingImage("data2", "image/jpeg", "prompt 2");
      const result = consumePendingImages();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ data: "data1", media_type: "image/png", prompt: "prompt 1" });
      expect(result[1]).toEqual({ data: "data2", media_type: "image/jpeg", prompt: "prompt 2" });
    });

    it("clears state after consuming", () => {
      setPendingImage("data1", "image/png", "prompt");
      consumePendingImages();
      const second = consumePendingImages();
      expect(second).toEqual([]);
    });

    it("is idempotent on empty state", () => {
      expect(consumePendingImages()).toEqual([]);
      expect(consumePendingImages()).toEqual([]);
    });
  });
});

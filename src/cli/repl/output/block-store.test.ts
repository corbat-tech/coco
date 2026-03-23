/**
 * Tests for block-store module
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  storeBlock,
  getBlock,
  getLastBlock,
  getBlockCount,
  resetBlockStore,
} from "./block-store.js";

beforeEach(() => {
  resetBlockStore();
});

describe("storeBlock", () => {
  it("returns 1-based ID for first block", () => {
    const id = storeBlock("sql", ["SELECT 1;"]);
    expect(id).toBe(1);
  });

  it("increments IDs sequentially", () => {
    const id1 = storeBlock("sql", ["SELECT 1;"]);
    const id2 = storeBlock("ts", ["const x = 1;"]);
    const id3 = storeBlock("bash", ["echo hello"]);
    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(id3).toBe(3);
  });

  it("joins lines with newline for content", () => {
    storeBlock("sql", ["SELECT 1;", "SELECT 2;"]);
    const block = getBlock(1);
    expect(block?.content).toBe("SELECT 1;\nSELECT 2;");
  });

  it("stores empty lines array as empty content", () => {
    storeBlock("code", []);
    const block = getBlock(1);
    expect(block?.content).toBe("");
  });

  it("stores the language", () => {
    storeBlock("typescript", ["const x = 1;"]);
    expect(getBlock(1)?.lang).toBe("typescript");
  });

  it("stores empty string for language when blank", () => {
    storeBlock("", ["some code"]);
    expect(getBlock(1)?.lang).toBe("");
  });
});

describe("getBlock", () => {
  it("retrieves block by 1-based ID", () => {
    storeBlock("sql", ["SELECT 1;"]);
    storeBlock("ts", ["const x = 1;"]);
    const block = getBlock(2);
    expect(block?.id).toBe(2);
    expect(block?.lang).toBe("ts");
    expect(block?.content).toBe("const x = 1;");
  });

  it("returns undefined for ID 0", () => {
    storeBlock("sql", ["SELECT 1;"]);
    expect(getBlock(0)).toBeUndefined();
  });

  it("returns undefined for non-existent ID", () => {
    expect(getBlock(99)).toBeUndefined();
  });

  it("returns undefined for negative ID", () => {
    storeBlock("sql", ["SELECT 1;"]);
    expect(getBlock(-1)).toBeUndefined();
  });
});

describe("getLastBlock", () => {
  it("returns undefined when no blocks stored", () => {
    expect(getLastBlock()).toBeUndefined();
  });

  it("returns the last stored block", () => {
    storeBlock("sql", ["SELECT 1;"]);
    storeBlock("ts", ["const x = 1;"]);
    const last = getLastBlock();
    expect(last?.id).toBe(2);
    expect(last?.lang).toBe("ts");
  });

  it("updates as new blocks are added", () => {
    storeBlock("sql", ["SELECT 1;"]);
    expect(getLastBlock()?.id).toBe(1);
    storeBlock("ts", ["const x = 1;"]);
    expect(getLastBlock()?.id).toBe(2);
  });
});

describe("getBlockCount", () => {
  it("returns 0 initially", () => {
    expect(getBlockCount()).toBe(0);
  });

  it("increments as blocks are added", () => {
    storeBlock("sql", ["SELECT 1;"]);
    expect(getBlockCount()).toBe(1);
    storeBlock("ts", ["const x = 1;"]);
    expect(getBlockCount()).toBe(2);
  });
});

describe("resetBlockStore", () => {
  it("clears all blocks", () => {
    storeBlock("sql", ["SELECT 1;"]);
    storeBlock("ts", ["const x = 1;"]);
    resetBlockStore();
    expect(getBlockCount()).toBe(0);
    expect(getLastBlock()).toBeUndefined();
  });

  it("resets ID counter to 0 so next block gets ID 1", () => {
    storeBlock("sql", ["SELECT 1;"]);
    storeBlock("ts", ["const x = 1;"]);
    resetBlockStore();
    const id = storeBlock("bash", ["echo hi"]);
    expect(id).toBe(1);
  });

  it("makes previously stored blocks unretrievable", () => {
    storeBlock("sql", ["SELECT 1;"]);
    resetBlockStore();
    expect(getBlock(1)).toBeUndefined();
  });
});

describe("FIFO cap at 100 blocks", () => {
  it("evicts oldest block when cap is exceeded", () => {
    for (let i = 1; i <= 100; i++) {
      storeBlock("ts", [`line ${i}`]);
    }
    expect(getBlockCount()).toBe(100);
    expect(getBlock(1)?.content).toBe("line 1");

    // Adding block 101 should evict block 1
    storeBlock("ts", ["line 101"]);
    expect(getBlockCount()).toBe(100);
    expect(getBlock(1)).toBeUndefined();
    expect(getLastBlock()?.content).toBe("line 101");
  });

  it("block 2 becomes retrievable after block 1 is evicted", () => {
    for (let i = 1; i <= 101; i++) {
      storeBlock("ts", [`line ${i}`]);
    }
    // Block 1 evicted, block 2 still exists
    expect(getBlock(2)?.content).toBe("line 2");
  });
});

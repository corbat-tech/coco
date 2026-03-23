/**
 * Block store — tracks rendered code blocks for clipboard access.
 *
 * Blocks are assigned sequential 1-based IDs as they are rendered.
 * Capped at MAX_BLOCKS entries (FIFO eviction) to prevent memory leaks
 * in long sessions.
 */

const MAX_BLOCKS = 100;

/**
 * A single code block captured from rendered output.
 *
 * @property id      - Unique 1-based sequential identifier assigned at render time;
 *                     never reused within a session even after FIFO eviction.
 * @property lang    - Language tag from the fenced code block (e.g. `"typescript"`,
 *                     `"bash"`), or an empty string when no language was specified.
 * @property content - Raw text content of the block, lines joined with `"\n"`.
 */
export interface StoredBlock {
  id: number;
  lang: string;
  content: string;
}

/** All stored blocks, ordered by insertion. */
let blocks: StoredBlock[] = [];
/** Monotonically increasing counter; never resets to avoid ID reuse. */
let blockCounter = 0;

/**
 * Store a rendered code block and return its assigned 1-based ID.
 * Evicts the oldest block when the cap is reached.
 */
export function storeBlock(lang: string, lines: string[]): number {
  blockCounter++;
  const block: StoredBlock = { id: blockCounter, lang, content: lines.join("\n") };
  blocks.push(block);
  if (blocks.length > MAX_BLOCKS) {
    blocks.shift();
  }
  return block.id;
}

/** Retrieve a block by its 1-based ID. Returns undefined if not found or evicted. */
export function getBlock(id: number): StoredBlock | undefined {
  if (id <= 0) return undefined;
  return blocks.find((b) => b.id === id);
}

/** Return the most recently rendered block, or undefined if none. */
export function getLastBlock(): StoredBlock | undefined {
  return blocks[blocks.length - 1];
}

/** Return the number of blocks currently in the store (max MAX_BLOCKS). */
export function getBlockCount(): number {
  return blocks.length;
}

/**
 * Clear all stored blocks and reset the ID counter.
 * Called by resetLineBuffer() (triggered on /clear or session reset).
 */
export function resetBlockStore(): void {
  blocks = [];
  blockCounter = 0;
}

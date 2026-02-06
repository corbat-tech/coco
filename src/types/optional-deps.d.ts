/**
 * Type declarations for optional dependencies
 * These modules are dynamically imported and may not be installed
 */

declare module "better-sqlite3" {
  interface Statement {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number; lastInsertRowid: bigint };
    get(...params: unknown[]): unknown;
  }

  interface Database {
    prepare(sql: string): Statement;
    close(): void;
  }

  interface DatabaseConstructor {
    new (path: string, options?: Record<string, unknown>): Database;
  }

  const Database: DatabaseConstructor;
  export default Database;
}

declare module "pdf-parse" {
  interface PdfData {
    text: string;
    numpages: number;
    info: Record<string, string>;
  }

  function pdfParse(
    data: Buffer,
    options?: Record<string, unknown>,
  ): Promise<PdfData>;

  export default pdfParse;
}

declare module "@xenova/transformers" {
  interface PipelineOutput {
    data: Float32Array | number[];
  }

  type Pipeline = (
    text: string,
    options?: Record<string, unknown>,
  ) => Promise<PipelineOutput>;

  function pipeline(task: string, model: string): Promise<Pipeline>;

  export { pipeline };
}

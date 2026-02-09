/**
 * Comprehensive tests for the checkpoints system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";

// Mock fs/promises
const mockFs = {
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn(),
  unlink: vi.fn(),
  readdir: vi.fn(),
  rm: vi.fn(),
};

vi.mock("node:fs/promises", () => ({
  default: mockFs,
  readFile: mockFs.readFile,
  writeFile: mockFs.writeFile,
  mkdir: mockFs.mkdir,
  access: mockFs.access,
  unlink: mockFs.unlink,
  readdir: mockFs.readdir,
  rm: mockFs.rm,
}));

// Mock crypto
vi.mock("node:crypto", () => ({
  randomBytes: vi.fn().mockReturnValue({
    toString: () => "abc12345",
  }),
  createHash: vi.fn().mockReturnValue({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn().mockReturnValue("mockedhash123"),
  }),
}));

// =============================================================================
// Types Tests
// =============================================================================

describe("types.ts", () => {
  describe("CheckpointType values", () => {
    it("should support file type", async () => {
      // CheckpointType is a TypeScript type, we test values at runtime
      const fileType: "file" | "conversation" | "combined" = "file";
      expect(fileType).toBe("file");
    });

    it("should support conversation type", async () => {
      const convType: "file" | "conversation" | "combined" = "conversation";
      expect(convType).toBe("conversation");
    });

    it("should support combined type", async () => {
      const combinedType: "file" | "conversation" | "combined" = "combined";
      expect(combinedType).toBe("combined");
    });
  });

  describe("FileCheckpoint interface structure", () => {
    it("should have required fields", async () => {
      const checkpoint = {
        id: "file_123_abc",
        filePath: "/path/to/file.ts",
        originalContent: "original content",
        createdAt: new Date(),
        triggeredBy: "write_file",
        size: 16,
      };

      expect(checkpoint.id).toBe("file_123_abc");
      expect(checkpoint.filePath).toBe("/path/to/file.ts");
      expect(checkpoint.originalContent).toBe("original content");
      expect(checkpoint.triggeredBy).toBe("write_file");
      expect(checkpoint.size).toBe(16);
    });

    it("should allow optional fields", async () => {
      const checkpoint = {
        id: "file_123_abc",
        filePath: "/path/to/file.ts",
        originalContent: "original",
        newContent: "modified",
        createdAt: new Date(),
        triggeredBy: "edit_file",
        toolCallId: "tool_456",
        size: 8,
      };

      expect(checkpoint.newContent).toBe("modified");
      expect(checkpoint.toolCallId).toBe("tool_456");
    });
  });

  describe("ConversationCheckpoint interface structure", () => {
    it("should have required fields", async () => {
      const checkpoint = {
        id: "conv_123_abc",
        sessionId: "session_456",
        messages: [{ role: "user", content: "Hello" }],
        messageCount: 1,
        createdAt: new Date(),
      };

      expect(checkpoint.id).toBe("conv_123_abc");
      expect(checkpoint.sessionId).toBe("session_456");
      expect(checkpoint.messages).toHaveLength(1);
      expect(checkpoint.messageCount).toBe(1);
    });

    it("should allow optional description", async () => {
      const checkpoint = {
        id: "conv_123_abc",
        sessionId: "session_456",
        messages: [],
        messageCount: 0,
        createdAt: new Date(),
        description: "Before refactoring",
      };

      expect(checkpoint.description).toBe("Before refactoring");
    });
  });

  describe("Checkpoint interface structure", () => {
    it("should combine file and conversation checkpoints", async () => {
      const fileCheckpoint = {
        id: "file_1",
        filePath: "/path/file.ts",
        originalContent: "content",
        createdAt: new Date(),
        triggeredBy: "write_file",
        size: 7,
      };

      const convCheckpoint = {
        id: "conv_1",
        sessionId: "session_1",
        messages: [],
        messageCount: 0,
        createdAt: new Date(),
      };

      const checkpoint = {
        id: "ckpt_123",
        sessionId: "session_1",
        type: "combined" as const,
        files: [fileCheckpoint],
        conversation: convCheckpoint,
        createdAt: new Date(),
        automatic: false,
      };

      expect(checkpoint.type).toBe("combined");
      expect(checkpoint.files).toHaveLength(1);
      expect(checkpoint.conversation).toBeDefined();
      expect(checkpoint.automatic).toBe(false);
    });

    it("should allow optional label", async () => {
      const checkpoint = {
        id: "ckpt_123",
        sessionId: "session_1",
        type: "file" as const,
        files: [],
        createdAt: new Date(),
        label: "Before major refactor",
        automatic: true,
      };

      expect(checkpoint.label).toBe("Before major refactor");
    });
  });
});

// =============================================================================
// Manager Tests
// =============================================================================

describe("manager.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T10:00:00Z"));

    // Default mock implementations
    mockFs.access.mockRejectedValue(new Error("ENOENT"));
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue("{}");
    mockFs.readdir.mockResolvedValue([]);
    mockFs.unlink.mockResolvedValue(undefined);
    mockFs.rm.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createCheckpointManager() factory", () => {
    it("should create a new CheckpointManager instance", async () => {
      const { createCheckpointManager } = await import("./manager.js");

      const manager = createCheckpointManager();

      expect(manager).toBeDefined();
      expect(typeof manager.createCheckpoint).toBe("function");
      expect(typeof manager.getCheckpoints).toBe("function");
      expect(typeof manager.rewind).toBe("function");
    });

    it("should accept custom configuration", async () => {
      const { createCheckpointManager } = await import("./manager.js");

      const manager = createCheckpointManager({
        maxCheckpoints: 100,
        autoCheckpointFiles: false,
      });

      const config = manager.getConfig();

      expect(config.maxCheckpoints).toBe(100);
      expect(config.autoCheckpointFiles).toBe(false);
    });

    it("should use default configuration when not provided", async () => {
      const { createCheckpointManager } = await import("./manager.js");

      const manager = createCheckpointManager();
      const config = manager.getConfig();

      expect(config.maxCheckpoints).toBe(50);
      expect(config.autoCheckpointFiles).toBe(true);
      expect(config.conversationCheckpointInterval).toBe(10);
    });

    it("should set storage directory to default path", async () => {
      const { createCheckpointManager } = await import("./manager.js");

      const manager = createCheckpointManager();
      const config = manager.getConfig();

      expect(config.storageDir).toContain(".coco");
      expect(config.storageDir).toContain("checkpoints");
    });
  });

  describe("getCheckpointManager() singleton", () => {
    it("should return the same instance on multiple calls", async () => {
      const { getCheckpointManager, resetCheckpointManager } = await import("./manager.js");

      resetCheckpointManager();

      const manager1 = getCheckpointManager();
      const manager2 = getCheckpointManager();

      expect(manager1).toBe(manager2);
    });

    it("should create instance with default config", async () => {
      const { getCheckpointManager, resetCheckpointManager } = await import("./manager.js");

      resetCheckpointManager();

      const manager = getCheckpointManager();
      const config = manager.getConfig();

      expect(config.maxCheckpoints).toBe(50);
    });
  });

  describe("resetCheckpointManager()", () => {
    it("should clear the singleton instance", async () => {
      const { getCheckpointManager, resetCheckpointManager } = await import("./manager.js");

      const manager1 = getCheckpointManager();
      resetCheckpointManager();
      const manager2 = getCheckpointManager();

      expect(manager1).not.toBe(manager2);
    });
  });

  describe("createFileCheckpoint()", () => {
    it("should create checkpoint for existing file", async () => {
      mockFs.readFile.mockResolvedValueOnce("existing content");

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoint = await manager.createFileCheckpoint(
        "session_1",
        "/path/to/file.ts",
        "edit_file",
        "tool_123",
      );

      expect(checkpoint.originalContent).toBe("existing content");
      expect(checkpoint.filePath).toBe("/path/to/file.ts");
    });

    it("should generate unique ID with file prefix", async () => {
      mockFs.readFile.mockResolvedValueOnce("content");

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoint = await manager.createFileCheckpoint(
        "session_1",
        "/path/to/file.ts",
        "write_file",
      );

      expect(checkpoint.id).toMatch(/^file_\d+_[a-f0-9]+$/);
    });

    it("should store original content", async () => {
      const originalContent = "function hello() { return 'world'; }";
      mockFs.readFile.mockResolvedValueOnce(originalContent);

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoint = await manager.createFileCheckpoint(
        "session_1",
        "/path/to/file.ts",
        "edit_file",
      );

      expect(checkpoint.originalContent).toBe(originalContent);
      expect(checkpoint.size).toBe(Buffer.byteLength(originalContent, "utf-8"));
    });

    it("should record triggeredBy tool name", async () => {
      mockFs.readFile.mockResolvedValueOnce("content");

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoint = await manager.createFileCheckpoint(
        "session_1",
        "/path/to/file.ts",
        "delete_file",
        "tool_abc",
      );

      expect(checkpoint.triggeredBy).toBe("delete_file");
      expect(checkpoint.toolCallId).toBe("tool_abc");
    });

    it("should handle non-existing file with empty content", async () => {
      mockFs.readFile.mockRejectedValueOnce(new Error("ENOENT"));

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoint = await manager.createFileCheckpoint(
        "session_1",
        "/path/to/new-file.ts",
        "write_file",
      );

      expect(checkpoint.originalContent).toBe("");
      expect(checkpoint.size).toBe(0);
    });

    it("should resolve file path to absolute path", async () => {
      mockFs.readFile.mockResolvedValueOnce("content");

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoint = await manager.createFileCheckpoint(
        "session_1",
        "./relative/path.ts",
        "write_file",
      );

      expect(path.isAbsolute(checkpoint.filePath)).toBe(true);
    });
  });

  describe("createConversationCheckpoint()", () => {
    it("should create checkpoint with messages", async () => {
      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const messages = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there!" },
      ];

      const checkpoint = await manager.createConversationCheckpoint(
        "session_1",
        messages,
        "Test checkpoint",
      );

      expect(checkpoint.messages).toHaveLength(2);
      expect(checkpoint.messageCount).toBe(2);
      expect(checkpoint.description).toBe("Test checkpoint");
    });

    it("should record message count", async () => {
      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const messages = [
        { role: "user" as const, content: "One" },
        { role: "assistant" as const, content: "Two" },
        { role: "user" as const, content: "Three" },
      ];

      const checkpoint = await manager.createConversationCheckpoint("session_1", messages);

      expect(checkpoint.messageCount).toBe(3);
    });

    it("should handle empty messages array", async () => {
      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoint = await manager.createConversationCheckpoint("session_1", []);

      expect(checkpoint.messages).toHaveLength(0);
      expect(checkpoint.messageCount).toBe(0);
    });

    it("should generate unique ID with conv prefix", async () => {
      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoint = await manager.createConversationCheckpoint("session_1", []);

      expect(checkpoint.id).toMatch(/^conv_\d+_[a-f0-9]+$/);
    });

    it("should set session ID correctly", async () => {
      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoint = await manager.createConversationCheckpoint("my-session-123", []);

      expect(checkpoint.sessionId).toBe("my-session-123");
    });
  });

  describe("createCheckpoint()", () => {
    it("should create file-only checkpoint", async () => {
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("index.json")) {
          return Promise.resolve(
            JSON.stringify({
              sessionId: "session_1",
              checkpoints: [],
              lastUpdated: new Date().toISOString(),
            }),
          );
        }
        return Promise.resolve("file content");
      });

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoint = await manager.createCheckpoint("session_1", "file", ["/path/to/file.ts"]);

      expect(checkpoint.type).toBe("file");
      expect(checkpoint.files.length).toBe(1);
      expect(checkpoint.conversation).toBeUndefined();
    });

    it("should create conversation-only checkpoint", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          sessionId: "session_1",
          checkpoints: [],
          lastUpdated: new Date().toISOString(),
        }),
      );

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const messages = [{ role: "user" as const, content: "Hello" }];
      const checkpoint = await manager.createCheckpoint(
        "session_1",
        "conversation",
        undefined,
        messages,
      );

      expect(checkpoint.type).toBe("conversation");
      expect(checkpoint.files).toHaveLength(0);
      expect(checkpoint.conversation).toBeDefined();
      expect(checkpoint.conversation?.messageCount).toBe(1);
    });

    it("should create combined checkpoint", async () => {
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("index.json")) {
          return Promise.resolve(
            JSON.stringify({
              sessionId: "session_1",
              checkpoints: [],
              lastUpdated: new Date().toISOString(),
            }),
          );
        }
        return Promise.resolve("file content");
      });

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const messages = [{ role: "user" as const, content: "Hello" }];
      const checkpoint = await manager.createCheckpoint(
        "session_1",
        "combined",
        ["/path/file.ts"],
        messages,
      );

      expect(checkpoint.type).toBe("combined");
      expect(checkpoint.files.length).toBe(1);
      expect(checkpoint.conversation).toBeDefined();
    });

    it("should set automatic flag to false for manual checkpoints", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          sessionId: "session_1",
          checkpoints: [],
          lastUpdated: new Date().toISOString(),
        }),
      );

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoint = await manager.createCheckpoint("session_1", "conversation", undefined, []);

      expect(checkpoint.automatic).toBe(false);
    });

    it("should set label if provided", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          sessionId: "session_1",
          checkpoints: [],
          lastUpdated: new Date().toISOString(),
        }),
      );

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoint = await manager.createCheckpoint(
        "session_1",
        "conversation",
        undefined,
        [],
        "My important checkpoint",
      );

      expect(checkpoint.label).toBe("My important checkpoint");
    });
  });

  describe("getCheckpoints()", () => {
    it("should return all checkpoints for session", async () => {
      const storedCheckpoint = {
        id: "ckpt_1",
        sessionId: "session_1",
        type: "file",
        createdAt: new Date().toISOString(),
        automatic: true,
        files: [],
      };

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("index.json")) {
          return Promise.resolve(
            JSON.stringify({
              sessionId: "session_1",
              checkpoints: [
                {
                  id: "ckpt_1",
                  type: "file",
                  createdAt: new Date().toISOString(),
                  automatic: true,
                  fileCount: 0,
                },
              ],
              lastUpdated: new Date().toISOString(),
            }),
          );
        }
        return Promise.resolve(JSON.stringify(storedCheckpoint));
      });

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoints = await manager.getCheckpoints("session_1");

      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0]?.id).toBe("ckpt_1");
    });

    it("should return empty array for no checkpoints", async () => {
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoints = await manager.getCheckpoints("nonexistent_session");

      expect(checkpoints).toHaveLength(0);
    });

    it("should sort checkpoints by newest first", async () => {
      const now = Date.now();

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("index.json")) {
          return Promise.resolve(
            JSON.stringify({
              sessionId: "session_1",
              checkpoints: [
                {
                  id: "ckpt_old",
                  type: "file",
                  createdAt: new Date(now - 10000).toISOString(),
                  automatic: true,
                  fileCount: 0,
                },
                {
                  id: "ckpt_new",
                  type: "file",
                  createdAt: new Date(now).toISOString(),
                  automatic: true,
                  fileCount: 0,
                },
              ],
              lastUpdated: new Date().toISOString(),
            }),
          );
        }
        if (filePath.includes("ckpt_old")) {
          return Promise.resolve(
            JSON.stringify({
              id: "ckpt_old",
              sessionId: "session_1",
              type: "file",
              createdAt: new Date(now - 10000).toISOString(),
              automatic: true,
              files: [],
            }),
          );
        }
        return Promise.resolve(
          JSON.stringify({
            id: "ckpt_new",
            sessionId: "session_1",
            type: "file",
            createdAt: new Date(now).toISOString(),
            automatic: true,
            files: [],
          }),
        );
      });

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoints = await manager.getCheckpoints("session_1");

      expect(checkpoints[0]?.id).toBe("ckpt_new");
      expect(checkpoints[1]?.id).toBe("ckpt_old");
    });
  });

  describe("getCheckpoint()", () => {
    it("should return checkpoint by ID", async () => {
      const storedCheckpoint = {
        id: "ckpt_abc123",
        sessionId: "session_1",
        type: "file",
        createdAt: new Date().toISOString(),
        automatic: true,
        files: [],
      };

      mockFs.readdir.mockResolvedValue([{ name: "session_1", isDirectory: () => true }]);
      mockFs.readFile.mockResolvedValue(JSON.stringify(storedCheckpoint));

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoint = await manager.getCheckpoint("ckpt_abc123");

      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.id).toBe("ckpt_abc123");
    });

    it("should return null for non-existent ID", async () => {
      mockFs.readdir.mockResolvedValue([]);

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoint = await manager.getCheckpoint("nonexistent_id");

      expect(checkpoint).toBeNull();
    });
  });

  describe("rewind()", () => {
    it("should restore file content", async () => {
      const storedCheckpoint = {
        id: "ckpt_1",
        sessionId: "session_1",
        type: "file",
        createdAt: new Date().toISOString(),
        automatic: true,
        files: [
          {
            id: "file_1",
            filePath: "/path/to/file.ts",
            contentHash: "hash123",
            createdAt: new Date().toISOString(),
            triggeredBy: "edit_file",
            size: 20,
          },
        ],
      };

      mockFs.readdir.mockResolvedValue([{ name: "session_1", isDirectory: () => true }]);
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("ckpt_1.json")) {
          return Promise.resolve(JSON.stringify(storedCheckpoint));
        }
        if (filePath.includes("hash123.txt")) {
          return Promise.resolve("original content here");
        }
        return Promise.reject(new Error("ENOENT"));
      });

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const result = await manager.rewind({
        checkpointId: "ckpt_1",
        restoreFiles: true,
        restoreConversation: false,
      });

      expect(result.filesRestored).toContain("/path/to/file.ts");
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        "/path/to/file.ts",
        "original content here",
        "utf-8",
      );
    });

    it("should handle multiple files", async () => {
      const storedCheckpoint = {
        id: "ckpt_1",
        sessionId: "session_1",
        type: "file",
        createdAt: new Date().toISOString(),
        automatic: true,
        files: [
          {
            id: "file_1",
            filePath: "/path/file1.ts",
            contentHash: "hash1",
            createdAt: new Date().toISOString(),
            triggeredBy: "edit_file",
            size: 10,
          },
          {
            id: "file_2",
            filePath: "/path/file2.ts",
            contentHash: "hash2",
            createdAt: new Date().toISOString(),
            triggeredBy: "edit_file",
            size: 10,
          },
        ],
      };

      mockFs.readdir.mockResolvedValue([{ name: "session_1", isDirectory: () => true }]);
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("ckpt_1.json")) {
          return Promise.resolve(JSON.stringify(storedCheckpoint));
        }
        if (filePath.includes("hash1.txt")) {
          return Promise.resolve("content 1");
        }
        if (filePath.includes("hash2.txt")) {
          return Promise.resolve("content 2");
        }
        return Promise.reject(new Error("ENOENT"));
      });

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const result = await manager.rewind({
        checkpointId: "ckpt_1",
        restoreFiles: true,
        restoreConversation: false,
      });

      expect(result.filesRestored).toHaveLength(2);
      expect(result.filesRestored).toContain("/path/file1.ts");
      expect(result.filesRestored).toContain("/path/file2.ts");
    });

    it("should respect restoreFiles flag", async () => {
      const storedCheckpoint = {
        id: "ckpt_1",
        sessionId: "session_1",
        type: "file",
        createdAt: new Date().toISOString(),
        automatic: true,
        files: [
          {
            id: "file_1",
            filePath: "/path/file.ts",
            contentHash: "hash1",
            createdAt: new Date().toISOString(),
            triggeredBy: "edit_file",
            size: 10,
          },
        ],
      };

      mockFs.readdir.mockResolvedValue([{ name: "session_1", isDirectory: () => true }]);
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("ckpt_1.json")) {
          return Promise.resolve(JSON.stringify(storedCheckpoint));
        }
        if (filePath.includes("hash1.txt")) {
          return Promise.resolve("content");
        }
        return Promise.reject(new Error("ENOENT"));
      });

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      // Don't restore files
      const result = await manager.rewind({
        checkpointId: "ckpt_1",
        restoreFiles: false,
        restoreConversation: false,
      });

      expect(result.filesRestored).toHaveLength(0);
      expect(mockFs.writeFile).not.toHaveBeenCalledWith(
        "/path/file.ts",
        expect.anything(),
        expect.anything(),
      );
    });

    it("should respect restoreConversation flag", async () => {
      const storedCheckpoint = {
        id: "ckpt_1",
        sessionId: "session_1",
        type: "combined",
        createdAt: new Date().toISOString(),
        automatic: true,
        files: [],
        conversation: {
          id: "conv_1",
          sessionId: "session_1",
          messages: [{ role: "user", content: "Hello" }],
          messageCount: 1,
          createdAt: new Date().toISOString(),
        },
      };

      mockFs.readdir.mockResolvedValue([{ name: "session_1", isDirectory: () => true }]);
      mockFs.readFile.mockResolvedValue(JSON.stringify(storedCheckpoint));

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const result = await manager.rewind({
        checkpointId: "ckpt_1",
        restoreFiles: false,
        restoreConversation: true,
      });

      expect(result.conversationRestored).toBe(true);
      expect(result.messagesAfterRestore).toBe(1);
    });

    it("should respect excludeFiles option", async () => {
      const storedCheckpoint = {
        id: "ckpt_1",
        sessionId: "session_1",
        type: "file",
        createdAt: new Date().toISOString(),
        automatic: true,
        files: [
          {
            id: "file_1",
            filePath: "/path/file1.ts",
            contentHash: "hash1",
            createdAt: new Date().toISOString(),
            triggeredBy: "edit_file",
            size: 10,
          },
          {
            id: "file_2",
            filePath: "/path/file2.ts",
            contentHash: "hash2",
            createdAt: new Date().toISOString(),
            triggeredBy: "edit_file",
            size: 10,
          },
        ],
      };

      mockFs.readdir.mockResolvedValue([{ name: "session_1", isDirectory: () => true }]);
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("ckpt_1.json")) {
          return Promise.resolve(JSON.stringify(storedCheckpoint));
        }
        if (filePath.includes("hash1.txt")) {
          return Promise.resolve("content 1");
        }
        if (filePath.includes("hash2.txt")) {
          return Promise.resolve("content 2");
        }
        return Promise.reject(new Error("ENOENT"));
      });

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const result = await manager.rewind({
        checkpointId: "ckpt_1",
        restoreFiles: true,
        restoreConversation: false,
        excludeFiles: ["/path/file1.ts"],
      });

      expect(result.filesRestored).toHaveLength(1);
      expect(result.filesRestored).not.toContain("/path/file1.ts");
      expect(result.filesRestored).toContain("/path/file2.ts");
    });

    it("should report failed restorations", async () => {
      const storedCheckpoint = {
        id: "ckpt_1",
        sessionId: "session_1",
        type: "file",
        createdAt: new Date().toISOString(),
        automatic: true,
        files: [
          {
            id: "file_1",
            filePath: "/readonly/file.ts",
            contentHash: "hash1",
            createdAt: new Date().toISOString(),
            triggeredBy: "edit_file",
            size: 10,
          },
        ],
      };

      mockFs.readdir.mockResolvedValue([{ name: "session_1", isDirectory: () => true }]);
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("ckpt_1.json")) {
          return Promise.resolve(JSON.stringify(storedCheckpoint));
        }
        if (filePath.includes("hash1.txt")) {
          return Promise.resolve("content");
        }
        return Promise.reject(new Error("ENOENT"));
      });
      mockFs.writeFile.mockRejectedValueOnce(new Error("Permission denied"));

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const result = await manager.rewind({
        checkpointId: "ckpt_1",
        restoreFiles: true,
        restoreConversation: false,
      });

      expect(result.filesFailed).toHaveLength(1);
      expect(result.filesFailed[0]?.path).toBe("/readonly/file.ts");
      expect(result.filesFailed[0]?.error).toContain("Permission denied");
    });

    it("should throw error for non-existent checkpoint", async () => {
      mockFs.readdir.mockResolvedValue([]);

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      await expect(
        manager.rewind({
          checkpointId: "nonexistent",
          restoreFiles: true,
          restoreConversation: false,
        }),
      ).rejects.toThrow("Checkpoint not found");
    });
  });

  describe("pruneCheckpoints()", () => {
    it("should remove old checkpoints when over limit", async () => {
      const now = Date.now();

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("index.json")) {
          return Promise.resolve(
            JSON.stringify({
              sessionId: "session_1",
              checkpoints: [
                {
                  id: "ckpt_1",
                  type: "file",
                  createdAt: new Date(now - 3000).toISOString(),
                  automatic: true,
                  fileCount: 0,
                },
                {
                  id: "ckpt_2",
                  type: "file",
                  createdAt: new Date(now - 2000).toISOString(),
                  automatic: true,
                  fileCount: 0,
                },
                {
                  id: "ckpt_3",
                  type: "file",
                  createdAt: new Date(now - 1000).toISOString(),
                  automatic: true,
                  fileCount: 0,
                },
              ],
              lastUpdated: new Date().toISOString(),
            }),
          );
        }
        return Promise.resolve("{}");
      });

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager({ maxCheckpoints: 2 });

      const deletedCount = await manager.pruneCheckpoints("session_1");

      expect(deletedCount).toBe(1);
      expect(mockFs.unlink).toHaveBeenCalledTimes(1);
    });

    it("should keep maxCheckpoints newest", async () => {
      const now = Date.now();

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("index.json")) {
          return Promise.resolve(
            JSON.stringify({
              sessionId: "session_1",
              checkpoints: [
                {
                  id: "ckpt_old1",
                  type: "file",
                  createdAt: new Date(now - 5000).toISOString(),
                  automatic: true,
                  fileCount: 0,
                },
                {
                  id: "ckpt_old2",
                  type: "file",
                  createdAt: new Date(now - 4000).toISOString(),
                  automatic: true,
                  fileCount: 0,
                },
                {
                  id: "ckpt_new1",
                  type: "file",
                  createdAt: new Date(now - 1000).toISOString(),
                  automatic: true,
                  fileCount: 0,
                },
                {
                  id: "ckpt_new2",
                  type: "file",
                  createdAt: new Date(now).toISOString(),
                  automatic: true,
                  fileCount: 0,
                },
              ],
              lastUpdated: new Date().toISOString(),
            }),
          );
        }
        return Promise.resolve("{}");
      });

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager({ maxCheckpoints: 2 });

      await manager.pruneCheckpoints("session_1");

      // Should delete ckpt_old1 and ckpt_old2
      expect(mockFs.unlink).toHaveBeenCalledTimes(2);
    });

    it("should return 0 when under limit", async () => {
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({
          sessionId: "session_1",
          checkpoints: [
            {
              id: "ckpt_1",
              type: "file",
              createdAt: new Date().toISOString(),
              automatic: true,
              fileCount: 0,
            },
          ],
          lastUpdated: new Date().toISOString(),
        }),
      );

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager({ maxCheckpoints: 50 });

      const deletedCount = await manager.pruneCheckpoints("session_1");

      expect(deletedCount).toBe(0);
      expect(mockFs.unlink).not.toHaveBeenCalled();
    });
  });

  describe("clearCheckpoints()", () => {
    it("should remove all checkpoints for session", async () => {
      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      await manager.clearCheckpoints("session_1");

      expect(mockFs.rm).toHaveBeenCalledWith(expect.stringContaining("session_1"), {
        recursive: true,
        force: true,
      });
    });

    it("should not throw if session directory does not exist", async () => {
      mockFs.rm.mockRejectedValueOnce(new Error("ENOENT"));

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      await expect(manager.clearCheckpoints("nonexistent_session")).resolves.not.toThrow();
    });
  });

  describe("getLatestCheckpoint()", () => {
    it("should return most recent checkpoint", async () => {
      const now = Date.now();

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("index.json")) {
          return Promise.resolve(
            JSON.stringify({
              sessionId: "session_1",
              checkpoints: [
                {
                  id: "ckpt_old",
                  type: "file",
                  createdAt: new Date(now - 10000).toISOString(),
                  automatic: true,
                  fileCount: 0,
                },
                {
                  id: "ckpt_new",
                  type: "file",
                  createdAt: new Date(now).toISOString(),
                  automatic: true,
                  fileCount: 0,
                },
              ],
              lastUpdated: new Date().toISOString(),
            }),
          );
        }
        if (filePath.includes("ckpt_new")) {
          return Promise.resolve(
            JSON.stringify({
              id: "ckpt_new",
              sessionId: "session_1",
              type: "file",
              createdAt: new Date(now).toISOString(),
              automatic: true,
              files: [],
            }),
          );
        }
        return Promise.resolve("{}");
      });

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const latest = await manager.getLatestCheckpoint("session_1");

      expect(latest?.id).toBe("ckpt_new");
    });

    it("should return null for no checkpoints", async () => {
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const latest = await manager.getLatestCheckpoint("empty_session");

      expect(latest).toBeNull();
    });
  });

  describe("getCheckpointedFiles()", () => {
    it("should return unique list of checkpointed files", async () => {
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("index.json")) {
          return Promise.resolve(
            JSON.stringify({
              sessionId: "session_1",
              checkpoints: [
                {
                  id: "ckpt_1",
                  type: "file",
                  createdAt: new Date().toISOString(),
                  automatic: true,
                  fileCount: 2,
                },
                {
                  id: "ckpt_2",
                  type: "file",
                  createdAt: new Date().toISOString(),
                  automatic: true,
                  fileCount: 1,
                },
              ],
              lastUpdated: new Date().toISOString(),
            }),
          );
        }
        if (filePath.includes("ckpt_1")) {
          return Promise.resolve(
            JSON.stringify({
              id: "ckpt_1",
              sessionId: "session_1",
              type: "file",
              createdAt: new Date().toISOString(),
              automatic: true,
              files: [
                {
                  id: "f1",
                  filePath: "/path/a.ts",
                  contentHash: "h1",
                  createdAt: new Date().toISOString(),
                  triggeredBy: "edit",
                  size: 10,
                },
                {
                  id: "f2",
                  filePath: "/path/b.ts",
                  contentHash: "h2",
                  createdAt: new Date().toISOString(),
                  triggeredBy: "edit",
                  size: 10,
                },
              ],
            }),
          );
        }
        if (filePath.includes("ckpt_2")) {
          return Promise.resolve(
            JSON.stringify({
              id: "ckpt_2",
              sessionId: "session_1",
              type: "file",
              createdAt: new Date().toISOString(),
              automatic: true,
              files: [
                {
                  id: "f3",
                  filePath: "/path/a.ts",
                  contentHash: "h3",
                  createdAt: new Date().toISOString(),
                  triggeredBy: "edit",
                  size: 10,
                },
              ],
            }),
          );
        }
        if (filePath.includes("h1.txt")) return Promise.resolve("content1");
        if (filePath.includes("h2.txt")) return Promise.resolve("content2");
        if (filePath.includes("h3.txt")) return Promise.resolve("content3");
        return Promise.reject(new Error("ENOENT"));
      });

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const files = await manager.getCheckpointedFiles("session_1");

      // Should return unique paths, sorted
      expect(files).toHaveLength(2);
      expect(files).toContain("/path/a.ts");
      expect(files).toContain("/path/b.ts");
    });

    it("should return empty array for no checkpoints", async () => {
      mockFs.readFile.mockRejectedValue(new Error("ENOENT"));

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const files = await manager.getCheckpointedFiles("empty_session");

      expect(files).toHaveLength(0);
    });
  });

  describe("Storage tests", () => {
    it("should persist checkpoints to disk", async () => {
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("index.json")) {
          return Promise.resolve(
            JSON.stringify({
              sessionId: "session_1",
              checkpoints: [],
              lastUpdated: new Date().toISOString(),
            }),
          );
        }
        return Promise.resolve("file content");
      });

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      await manager.createCheckpoint("session_1", "file", ["/path/file.ts"]);

      // Should write checkpoint file
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/ckpt_\d+_[a-f0-9]+\.json$/),
        expect.any(String),
        "utf-8",
      );
    });

    it("should use content-addressed storage for file deduplication", async () => {
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("index.json")) {
          return Promise.resolve(
            JSON.stringify({
              sessionId: "session_1",
              checkpoints: [],
              lastUpdated: new Date().toISOString(),
            }),
          );
        }
        return Promise.resolve("same content");
      });
      mockFs.access.mockResolvedValue(undefined); // Content already exists

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      await manager.createCheckpoint("session_1", "file", ["/path/file1.ts"]);
      await manager.createCheckpoint("session_1", "file", ["/path/file2.ts"]);

      // Content should be stored by hash, so duplicate content is not written twice
      // The hash file should only be written once (when it doesn't exist)
      const contentWrites = mockFs.writeFile.mock.calls.filter(([path]: [string]) =>
        path.includes("/files/"),
      );
      // Since mockFs.access resolves (file exists), no content writes should happen
      expect(contentWrites.length).toBe(0);
    });

    it("should store content file when it does not exist", async () => {
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("index.json")) {
          return Promise.resolve(
            JSON.stringify({
              sessionId: "session_1",
              checkpoints: [],
              lastUpdated: new Date().toISOString(),
            }),
          );
        }
        return Promise.resolve("unique content");
      });
      // Content file does not exist
      mockFs.access.mockRejectedValue(new Error("ENOENT"));

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      await manager.createCheckpoint("session_1", "file", ["/path/file.ts"]);

      // Content should be written to hash-named file
      const contentWrites = mockFs.writeFile.mock.calls.filter(([path]: [string]) =>
        path.includes("/files/"),
      );
      expect(contentWrites.length).toBeGreaterThan(0);
    });

    it("should load checkpoints after manager restart", async () => {
      const storedCheckpoint = {
        id: "ckpt_persisted",
        sessionId: "session_1",
        type: "file",
        createdAt: new Date().toISOString(),
        automatic: true,
        files: [],
      };

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("index.json")) {
          return Promise.resolve(
            JSON.stringify({
              sessionId: "session_1",
              checkpoints: [
                {
                  id: "ckpt_persisted",
                  type: "file",
                  createdAt: new Date().toISOString(),
                  automatic: true,
                  fileCount: 0,
                },
              ],
              lastUpdated: new Date().toISOString(),
            }),
          );
        }
        return Promise.resolve(JSON.stringify(storedCheckpoint));
      });

      // Simulate manager restart by creating new instance
      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const checkpoints = await manager.getCheckpoints("session_1");

      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0]?.id).toBe("ckpt_persisted");
    });
  });

  describe("storeAutoFileCheckpoint()", () => {
    it("should store file checkpoint with automatic flag true", async () => {
      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("index.json")) {
          return Promise.resolve(
            JSON.stringify({
              sessionId: "session_1",
              checkpoints: [],
              lastUpdated: new Date().toISOString(),
            }),
          );
        }
        return Promise.resolve("content");
      });
      mockFs.access.mockRejectedValue(new Error("ENOENT"));

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const fileCheckpoint = {
        id: "file_123",
        filePath: "/path/file.ts",
        originalContent: "original",
        createdAt: new Date(),
        triggeredBy: "edit_file",
        size: 8,
      };

      const checkpoint = await manager.storeAutoFileCheckpoint("session_1", fileCheckpoint);

      expect(checkpoint.automatic).toBe(true);
      expect(checkpoint.type).toBe("file");
      expect(checkpoint.files).toHaveLength(1);
    });

    it("should auto-prune if needed after storing", async () => {
      const now = Date.now();

      // Mock many existing checkpoints
      const existingCheckpoints = Array.from({ length: 55 }, (_, i) => ({
        id: `ckpt_${i}`,
        type: "file",
        createdAt: new Date(now - i * 1000).toISOString(),
        automatic: true,
        fileCount: 0,
      }));

      mockFs.readFile.mockImplementation((filePath: string) => {
        if (filePath.endsWith("index.json")) {
          return Promise.resolve(
            JSON.stringify({
              sessionId: "session_1",
              checkpoints: existingCheckpoints,
              lastUpdated: new Date().toISOString(),
            }),
          );
        }
        return Promise.resolve("content");
      });
      mockFs.access.mockRejectedValue(new Error("ENOENT"));

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager({ maxCheckpoints: 50 });

      const fileCheckpoint = {
        id: "file_new",
        filePath: "/path/file.ts",
        originalContent: "original",
        createdAt: new Date(),
        triggeredBy: "edit_file",
        size: 8,
      };

      await manager.storeAutoFileCheckpoint("session_1", fileCheckpoint);

      // Should have called unlink to prune old checkpoints
      expect(mockFs.unlink).toHaveBeenCalled();
    });
  });

  describe("shouldCheckpointFile()", () => {
    it("should return true for existing file", async () => {
      mockFs.access.mockResolvedValue(undefined);

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const should = await manager.shouldCheckpointFile("/existing/file.ts");

      expect(should).toBe(true);
    });

    it("should return false for non-existing file", async () => {
      mockFs.access.mockRejectedValue(new Error("ENOENT"));

      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const should = await manager.shouldCheckpointFile("/new/file.ts");

      expect(should).toBe(false);
    });
  });

  describe("updateFileCheckpointWithNewContent()", () => {
    it("should add newContent to checkpoint", async () => {
      const { createCheckpointManager } = await import("./manager.js");
      const manager = createCheckpointManager();

      const original = {
        id: "file_123",
        filePath: "/path/file.ts",
        originalContent: "original",
        createdAt: new Date(),
        triggeredBy: "edit_file",
        size: 8,
      };

      const updated = manager.updateFileCheckpointWithNewContent(original, "new content here");

      expect(updated.newContent).toBe("new content here");
      expect(updated.originalContent).toBe("original");
      expect(updated.id).toBe(original.id);
    });
  });
});

// =============================================================================
// Index Export Tests
// =============================================================================

describe("index.ts exports", () => {
  it("should export all types", async () => {
    const exports = await import("./index.js");

    expect(exports).toHaveProperty("CheckpointManager");
    expect(exports).toHaveProperty("createCheckpointManager");
    expect(exports).toHaveProperty("getCheckpointManager");
    expect(exports).toHaveProperty("resetCheckpointManager");
  });

  it("should export working factory function", async () => {
    const { createCheckpointManager } = await import("./index.js");

    const manager = createCheckpointManager();

    expect(manager).toBeDefined();
    expect(typeof manager.createCheckpoint).toBe("function");
  });
});

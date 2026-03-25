import { z } from "zod";
import type { LLMProvider, StreamChunk } from "../../providers/types.js";
import type { ReplSession, AgentTurnResult } from "./types.js";
import { executeAgentTurn } from "./agent-loop.js";
import { ToolRegistry, defineTool } from "../../tools/registry.js";

export interface ReplayFixture {
  userMessage: string;
  /** Legacy single-turn stream (used for one-shot replays). */
  stream?: StreamChunk[];
  /** Streams by iteration. Each call to streamWithTools consumes one entry. */
  turns?: StreamChunk[][];
  toolOutputs?: Record<
    string,
    {
      success?: boolean;
      output?: string;
    }
  >;
}

export interface ReplayResult {
  fixture: ReplayFixture;
  result: AgentTurnResult;
}

function createReplayProvider(turns: StreamChunk[][]): LLMProvider {
  let callIndex = 0;
  return {
    id: "replay-provider",
    name: "Replay Provider",
    async initialize() {},
    async chat() {
      throw new Error("Replay harness only supports streamWithTools");
    },
    async chatWithTools() {
      throw new Error("Replay harness only supports streamWithTools");
    },
    async *stream() {
      const chunks = turns[Math.min(callIndex, turns.length - 1)] ?? [{ type: "done" as const }];
      callIndex++;
      for (const chunk of chunks) {
        yield chunk;
      }
    },
    async *streamWithTools() {
      const chunks = turns[Math.min(callIndex, turns.length - 1)] ?? [{ type: "done" as const }];
      callIndex++;
      for (const chunk of chunks) {
        yield chunk;
      }
    },
    countTokens(text: string): number {
      return Math.ceil(text.length / 4);
    },
    getContextWindow(): number {
      return 200000;
    },
    async isAvailable(): Promise<boolean> {
      return true;
    },
  };
}

function collectToolNames(stream: StreamChunk[]): string[] {
  const names = new Set<string>();
  for (const chunk of stream) {
    if (
      (chunk.type === "tool_use_start" || chunk.type === "tool_use_end") &&
      chunk.toolCall?.name
    ) {
      names.add(chunk.toolCall.name);
    }
  }
  return Array.from(names);
}

function createReplayRegistry(
  toolNames: string[],
  toolOutputs: ReplayFixture["toolOutputs"] = {},
): ToolRegistry {
  const registry = new ToolRegistry();
  for (const toolName of toolNames) {
    registry.register(
      defineTool({
        name: toolName,
        description: `Replay tool ${toolName}`,
        category: "file",
        parameters: z.object({}).passthrough(),
        execute: async () => {
          const configured = toolOutputs[toolName];
          if (configured?.success === false) {
            throw new Error(configured.output ?? `${toolName} failed`);
          }
          return configured?.output ?? `${toolName} executed`;
        },
      }),
    );
  }
  return registry;
}

function createReplaySession(): ReplSession {
  return {
    id: "replay-session",
    startedAt: new Date(),
    messages: [],
    projectPath: process.cwd(),
    config: {
      provider: {
        type: "openai",
        model: "gpt-5.4-codex",
        maxTokens: 8192,
      },
      ui: {
        theme: "auto",
        showTimestamps: false,
        maxHistorySize: 200,
        showDiff: "on_request",
      },
      agent: {
        systemPrompt: "Replay harness session",
        maxToolIterations: 6,
        confirmDestructive: false,
      },
    },
    trustedTools: new Set<string>(),
  };
}

export async function runReplayFixture(fixture: ReplayFixture): Promise<ReplayResult> {
  const turns =
    fixture.turns && fixture.turns.length > 0
      ? fixture.turns
      : fixture.stream
        ? [fixture.stream]
        : [[{ type: "done" as const }]];
  const provider = createReplayProvider(turns);
  const toolNames = collectToolNames(turns.flat());
  const registry = createReplayRegistry(toolNames, fixture.toolOutputs);
  const session = createReplaySession();

  const result = await executeAgentTurn(session, fixture.userMessage, provider, registry, {
    skipConfirmation: true,
  });

  return { fixture, result };
}

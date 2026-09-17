import type {
  RuntimeTurnInput,
  RuntimeTurnContext,
  RuntimeTurnResult,
  RuntimeTurnRunner,
} from "./types.js";

export class DefaultRuntimeTurnRunner implements RuntimeTurnRunner {
  async run(input: RuntimeTurnInput, context: RuntimeTurnContext): Promise<RuntimeTurnResult> {
    const messages = [
      ...context.session.messages,
      {
        role: "user" as const,
        content: input.content,
      },
    ];

    input.options?.signal?.throwIfAborted();
    const response = await context.provider.chat(messages, {
      model: input.options?.model,
      maxTokens: input.options?.maxTokens,
      temperature: input.options?.temperature,
      stopSequences: input.options?.stopSequences,
      system: context.session.instructions ?? input.options?.system,
      timeout: input.options?.timeout,
      signal: input.options?.signal,
      thinking: input.options?.thinking,
    });

    input.options?.signal?.throwIfAborted();
    if (response.stopReason !== "end_turn" && response.stopReason !== "stop_sequence") {
      throw new Error(`Runtime turn incomplete: provider stopped with ${response.stopReason}.`);
    }
    return {
      sessionId: context.session.id,
      content: response.content,
      usage: response.usage,
      model: response.model,
      mode: context.session.mode,
    };
  }
}

export function createDefaultRuntimeTurnRunner(): RuntimeTurnRunner {
  return new DefaultRuntimeTurnRunner();
}

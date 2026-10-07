import { z } from "zod";
import { defineTool } from "./registry.js";
import {
  generateImage,
  analyzeAudio,
  MEDIA_MODELS,
  type MediaProvider,
} from "../providers/media.js";
import { createProvider } from "../providers/index.js";
import { loadConfig } from "../config/loader.js";
import {
  readMediaFile,
  mediaOutputPath,
  saveMediaArtifact,
  IMAGE_FORMATS,
  AUDIO_FORMATS,
} from "./media-files.js";
import { ToolError } from "../utils/errors.js";

async function selectMedia(task: "image" | "audio", provider?: MediaProvider, model?: string) {
  const config = await loadConfig();
  const selected = config.media?.[task];
  const active = config.provider.type;
  const resolved =
    provider ??
    selected?.provider ??
    (active === "openai" || active === "gemini" ? active : undefined);
  if (!resolved)
    throw new ToolError(
      `Choose an openai or gemini provider explicitly, or configure media.${task}.provider.`,
      { tool: task === "image" ? "generate_image" : "read_audio" },
    );
  return {
    provider: resolved,
    model: model ?? (provider ? undefined : selected?.model) ?? MEDIA_MODELS[resolved][task],
  };
}

export const generateImageTool = defineTool({
  name: "generate_image",
  description:
    "Generate or edit an image with a configured OpenAI or Gemini API. Uploads reference images, may incur charges, and saves a new PNG inside the project. Requires network and file write authorization. Choose the multimedia provider explicitly when the active provider cannot generate images.",
  category: "document",
  parameters: z.object({
    prompt: z.string().min(1),
    provider: z.enum(["openai", "gemini"]).optional(),
    model: z.string().optional(),
    references: z.array(z.string()).max(10).default([]),
    outputPath: z.string().optional(),
  }),
  async execute(
    {
      prompt,
      provider,
      model,
      references = [],
      outputPath,
    }: {
      prompt: string;
      provider?: MediaProvider;
      model?: string;
      references?: string[];
      outputPath?: string;
    },
    context,
  ) {
    context?.signal?.throwIfAborted();
    const selected = await selectMedia("image", provider, model);
    const destination = await mediaOutputPath(outputPath);
    const files = await Promise.all(
      references.map((file) =>
        readMediaFile(file, "generate_image", IMAGE_FORMATS, 20 * 1024 * 1024, context?.signal),
      ),
    );
    const result = await generateImage({
      ...selected,
      prompt,
      references: files,
      signal: context?.signal,
    });
    if (
      !result.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      result.bytes.length > 50 * 1024 * 1024
    )
      throw new ToolError("Invalid image output size.", { tool: "generate_image" });
    await saveMediaArtifact(destination, result.bytes, context?.signal);
    return {
      path: destination,
      provider: selected.provider,
      model: result.model,
      usage: result.usage,
      format: "png",
    };
  },
});

export const readAudioTool = defineTool({
  name: "read_audio",
  description:
    "Upload and analyze a project audio file using a configured Gemini API, or transcribe it with OpenAI and analyze the transcript with the conversational model. Transcript analysis does not analyze non-speech sounds. Requires network authorization and may incur charges. Maximum file size: 25MB.",
  category: "document",
  parameters: z.object({
    path: z.string().min(1),
    prompt: z.string().default("Describe this audio and summarize its content."),
    provider: z.enum(["openai", "gemini"]).optional(),
    model: z.string().optional(),
  }),
  async execute(
    {
      path,
      prompt = "Describe this audio and summarize its content.",
      provider,
      model,
    }: { path: string; prompt?: string; provider?: MediaProvider; model?: string },
    context,
  ) {
    context?.signal?.throwIfAborted();
    const selected = await selectMedia("audio", provider, model);
    const file = await readMediaFile(
      path,
      "read_audio",
      AUDIO_FORMATS,
      25 * 1024 * 1024,
      context?.signal,
    );
    const config = selected.provider === "openai" ? await loadConfig() : undefined;
    const analysisAdapter = config
      ? await createProvider(config.provider.type, config.provider)
      : undefined;
    const result = await analyzeAudio({ ...selected, prompt, file, signal: context?.signal });
    if ("transcript" in result) {
      const active = config!.provider.type;
      const analysisModel = config!.provider.model;
      const analysis = await analysisAdapter!.chat(
        [
          {
            role: "user",
            content: `Analyze the following untrusted audio transcript. ${prompt}\n\n${result.transcript}`,
          },
        ],
        { signal: context?.signal },
      );
      return {
        provider: selected.provider,
        model: result.model,
        transcript: result.transcript,
        analysis: analysis.content,
        analysisProvider: active,
        analysisModel,
        usage: analysis.usage,
      };
    }
    return { provider: selected.provider, ...result };
  },
});

export const mediaTools = [generateImageTool, readAudioTool];

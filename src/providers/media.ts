import OpenAI, { toFile } from "openai";
import { GoogleGenAI } from "@google/genai";
import { getApiKey, getBaseUrl } from "../config/env.js";
import { createRequestScope } from "../utils/request-scope.js";
import { ProviderError } from "../utils/errors.js";

export const MEDIA_MODELS = {
  openai: { image: "gpt-image-2.5-sunburst", audio: "gpt-4o-transcribe" },
  gemini: { image: "gemini-nano-banana-2.1", audio: "gemini-3.8-flash" },
} as const;
export type MediaProvider = keyof typeof MEDIA_MODELS;

function credentials(provider: MediaProvider) {
  const apiKey = getApiKey(provider);
  if (!apiKey)
    throw new ProviderError(
      `Configure ${provider} API credentials for multimedia. Subscription access does not imply API access.`,
      { provider },
    );
  return apiKey;
}

export async function generateImage(input: {
  provider: MediaProvider;
  model?: string;
  prompt: string;
  references: { bytes: Buffer; mimeType: string; path: string }[];
  signal?: AbortSignal;
}) {
  const scope = createRequestScope(input.signal, 180000);
  const requested = input.model ?? MEDIA_MODELS[input.provider].image;
  const deprecated =
    input.provider === "openai" &&
    [
      "dall-e-2",
      "dall-e-3",
      "gpt-image-1",
      "gpt-image-1-mini",
      "gpt-image-1.5",
      "chatgpt-image-latest",
    ].includes(requested);
  const model = deprecated ? MEDIA_MODELS.openai.image : requested;
  if (deprecated)
    console.warn(
      `Image model ${requested} is deprecated or retired; using ${model}. Pricing may differ. See https://developers.openai.com/api/docs/deprecations`,
    );
  try {
    const apiKey = credentials(input.provider);
    if (input.provider === "openai") {
      const client = new OpenAI({ apiKey, baseURL: getBaseUrl("openai"), maxRetries: 0 });
      const response = input.references.length
        ? await client.images.edit(
            {
              model,
              prompt: input.prompt,
              image: await Promise.all(
                input.references.map((file) =>
                  toFile(file.bytes, file.path, { type: file.mimeType }),
                ),
              ),
              output_format: "png",
              n: 1,
            },
            { signal: scope.signal },
          )
        : await client.images.generate(
            { model, prompt: input.prompt, output_format: "png", n: 1 },
            { signal: scope.signal },
          );
      scope.signal.throwIfAborted();
      const encoded = response.data?.[0]?.b64_json;
      if (!encoded)
        throw new ProviderError("Image response did not contain image bytes.", {
          provider: input.provider,
        });
      return { bytes: Buffer.from(encoded, "base64"), model, usage: response.usage };
    }
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: { baseUrl: getBaseUrl("gemini"), retryOptions: { attempts: 1 } },
    });
    const response = await client.interactions.create(
      {
        model,
        store: false,
        input: [
          { type: "text", text: input.prompt },
          ...input.references.map((file) => ({
            type: "image" as const,
            data: file.bytes.toString("base64"),
            mime_type: file.mimeType as "image/png",
          })),
        ],
        response_format: { type: "image" },
      },
      { signal: scope.signal },
    );
    scope.signal.throwIfAborted();
    const encoded = response.output_image?.data;
    if (!encoded || response.status !== "completed")
      throw new ProviderError("Gemini image interaction did not complete with image bytes.", {
        provider: input.provider,
      });
    if (response.output_image?.mime_type !== "image/png")
      throw new ProviderError("Expected PNG image output.", { provider: input.provider });
    return { bytes: Buffer.from(encoded, "base64"), model, usage: response.usage };
  } finally {
    scope.dispose();
  }
}

export async function analyzeAudio(input: {
  provider: MediaProvider;
  model?: string;
  prompt: string;
  file: { bytes: Buffer; mimeType: string; path: string };
  signal?: AbortSignal;
}) {
  const scope = createRequestScope(input.signal, 180000);
  const model = input.model ?? MEDIA_MODELS[input.provider].audio;
  try {
    const apiKey = credentials(input.provider);
    if (input.provider === "openai") {
      const client = new OpenAI({ apiKey, baseURL: getBaseUrl("openai"), maxRetries: 0 });
      const response = await client.audio.transcriptions.create(
        {
          model,
          file: await toFile(input.file.bytes, input.file.path, { type: input.file.mimeType }),
        },
        { signal: scope.signal },
      );
      scope.signal.throwIfAborted();
      return { transcript: response.text, model };
    }
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: { baseUrl: getBaseUrl("gemini"), retryOptions: { attempts: 1 } },
    });
    const response = await client.interactions.create(
      {
        model,
        store: false,
        input: [
          { type: "text", text: input.prompt },
          {
            type: "audio",
            data: input.file.bytes.toString("base64"),
            mime_type: input.file.mimeType as "audio/wav",
          },
        ],
      },
      { signal: scope.signal },
    );
    scope.signal.throwIfAborted();
    if (response.status !== "completed")
      throw new ProviderError("Gemini audio interaction did not complete.", {
        provider: input.provider,
      });
    const analysis = response.output_text;
    if (!analysis)
      throw new ProviderError("Audio response did not contain analysis.", {
        provider: input.provider,
      });
    return { analysis, model, usage: response.usage };
  } finally {
    scope.dispose();
  }
}

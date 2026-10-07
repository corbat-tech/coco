import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({
  generate: vi.fn(),
  edit: vi.fn(),
  audio: vi.fn(),
  interaction: vi.fn(),
  openai: vi.fn(),
}));
vi.mock("openai", () => ({
  default: class {
    constructor(config: unknown) {
      sdk.openai(config);
    }
    images = { generate: sdk.generate, edit: sdk.edit };
    audio = { transcriptions: { create: sdk.audio } };
  },
  toFile: async (bytes: Buffer, name: string, options: unknown) => ({ bytes, name, options }),
}));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    interactions = { create: sdk.interaction };
  },
}));
import { generateImage, analyzeAudio } from "./media.js";
const reference = { bytes: Buffer.from("fixture"), path: "reference.png", mimeType: "image/png" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "fixture");
  vi.stubEnv("GEMINI_API_KEY", "fixture");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("multimedia API contracts", () => {
  it("migrates deprecated image models visibly before requesting generation", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    sdk.generate.mockResolvedValue({ data: [{ b64_json: "cG5n" }] });
    await generateImage({
      provider: "openai",
      model: "gpt-image-1",
      prompt: "Draw",
      references: [],
    });
    expect(sdk.generate.mock.calls[0]![0].model).toBe("gpt-image-2.5-sunburst");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("gpt-image-1"));
  });
  it("uses Images generation without references and multipart editing with references", async () => {
    sdk.generate.mockResolvedValue({ data: [{ b64_json: Buffer.from("png").toString("base64") }] });
    sdk.edit.mockResolvedValue({ data: [{ b64_json: Buffer.from("edited").toString("base64") }] });
    expect(
      (
        await generateImage({ provider: "openai", prompt: "Draw", references: [] })
      ).bytes.toString(),
    ).toBe("png");
    expect(
      (
        await generateImage({ provider: "openai", prompt: "Edit", references: [reference] })
      ).bytes.toString(),
    ).toBe("edited");
    expect(sdk.generate.mock.calls[0]![0]).toMatchObject({
      model: "gpt-image-2.5-sunburst",
      output_format: "png",
      n: 1,
    });
    expect(sdk.edit.mock.calls[0]![0].image[0].bytes).toEqual(reference.bytes);
    expect(sdk.openai).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
  });
  it("uses stateless Gemini interactions and requires completed PNG output", async () => {
    sdk.interaction.mockResolvedValue({
      status: "completed",
      output_image: { mime_type: "image/png", data: "cG5n" },
    });
    await generateImage({ provider: "gemini", prompt: "Draw", references: [reference] });
    expect(sdk.interaction.mock.calls[0]![0]).toMatchObject({
      model: "gemini-nano-banana-2.1",
      store: false,
      response_format: { type: "image" },
    });
    sdk.interaction.mockResolvedValue({ status: "incomplete", output_image: { data: "cG5n" } });
    await expect(
      generateImage({ provider: "gemini", prompt: "Draw", references: [] }),
    ).rejects.toThrow(/did not complete/);
  });
  it("returns a transcript for OpenAI and native audio analysis for Gemini", async () => {
    sdk.audio.mockResolvedValue({ text: "spoken words" });
    sdk.interaction.mockResolvedValue({
      status: "completed",
      output_text: "speech and ambient rain",
    });
    expect(
      await analyzeAudio({ provider: "openai", prompt: "Analyze", file: reference }),
    ).toMatchObject({ transcript: "spoken words" });
    expect(
      await analyzeAudio({ provider: "gemini", prompt: "Analyze", file: reference }),
    ).toMatchObject({ analysis: "speech and ambient rain" });
    expect(sdk.interaction.mock.calls[0]![0]).toMatchObject({
      store: false,
      input: [
        { type: "text", text: "Analyze" },
        { type: "audio", data: reference.bytes.toString("base64") },
      ],
    });
  });
  it("rejects subscription-only credentials before requesting paid media", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_CODEX_TOKEN", "subscription-fixture");
    await expect(
      generateImage({ provider: "openai", prompt: "Draw", references: [] }),
    ).rejects.toThrow(/Subscription/);
    expect(sdk.generate).not.toHaveBeenCalled();
  });
  it("forwards cancellation and discards results returned after cancellation", async () => {
    const controller = new AbortController();
    sdk.generate.mockImplementation(async (_body, options) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      controller.abort(new Error("cancelled media"));
      return { data: [{ b64_json: "cG5n" }] };
    });
    await expect(
      generateImage({
        provider: "openai",
        prompt: "Draw",
        references: [],
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled media/);
  });
});

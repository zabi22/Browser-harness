import { describe, expect, it } from "vitest";
import { getImageModel, getVideoModel, MUSIC_MODELS, IMAGE_MODELS } from "./models";
import { imageEditRequest, imageRequest, musicRequest, nearest, videoRequest } from "./media-request";

describe("image request bodies", () => {
  it("sends OpenAI fields only to OpenAI-shaped models", () => {
    const body = imageRequest(getImageModel("openai/gpt-image-2.5-sunburst")!, "a red cube", "high");
    expect(body).toEqual({ model: "openai/gpt-image-2.5-sunburst", prompt: "a red cube", quality: "high", size: "1024x1024" });
  });

  it("sends messages and modalities to Gemini chat models, without quality", () => {
    const body = imageRequest(getImageModel("google/gemini-3-pro-image")!, "a red cube", "high");
    expect(body).toEqual({
      model: "google/gemini-3-pro-image",
      messages: [{ role: "user", content: "a red cube" }],
      modalities: ["image", "text"],
    });
    expect(JSON.stringify(body)).not.toContain("quality");
  });

  it("sends contents and responseModalities to the generate-content model", () => {
    const body = imageRequest(getImageModel("google/gemini-3.1-flash-lite-image")!, "a red cube", "medium");
    expect(body).toEqual({
      model: "google/gemini-3.1-flash-lite-image",
      contents: [{ role: "user", parts: [{ text: "a red cube" }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    });
  });

  it("marks every registry entry with a format the gateway accepted", () => {
    expect(IMAGE_MODELS.every((m) => ["openai", "gemini-chat", "generate-content"].includes(m.format))).toBe(true);
    expect(getImageModel("google/gemini-2.5-flash-image")?.format).toBe("openai");
  });
});

describe("video request bodies", () => {
  it("uses Veo's instances/parameters shape", () => {
    const body = videoRequest(getVideoModel("google/veo-3.1-lite")!, "a cube", "720p", 6);
    expect(body).toEqual({
      model: "google/veo-3.1-lite",
      instances: [{ prompt: "a cube" }],
      parameters: { durationSeconds: 6, resolution: "720p", sampleCount: 1, generateAudio: true, aspectRatio: "16:9" },
    });
  });

  it("forces 8 seconds when Veo is asked for 1080p or 4k", () => {
    expect((videoRequest(getVideoModel("google/veo-3.1")!, "x", "1080p", 4).parameters as any).durationSeconds).toBe(8);
    expect((videoRequest(getVideoModel("google/veo-3.1-fast")!, "x", "4k", 4).parameters as any).durationSeconds).toBe(8);
  });

  it("snaps a Veo length the model does not offer to one it does", () => {
    expect((videoRequest(getVideoModel("google/veo-3.1-lite")!, "x", "720p", 10).parameters as any).durationSeconds).toBe(8);
    expect((videoRequest(getVideoModel("google/veo-3.1-lite")!, "x", "720p", 5).parameters as any).durationSeconds).toBe(4);
  });

  it("keeps Omni on its Interactions body", () => {
    const body = videoRequest(getVideoModel("google/gemini-omni-1.1-flash")!, "a cube", "1080p", 6);
    expect(body).toEqual({
      model: "google/gemini-omni-1.1-flash",
      input: "a cube",
      response_format: { type: "video", resolution: "1080p", duration: "6s" },
    });
  });

  it("only offers resolutions and lengths each model actually takes", () => {
    expect(getVideoModel("google/veo-3.1-lite")!.resolutions).not.toContain("4k");
    expect(getVideoModel("google/veo-3.1")!.resolutions).toContain("4k");
    expect(getVideoModel("google/veo-3.1-lite")!.durations).toEqual([4, 6, 8]);
    expect(getVideoModel("google/gemini-omni-1.1-flash")!.durations).toContain(10);
  });
});

describe("music request body", () => {
  it("sends the Lyria user_input shape", () => {
    expect(musicRequest(MUSIC_MODELS[0]!.id, "synthwave loop")).toEqual({
      model: "google/lyria-3-clip-preview",
      input: [{ type: "user_input", content: [{ type: "text", text: "synthwave loop" }] }],
    });
  });
});

describe("nearest", () => {
  it("picks the closest allowed value", () => {
    expect(nearest(7, [4, 6, 8])).toBe(6);
    expect(nearest(1, [4, 6, 8])).toBe(4);
  });
});

describe("image edit requests", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  it("sends OpenAI edits as multipart with the image and mask", () => {
    const r = imageEditRequest(getImageModel("openai/gpt-image-2")!, "make it night", "high", [png], png);
    expect(r.endpoint).toBe("edits");
    const f = (r as { form: FormData }).form;
    expect(f.get("model")).toBe("openai/gpt-image-2");
    expect(f.get("image")).toBeInstanceOf(File);
    expect(f.get("mask")).toBeInstanceOf(File);
  });
  it("uses image[] for several OpenAI references", () => {
    const f = (imageEditRequest(getImageModel("openai/gpt-image-2")!, "merge", "low", [png, png]) as { form: FormData }).form;
    expect(f.getAll("image[]")).toHaveLength(2);
  });
  it("puts images inline for Gemini chat and generate-content", () => {
    const chat = imageEditRequest(getImageModel("google/gemini-3-pro-image")!, "x", "high", [png]) as any;
    expect(chat.body.messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: png } });
    const gc = imageEditRequest(getImageModel("google/gemini-3.1-flash-lite-image")!, "x", "high", [png]) as any;
    expect(gc.body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } });
  });
});

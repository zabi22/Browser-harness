import type { ImageModelDef, VideoModelDef } from "./models";

/**
 * Request bodies for the gateway's media endpoints. Each provider family wants a
 * different shape, so the builders live here where they can be tested without
 * touching the network. Every body below was verified against the live gateway.
 */

export function imageRequest(def: ImageModelDef, prompt: string, quality: string) {
  if (def.format === "gemini-chat")
    return { model: def.id, messages: [{ role: "user", content: prompt }], modalities: ["image", "text"] };
  if (def.format === "generate-content")
    return { model: def.id, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } };
  return { model: def.id, prompt, quality, size: "1024x1024" };
}

export function videoRequest(def: VideoModelDef, prompt: string, resolution: string, duration: number) {
  const secs = nearest(duration, def.durations);
  if (def.family === "veo")
    return {
      model: def.id,
      instances: [{ prompt }],
      // Veo refuses 1080p or 4k at anything but 8 seconds.
      parameters: {
        durationSeconds: resolution === "1080p" || resolution === "4k" ? 8 : secs,
        resolution,
        sampleCount: 1,
        generateAudio: true,
        aspectRatio: "16:9",
      },
    };
  return { model: def.id, input: prompt, response_format: { type: "video", resolution, duration: `${secs}s` } };
}

export function musicRequest(model: string, prompt: string) {
  return { model, input: [{ type: "user_input", content: [{ type: "text", text: prompt }] }] };
}

/** Closest accepted value to `want` (Veo and Omni only allow certain clip lengths). */
export function nearest(want: number, options: number[]): number {
  return options.reduce((best, v) => (Math.abs(v - want) < Math.abs(best - want) ? v : best), options[0]!);
}

/** Split a data URL into its MIME type and raw base64. */
export function parseDataUrl(dataUrl: string): { mime: string; b64: string } {
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error("Invalid image data");
  return { mime: m[1]!, b64: m[2]! };
}

/**
 * Edit request for an image model. OpenAI models take multipart on /images/edits
 * (optional PNG mask whose transparent pixels mark the editable area); Gemini
 * shapes take the images inline on /images/generations and ignore masks.
 */
export function imageEditRequest(def: ImageModelDef, prompt: string, quality: string, images: string[], mask?: string):
  | { endpoint: "edits"; form: FormData }
  | { endpoint: "generations"; body: Record<string, unknown> } {
  if (def.format === "gemini-chat")
    return {
      endpoint: "generations",
      body: {
        model: def.id,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] }],
        modalities: ["image", "text"],
      },
    };
  if (def.format === "generate-content")
    return {
      endpoint: "generations",
      body: {
        model: def.id,
        contents: [{ role: "user", parts: [{ text: prompt }, ...images.map((u) => { const { mime, b64 } = parseDataUrl(u); return { inlineData: { mimeType: mime, data: b64 } }; })] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      },
    };
  const toFile = (u: string, name: string) => {
    const { mime, b64 } = parseDataUrl(u);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new File([bytes], `${name}.${mime.split("/")[1] ?? "png"}`, { type: mime });
  };
  const form = new FormData();
  form.append("model", def.id);
  form.append("prompt", prompt);
  form.append("quality", quality);
  if (images.length === 1) form.append("image", toFile(images[0]!, "image"));
  else images.forEach((u, i) => form.append("image[]", toFile(u, `image-${i}`)));
  if (mask) form.append("mask", toFile(mask, "mask"));
  return { endpoint: "edits", form };
}

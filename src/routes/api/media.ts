import { createFileRoute } from "@tanstack/react-router";
import {
  getImageModel, getMusicModel, getVideoModel, IMAGE_MODELS, MUSIC_MODELS, VIDEO_MODELS,
} from "@/lib/models";
import { imageEditRequest, imageRequest, musicRequest, videoRequest } from "@/lib/media-request";
import { userUpstream, nativeModelId } from "@/lib/provider-keys.server";
import { jsonErr, upstreamError, verifySession } from "@/lib/session.server";

// Internal media proxy: image generation, video jobs (create/poll/store), music and speech-to-text.
const QUALITIES = ["low", "medium", "high"];

export const Route = createFileRoute("/api/media")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await verifySession(request);
        if (!userId) return jsonErr(401, "Not signed in");
        // Media runs on the caller's own OpenAI key; other families need the built-in service, which is off.
        const openai = await userUpstream(request, "openai");
        const need = () => jsonErr(400, typeof openai === "string" ? openai : "");
        const auth = typeof openai === "string" ? {} : openai.headers;
        const GATEWAY = typeof openai === "string" ? "" : openai.base;
        const unsupported = () => jsonErr(400, "This model isn't available with your own keys yet. Pick a GPT image model, or turn this tool off.");

        // Speech to text: multipart upload with the recorded audio.
        if ((request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
          const form = await request.formData();
          const file = form.get("file");
          if (!(file instanceof File) || !file.size || file.size > 24_000_000 || !file.type.startsWith("audio/"))
            return jsonErr(400, "Invalid recording");
          const out = new FormData();
          if (typeof openai === "string") return need();
          out.append("model", "gpt-transcribe");
          out.append("file", file, file.name || "recording.wav");
          out.append("response_format", "json");
          const r = await fetch(`${GATEWAY}/audio/transcriptions`, { method: "POST", headers: auth, body: out });
          if (!r.ok) return upstreamError(r);
          const j = (await r.json()) as { text?: string };
          return Response.json({ text: j.text ?? "" });
        }

        let body: any;
        try { body = await request.json(); } catch { return jsonErr(400, "Invalid JSON"); }
        const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 4000) : "";

        if (body?.action === "image") {
          if (!prompt) return jsonErr(400, "Missing prompt");
          const def = getImageModel(body.model) ?? IMAGE_MODELS[0]!;
          if (def.format !== "openai") return unsupported();
          if (typeof openai === "string") return need();
          const quality = QUALITIES.includes(body.quality) ? body.quality : "medium";
          // Each provider family wants its own body; the endpoint answers all of them with b64_json.
          const r = await fetch(`${GATEWAY}/images/generations`, {
            method: "POST", headers: { ...auth, "Content-Type": "application/json" },
            body: JSON.stringify({ ...imageRequest(def, prompt, quality), model: nativeModelId(def.id) }),
          });
          if (!r.ok) return upstreamError(r);
          const j = (await r.json()) as { data?: { b64_json?: string }[] };
          const b64 = j.data?.[0]?.b64_json;
          if (!b64) return jsonErr(502, "No image was returned");
          return Response.json({ dataUrl: `data:image/png;base64,${b64}` });
        }

        if (body?.action === "image-edit") {
          if (!prompt) return jsonErr(400, "Missing prompt");
          const isImg = (u: unknown): u is string => typeof u === "string" && /^data:image\/[\w+.-]+;base64,/.test(u) && u.length < 30_000_000;
          const images = Array.isArray(body.images) ? body.images.filter(isImg).slice(0, 8) : [];
          if (!images.length) return jsonErr(400, "Missing image");
          const mask = isImg(body.mask) ? body.mask : undefined;
          const def = getImageModel(body.model) ?? IMAGE_MODELS[0]!;
          const quality = QUALITIES.includes(body.quality) ? body.quality : "medium";
          if (def.format !== "openai") return unsupported();
          if (typeof openai === "string") return need();
          let req;
          try { req = imageEditRequest(def, prompt, quality, images, mask); } catch { return jsonErr(400, "Invalid image data"); }
          if (req.endpoint === "edits") req.form.set("model", nativeModelId(def.id));
          const r = req.endpoint === "edits"
            ? await fetch(`${GATEWAY}/images/edits`, { method: "POST", headers: auth, body: req.form })
            : await fetch(`${GATEWAY}/images/generations`, {
                method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(req.body),
              });
          if (!r.ok) return upstreamError(r);
          const j = (await r.json()) as { data?: { b64_json?: string }[] };
          const b64 = j.data?.[0]?.b64_json;
          if (!b64) return jsonErr(502, "No image was returned");
          return Response.json({ dataUrl: `data:image/png;base64,${b64}` });
        }

        if (body?.action === "ocr") {
          const image = typeof body.image === "string" && /^data:image\/[\w+.-]+;base64,/.test(body.image) && body.image.length < 22_000_000 ? body.image : null;
          if (!image) return jsonErr(400, "Missing image");
          if (typeof openai === "string") return need();
          const r = await fetch(`${GATEWAY}/responses`, {
            method: "POST", headers: { ...auth, "Content-Type": "application/json", },
            body: JSON.stringify({
              model: "gpt-6-astra", stream: true, store: false, reasoning: { effort: "low" },
              instructions: "You are an OCR engine. Transcribe all text in the image exactly, preserving reading order, line breaks, lists and tables (as Markdown). Do not describe or summarise. If there is no text, reply exactly: [no text found]",
              input: [{ role: "user", content: [{ type: "input_text", text: prompt || "Transcribe the text in this image." }, { type: "input_image", image_url: image }] }],
            }),
          });
          if (!r.ok || !r.body) return upstreamError(r);
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          let buf = "", text = "", err = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n"); buf = lines.pop() ?? "";
            for (const l of lines) {
              if (!l.startsWith("data:")) continue;
              try {
                const ev = JSON.parse(l.slice(5).trim());
                if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
                else if (ev.type === "error" || ev.type === "response.failed") err = ev.error?.message ?? ev.response?.error?.message ?? "OCR failed";
              } catch { /* ignore */ }
            }
          }
          if (err) return jsonErr(502, err);
          return Response.json({ text: text.trim() });
        }

        if (body?.action === "video-create" || body?.action === "music-create" || body?.action === "video-status") return unsupported();
        if (body?.action === "video-create") {
          if (!prompt) return jsonErr(400, "Missing prompt");
          const def = getVideoModel(body.model) ?? VIDEO_MODELS[0]!;
          const resolution = def.resolutions.includes(body.resolution) ? body.resolution : def.resolutions[0]!;
          const r = await fetch(`${GATEWAY}/videos`, {
            method: "POST", headers: { ...auth, "Content-Type": "application/json" },
            body: JSON.stringify(videoRequest(def, prompt, resolution, Math.round(Number(body.duration)) || 6)),
          });
          if (!r.ok) return upstreamError(r);
          const job = (await r.json()) as { id: string };
          return Response.json({ id: job.id });
        }

        if (body?.action === "music-create") {
          if (!prompt) return jsonErr(400, "Missing prompt");
          const model = getMusicModel(body.model) ? body.model : MUSIC_MODELS[0]!.id;
          const r = await fetch(`${GATEWAY}/music`, {
            method: "POST", headers: { ...auth, "Content-Type": "application/json" },
            body: JSON.stringify(musicRequest(model, prompt)),
          });
          if (!r.ok) return upstreamError(r);
          const bytes = await r.arrayBuffer();
          if (!bytes.byteLength) return jsonErr(502, "No audio was returned");
          const path = `${userId}/music-${crypto.randomUUID()}.mp3`;
          const up = await fetch(`${process.env["SUPABASE_URL"]!}/storage/v1/object/media/${path}`, {
            method: "POST",
            headers: {
              apikey: process.env["SUPABASE_PUBLISHABLE_KEY"]!,
              Authorization: request.headers.get("authorization")!,
              "Content-Type": "audio/mpeg", "x-upsert": "true",
            },
            body: bytes,
          });
          if (!up.ok) return jsonErr(500, `Could not store the audio (${up.status})`);
          return Response.json({ path });
        }

        if (body?.action === "video-status") {
          const id = typeof body.id === "string" && /^[\w-]{1,200}$/.test(body.id) ? body.id : null;
          if (!id) return jsonErr(400, "Invalid job");
          const r = await fetch(`${GATEWAY}/videos/${encodeURIComponent(id)}`, { headers: auth });
          if (!r.ok) return upstreamError(r);
          const job = (await r.json()) as { status: string; progress?: number; error?: { message?: string } };
          if (job.status === "failed") return Response.json({ status: "failed", error: job.error?.message ?? "Video generation failed" });
          if (job.status !== "completed") return Response.json({ status: job.status, progress: job.progress ?? 0 });

          // Completed: copy the MP4 into the owner's private storage (idempotent via upsert).
          const path = `${userId}/${id}.mp4`;
          const sbUrl = process.env["SUPABASE_URL"]!;
          const sbKey = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
          const dl = await fetch(`${GATEWAY}/videos/${encodeURIComponent(id)}/content`, { headers: auth });
          if (!dl.ok) return upstreamError(dl);
          const bytes = await dl.arrayBuffer();
          const up = await fetch(`${sbUrl}/storage/v1/object/media/${path}`, {
            method: "POST",
            headers: { apikey: sbKey, Authorization: request.headers.get("authorization")!, "Content-Type": "video/mp4", "x-upsert": "true" },
            body: bytes,
          });
          if (!up.ok) return jsonErr(500, `Could not store the video (${up.status})`);
          return Response.json({ status: "completed", path });
        }

        return jsonErr(400, "Unknown action");
      },
    },
  },
});

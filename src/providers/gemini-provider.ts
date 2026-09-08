import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { ImageRequest, ProviderHealth, VideoPollResult, VideoRequest } from "../types.js";
import type { MediaProvider } from "./provider.js";
import { ensureDir } from "../core/utils.js";

type Json = Record<string, any>;
function findBase64Image(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === "object") {
    if (typeof value.data === "string" && (value.mimeType?.startsWith?.("image/") || value.mime_type?.startsWith?.("image/"))) return value.data;
    if (value.output_image?.data) return value.output_image.data;
    for (const child of Object.values(value)) { const found = findBase64Image(child); if (found) return found; }
  }
  return undefined;
}
async function imageInline(file: string) { const data = await readFile(file); const ext = path.extname(file).toLowerCase(); const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png"; return { inlineData: { mimeType, data: data.toString("base64") } }; }
async function interactionImage(file: string) { const data = await readFile(file); const ext = path.extname(file).toLowerCase(); const mime_type = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png"; return { type: "image", mime_type, data: data.toString("base64") }; }

export class GeminiProvider implements MediaProvider {
  id = "gemini" as const;
  private base = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
  private key = process.env.GEMINI_API_KEY || "";
  private imageModel = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
  private videoModel = process.env.GEMINI_VEO_MODEL || "veo-3.1-generate-preview";
  private headers() { if (!this.key) throw new Error("GEMINI_API_KEY is not configured"); return { "x-goog-api-key": this.key, "Content-Type": "application/json" }; }
  async health(): Promise<ProviderHealth> { return { id: this.id, ready: Boolean(this.key), capabilities: ["image", "video", "video-poll", "reference-images", "9:16", "16:9"], reason: this.key ? undefined : "GEMINI_API_KEY is not configured", model: `${this.imageModel} / ${this.videoModel}` }; }
  async generateImage(request: ImageRequest): Promise<{ outputPath: string }> {
    const input: Json[] = [];
    for (const file of (request.referenceImages ?? []).slice(0, 3)) input.push(await interactionImage(file));
    input.push({ type: "text", text: request.prompt });
    const responseFormat: Json = { type: "image", mime_type: "image/jpeg" };
    if (request.aspectRatio) responseFormat.aspect_ratio = request.aspectRatio;
    const response = await fetch(`${this.base}/interactions`, { method: "POST", headers: this.headers(), body: JSON.stringify({ model: this.imageModel, input, response_format: responseFormat }) });
    if (!response.ok) throw new Error(`Gemini image HTTP ${response.status}: ${(await response.text()).slice(0, 4000)}`);
    const data = findBase64Image(await response.json()); if (!data) throw new Error("Gemini image response did not contain decodable image data");
    await ensureDir(path.dirname(request.outputPath)); await writeFile(request.outputPath, Buffer.from(data, "base64")); return { outputPath: request.outputPath };
  }
  async startVideo(request: VideoRequest): Promise<{ operationId: string }> {
    const instance: Json = { prompt: request.prompt };
    if (request.firstFrame) instance.image = await imageInline(request.firstFrame);
    if (request.referenceImages?.length) { instance.referenceImages = []; for (const file of request.referenceImages.slice(0, 3)) instance.referenceImages.push({ image: await imageInline(file), referenceType: "asset" }); }
    if (request.lastFrame) instance.lastFrame = await imageInline(request.lastFrame);
    const requiresEight = Boolean(request.referenceImages?.length || request.lastFrame || request.resolution === "1080p" || request.resolution === "4k");
    const requestedDuration = Math.max(4, Math.min(8, request.durationSec ?? 8));
    const durationSeconds = requiresEight ? 8 : requestedDuration <= 4 ? 4 : requestedDuration <= 6 ? 6 : 8;
    const parameters: Json = { numberOfVideos: 1, aspectRatio: request.aspectRatio === "1:1" ? "16:9" : request.aspectRatio, resolution: request.resolution, durationSeconds: String(durationSeconds) };
    const response = await fetch(`${this.base}/models/${this.videoModel}:predictLongRunning`, { method: "POST", headers: this.headers(), body: JSON.stringify({ instances: [instance], parameters }) });
    if (!response.ok) throw new Error(`Veo HTTP ${response.status}: ${(await response.text()).slice(0, 4000)}`);
    const json = await response.json() as Json; if (!json.name) throw new Error("Veo response did not contain operation name"); return { operationId: String(json.name) };
  }
  async pollVideo(operationId: string): Promise<VideoPollResult> {
    const response = await fetch(`${this.base}/${operationId}`, { headers: this.headers() });
    if (!response.ok) throw new Error(`Veo poll HTTP ${response.status}: ${(await response.text()).slice(0, 4000)}`);
    const json = await response.json() as Json; if (!json.done) return { done: false }; if (json.error) return { done: true, error: JSON.stringify(json.error).slice(0, 4000) };
    const uri = json.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ?? json.response?.generatedVideos?.[0]?.video?.uri;
    return uri ? { done: true, downloadUri: String(uri) } : { done: true, error: "Veo operation completed without a video URI" };
  }
  async downloadVideo(downloadUri: string, outputPath: string): Promise<{ outputPath: string }> { const response = await fetch(downloadUri, { headers: { "x-goog-api-key": this.key } }); if (!response.ok) throw new Error(`Veo download HTTP ${response.status}: ${(await response.text()).slice(0, 4000)}`); await ensureDir(path.dirname(outputPath)); await writeFile(outputPath, Buffer.from(await response.arrayBuffer())); return { outputPath }; }
}

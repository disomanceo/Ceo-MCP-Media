import path from "node:path";
import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ImageRequest, ProviderHealth, VideoPollResult, VideoRequest } from "../types.js";
import { ProviderError, type MediaProvider } from "./provider.js";
import { ensureDir } from "../core/utils.js";
import { isGuardrailError } from "../core/preflight.js";

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

async function imageInline(file: string) {
  const data = await readFile(file);
  const ext = path.extname(file).toLowerCase();
  const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return { mimeType, bytesBase64Encoded: data.toString("base64") };
}

async function interactionImage(file: string) {
  const data = await readFile(file);
  const ext = path.extname(file).toLowerCase();
  const mime_type = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return { type: "image", mime_type, data: data.toString("base64") };
}

function parseRetryAfter(response: Response, text: string): number | undefined {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  try {
    const json = JSON.parse(text);
    const details = json?.error?.details ?? [];
    for (const detail of details) {
      const delay = detail?.retryDelay ?? detail?.retry_delay;
      const match = typeof delay === "string" ? delay.match(/^([0-9.]+)s$/) : null;
      if (match) return Math.round(Number(match[1]) * 1000);
    }
  } catch { /* bounded provider error text can be non-JSON */ }
  return undefined;
}

async function httpError(label: string, response: Response): Promise<ProviderError> {
  const text = (await response.text()).slice(0, 4000);
  const guardrail = isGuardrailError(text);
  const retryable = !guardrail && (response.status === 408 || response.status === 429 || response.status >= 500);
  return new ProviderError(`${label} HTTP ${response.status}: ${text}`, {
    status: response.status,
    retryAfterMs: parseRetryAfter(response, text),
    retryable,
    code: guardrail ? "GUARDRAIL" : response.status === 429 ? "RATE_LIMIT" : `HTTP_${response.status}`
  });
}

export class GeminiProvider implements MediaProvider {
  id = "gemini" as const;
  private base = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
  private key = process.env.GEMINI_API_KEY || "";
  private imageModel = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
  private videoModel = process.env.GEMINI_VEO_MODEL || "veo-3.1-generate-preview";
  private headers() {
    if (!this.key) throw new ProviderError("GEMINI_API_KEY is not configured", { retryable: false, code: "AUTH_MISSING" });
    return { "x-goog-api-key": this.key, "Content-Type": "application/json" };
  }
  async health(): Promise<ProviderHealth> {
    return { id: this.id, ready: Boolean(this.key), capabilities: ["image", "video", "video-poll", "reference-images", "9:16", "16:9"], reason: this.key ? undefined : "GEMINI_API_KEY is not configured", model: `${this.imageModel} / ${this.videoModel}` };
  }
  async generateImage(request: ImageRequest): Promise<{ outputPath: string }> {
    const input: Json[] = [];
    for (const file of (request.referenceImages ?? []).slice(0, 3)) input.push(await interactionImage(file));
    input.push({ type: "text", text: request.prompt });
    const responseFormat: Json = { type: "image", mime_type: "image/jpeg" };
    if (request.aspectRatio) responseFormat.aspect_ratio = request.aspectRatio;
    const response = await fetch(`${this.base}/interactions`, { method: "POST", headers: this.headers(), body: JSON.stringify({ model: this.imageModel, input, response_format: responseFormat }) });
    if (!response.ok) throw await httpError("Gemini image", response);
    const data = findBase64Image(await response.json());
    if (!data) throw new ProviderError("Gemini image response did not contain decodable image data", { retryable: false, code: "INVALID_RESPONSE" });
    await ensureDir(path.dirname(request.outputPath));
    await writeFile(request.outputPath, Buffer.from(data, "base64"));
    return { outputPath: request.outputPath };
  }
  async startVideo(request: VideoRequest): Promise<{ operationId: string }> {
    const instance: Json = { prompt: request.prompt };
    if (request.firstFrame) instance.image = await imageInline(request.firstFrame);
    if (request.referenceImages?.length) {
      instance.referenceImages = [];
      for (const file of request.referenceImages.slice(0, 3)) instance.referenceImages.push({ image: await imageInline(file), referenceType: "asset" });
    }
    if (request.lastFrame) instance.lastFrame = await imageInline(request.lastFrame);
    const requiresEight = Boolean(request.referenceImages?.length || request.lastFrame || request.resolution === "1080p" || request.resolution === "4k");
    const requestedDuration = Math.max(4, Math.min(8, request.durationSec ?? 8));
    const durationSeconds = requiresEight ? 8 : requestedDuration <= 4 ? 4 : requestedDuration <= 6 ? 6 : 8;
    const parameters: Json = { sampleCount: 1, aspectRatio: request.aspectRatio === "1:1" ? "16:9" : request.aspectRatio, resolution: request.resolution, durationSeconds };
    if (request.referenceImages?.length || request.firstFrame || request.lastFrame) parameters.personGeneration = "allow_adult";
    const response = await fetch(`${this.base}/models/${this.videoModel}:predictLongRunning`, { method: "POST", headers: this.headers(), body: JSON.stringify({ instances: [instance], parameters }) });
    if (!response.ok) throw await httpError("Veo", response);
    const json = await response.json() as Json;
    if (!json.name) throw new ProviderError("Veo response did not contain operation name", { retryable: false, code: "INVALID_RESPONSE" });
    return { operationId: String(json.name) };
  }
  async pollVideo(operationId: string): Promise<VideoPollResult> {
    const response = await fetch(`${this.base}/${operationId}`, { headers: this.headers() });
    if (!response.ok) throw await httpError("Veo poll", response);
    const json = await response.json() as Json;
    if (!json.done) return { done: false };
    if (json.error) {
      const message = JSON.stringify(json.error).slice(0, 4000);
      const status = Number(json.error?.code || 0);
      const guardrail = isGuardrailError(message);
      return { done: true, error: message, errorCode: guardrail ? "GUARDRAIL" : `PROVIDER_${status || "ERROR"}`, retryable: !guardrail && (status === 429 || status >= 500) };
    }
    const video = json.response?.generateVideoResponse?.generatedSamples?.[0]?.video ?? json.response?.generatedVideos?.[0]?.video;
    const uri = video?.uri ?? video?.fileUri;
    const inline = video?.videoBytes ?? video?.bytesBase64Encoded ?? video?.data;
    if (uri) return { done: true, downloadUri: String(uri) };
    if (inline) return { done: true, downloadUri: `data:video/mp4;base64,${String(inline)}` };
    const diagnostic = JSON.stringify(json).slice(0, 4000);
    const guardrail = isGuardrailError(diagnostic) || Number(json.response?.generateVideoResponse?.raiMediaFilteredCount || 0) > 0;
    return { done: true, error: `Veo operation completed without downloadable video: ${diagnostic}`, errorCode: guardrail ? "GUARDRAIL" : "NO_VIDEO", retryable: false };
  }
  async downloadVideo(downloadUri: string, outputPath: string): Promise<{ outputPath: string }> {
    await ensureDir(path.dirname(outputPath));
    if (downloadUri.startsWith("data:video/")) {
      const comma = downloadUri.indexOf(",");
      if (comma < 0) throw new ProviderError("Invalid inline video data URI", { retryable: false, code: "INVALID_DATA_URI" });
      await writeFile(outputPath, Buffer.from(downloadUri.slice(comma + 1), "base64"));
      return { outputPath };
    }
    const response = await fetch(downloadUri, { headers: { "x-goog-api-key": this.key } });
    if (!response.ok) throw await httpError("Veo download", response);
    if (!response.body) throw new ProviderError("Veo download returned an empty body", { retryable: true, code: "EMPTY_BODY" });
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(outputPath));
    return { outputPath };
  }
}

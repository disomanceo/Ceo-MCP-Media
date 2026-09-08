import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { ImageRequest, MusicRequest, ProviderHealth, VideoPollResult, VideoRequest, VoiceRequest } from "../types.js";
import type { MediaProvider } from "./provider.js";
import { ensureDir, newId } from "../core/utils.js";
export class MockProvider implements MediaProvider {
  id = "mock" as const;
  async health(): Promise<ProviderHealth> { return { id: this.id, ready: true, capabilities: ["image", "video", "voice", "music", "test"], model: "deterministic-mock" }; }
  private async writeMock(outputPath: string, value: Record<string, unknown>) { await ensureDir(path.dirname(outputPath)); await writeFile(outputPath, JSON.stringify({ mock: true, ...value }, null, 2)); return { outputPath }; }
  async generateImage(request: ImageRequest): Promise<{ outputPath: string }> { return this.writeMock(request.outputPath, { type: "image", prompt: request.prompt }); }
  async generateVoice(request: VoiceRequest): Promise<{ outputPath: string }> { return this.writeMock(request.outputPath, { type: "voice", text: request.text, voice: request.voice, language: request.language, speed: request.speed, style: request.style }); }
  async generateMusic(request: MusicRequest): Promise<{ outputPath: string }> { return this.writeMock(request.outputPath, { type: "music", prompt: request.prompt, durationSec: request.durationSec, mood: request.mood, instrumental: request.instrumental }); }
  async startVideo(_request: VideoRequest): Promise<{ operationId: string }> { return { operationId: newId("mock-operation") }; }
  async pollVideo(operationId: string): Promise<VideoPollResult> { return operationId.startsWith("mock-operation-") ? { done: true, downloadUri: `mock://${operationId}` } : { done: true, error: "invalid mock operation id" }; }
  async downloadVideo(downloadUri: string, outputPath: string): Promise<{ outputPath: string }> { return this.writeMock(outputPath, { type: "video", downloadUri }); }
}

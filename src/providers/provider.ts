import type { ImageRequest, MusicRequest, ProviderHealth, VideoPollResult, VideoRequest, VoiceRequest } from "../types.js";

export class ProviderError extends Error {
  status?: number;
  retryAfterMs?: number;
  retryable: boolean;
  code?: string;
  constructor(message: string, options: { status?: number; retryAfterMs?: number; retryable?: boolean; code?: string } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable ?? false;
    this.code = options.code;
  }
}

export interface MediaProvider {
  id: "mock" | "gemini";
  health(): Promise<ProviderHealth>;
  generateImage?(request: ImageRequest): Promise<{ outputPath: string }>;
  generateVoice?(request: VoiceRequest): Promise<{ outputPath: string }>;
  generateMusic?(request: MusicRequest): Promise<{ outputPath: string }>;
  startVideo?(request: VideoRequest): Promise<{ operationId: string }>;
  pollVideo?(operationId: string): Promise<VideoPollResult>;
  downloadVideo?(downloadUri: string, outputPath: string): Promise<{ outputPath: string }>;
}
export interface FlowHandoff { version: 1; projectId: string; title: string; instructions: string; shots: Array<{ id: string; prompt: string; references: string[]; durationSec: number }>; }

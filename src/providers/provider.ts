import type { ImageRequest, MusicRequest, ProviderHealth, VideoPollResult, VideoRequest, VoiceRequest } from "../types.js";
export interface MediaProvider {
  id: "mock" | "gemini" | "flow";
  health(): Promise<ProviderHealth>;
  generateImage?(request: ImageRequest): Promise<{ outputPath: string }>;
  generateVoice?(request: VoiceRequest): Promise<{ outputPath: string }>;
  generateMusic?(request: MusicRequest): Promise<{ outputPath: string }>;
  startVideo?(request: VideoRequest): Promise<{ operationId: string }>;
  pollVideo?(operationId: string): Promise<VideoPollResult>;
  downloadVideo?(downloadUri: string, outputPath: string): Promise<{ outputPath: string }>;
}
export interface FlowHandoff { version: 1; projectId: string; title: string; instructions: string; shots: Array<{ id: string; prompt: string; references: string[]; durationSec: number }>; }

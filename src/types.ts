export type AspectRatio = "16:9" | "9:16" | "1:1";
export type Resolution = "720p" | "1080p" | "4k";
export type JobStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
export type ProviderKind = "mock" | "gemini" | "flow-native" | "flow-web" | "ai-studio-web";
export type ProviderPreference = "auto" | ProviderKind | "flow";
export type FinalEditor = "auto" | "ffmpeg" | "capcut";

export interface CharacterBible { id: string; name: string; description: string; wardrobe?: string; voice?: string; referenceImages: string[]; continuityTags: string[]; }
export interface Shot { id: string; index: number; durationSec: number; title: string; prompt: string; dialogue?: string; camera?: string; characters: string[]; referenceImages: string[]; continuityTags: string[]; status?: "planned" | "queued" | "generated" | "rejected" | "approved"; assetPath?: string; }
export interface Storyboard { id: string; projectId: string; title: string; totalDurationSec: number; aspectRatio: AspectRatio; shots: Shot[]; createdAt: string; }
export interface MediaProject { id: string; name: string; brief: string; aspectRatio: AspectRatio; resolution: Resolution; fps: number; characters: CharacterBible[]; storyboard?: Storyboard; createdAt: string; updatedAt: string; }
export interface JobEvent { at: string; level: "info" | "warn" | "error"; message: string; data?: Record<string, unknown>; }
export interface MediaJob<T = Record<string, unknown>> { id: string; projectId?: string; type: string; status: JobStatus; input: T; output?: Record<string, unknown>; provider?: ProviderKind; providerState?: Record<string, unknown>; idempotencyKey?: string; requestHash?: string; attempts: number; maxAttempts: number; timeoutMs: number; createdAt: string; updatedAt: string; nextRunAt?: string; error?: string; events: JobEvent[]; cancelledAt?: string; }
export interface ProviderHealth { id: ProviderKind; ready: boolean; capabilities: string[]; reason?: string; model?: string; }
export interface ImageRequest { prompt: string; outputPath: string; aspectRatio?: AspectRatio; referenceImages?: string[]; }
export interface VideoRequest { prompt: string; outputPath: string; aspectRatio: AspectRatio; resolution: Resolution; durationSec?: number; referenceImages?: string[]; firstFrame?: string; lastFrame?: string; }
export interface VoiceRequest { text: string; outputPath: string; voice?: string; language?: string; speed?: number; style?: string; }
export interface MusicRequest { prompt: string; outputPath: string; durationSec?: number; mood?: string; instrumental?: boolean; }
export interface VideoPollResult { done: boolean; downloadUri?: string; error?: string; errorCode?: string; retryable?: boolean; retryAfterMs?: number; }
export interface ReviewResult { score: number; accepted: boolean; reasons: string[]; retryPrompt?: string; }

export interface MovieCharacterInput {
  name: string;
  description: string;
  wardrobe?: string;
  voice?: string;
  referenceImages?: string[];
  continuityTags?: string[];
}

export interface MovieCreateInput {
  name: string;
  brief: string;
  script?: string;
  totalDurationSec?: number;
  aspectRatio?: AspectRatio;
  resolution?: Resolution;
  fps?: number;
  provider?: ProviderPreference;
  resolvedImageProvider?: ProviderKind;
  resolvedVideoProvider?: ProviderKind;
  character: MovieCharacterInput;
  anchorPrompt?: string;
  shotPrompts?: string[];
  dialogues?: string[];
  outputPath?: string;
  subtitlePath?: string;
  compose?: boolean;
  finalEditor?: FinalEditor;
  autoRewriteGuardrails?: boolean;
  videoConcurrency?: number;
  generateVoice?: boolean;
  voiceProvider?: "mock" | "gemini";
  voiceLanguage?: string;
  voiceSpeed?: number;
  voiceStyle?: string;
  generateMusic?: boolean;
  musicProvider?: "mock" | "gemini";
  musicPrompt?: string;
  musicMood?: string;
  idempotencyKey?: string;
  requestHash?: string;
}

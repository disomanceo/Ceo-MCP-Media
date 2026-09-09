import { GeminiProvider } from "./gemini-provider.js";
import { FlowNativeProvider } from "./flow-native-provider.js";

export type StudioProvider = "gemini" | "mock" | "flow-native" | "flow-web" | "ai-studio-web";
export type ProviderPreference = "auto" | StudioProvider | "flow";
export type StudioCapability = "image" | "video";

export interface StudioRoute {
  capability: StudioCapability;
  preference: ProviderPreference;
  provider: StudioProvider;
  mode: "api" | "mock" | "native" | "browser";
  ready: boolean;
  reason: string;
  url?: string;
  requiresBrowser?: boolean;
}

const FLOW_URL = process.env.CEO_MEDIA_FLOW_URL || "https://labs.google/fx/tools/flow";
const AI_STUDIO_URL = process.env.CEO_MEDIA_AI_STUDIO_URL || "https://aistudio.google.com/";

function enabled(name: "flow" | "ai-studio"): boolean {
  const key = name === "flow" ? "CEO_MEDIA_FLOW_WEB" : "CEO_MEDIA_AI_STUDIO_WEB";
  return String(process.env[key] ?? "true").toLowerCase() !== "false";
}

export class StudioRouter {
  async resolve(capability: StudioCapability, preference: ProviderPreference = "auto"): Promise<StudioRoute> {
    const normalized: ProviderPreference = preference === "flow" ? "flow-web" : preference;
    if (normalized === "mock") return { capability, preference, provider: "mock", mode: "mock", ready: true, reason: "explicit mock provider" };
    if (normalized === "gemini") {
      const health = await new GeminiProvider().health();
      return { capability, preference, provider: "gemini", mode: "api", ready: health.ready && health.capabilities.includes(capability), reason: health.ready ? "Gemini API credential available" : (health.reason || "Gemini API unavailable") };
    }
    if (normalized === "flow-native") {
      const health = await new FlowNativeProvider().health();
      return { capability, preference, provider: "flow-native", mode: "native", ready: health.ready && health.capabilities.includes(capability), reason: health.reason || "Flow Native provider" };
    }
    if (normalized === "flow-web") return { capability, preference, provider: "flow-web", mode: "browser", ready: enabled("flow"), requiresBrowser: true, url: FLOW_URL, reason: enabled("flow") ? "Google Flow browser bridge enabled" : "Google Flow browser bridge disabled" };
    if (normalized === "ai-studio-web") return { capability, preference, provider: "ai-studio-web", mode: "browser", ready: enabled("ai-studio"), requiresBrowser: true, url: AI_STUDIO_URL, reason: enabled("ai-studio") ? "Google AI Studio browser bridge enabled" : "Google AI Studio browser bridge disabled" };

    const gemini = await new GeminiProvider().health();
    if (gemini.ready && gemini.capabilities.includes(capability)) return { capability, preference, provider: "gemini", mode: "api", ready: true, reason: "AUTO selected Gemini API because credential is available" };

    const native = await new FlowNativeProvider().health();
    if (native.ready && native.capabilities.includes(capability)) return { capability, preference, provider: "flow-native", mode: "native", ready: true, reason: "AUTO selected configured Flow Native provider" };

    if (capability === "image") {
      if (enabled("ai-studio")) return { capability, preference, provider: "ai-studio-web", mode: "browser", ready: true, requiresBrowser: true, url: AI_STUDIO_URL, reason: "AUTO selected AI Studio Web because native/API routes are unavailable" };
      if (enabled("flow")) return { capability, preference, provider: "flow-web", mode: "browser", ready: true, requiresBrowser: true, url: FLOW_URL, reason: "AUTO selected Flow Web as image fallback" };
    } else {
      if (enabled("flow")) return { capability, preference, provider: "flow-web", mode: "browser", ready: true, requiresBrowser: true, url: FLOW_URL, reason: "AUTO selected Flow Web because native/API routes are unavailable" };
      if (enabled("ai-studio")) return { capability, preference, provider: "ai-studio-web", mode: "browser", ready: true, requiresBrowser: true, url: AI_STUDIO_URL, reason: "AUTO selected AI Studio Web as video fallback" };
    }

    const allowMock = String(process.env.CEO_MEDIA_AUTO_ALLOW_MOCK || "false").toLowerCase() === "true";
    if (allowMock) return { capability, preference, provider: "mock", mode: "mock", ready: true, reason: "AUTO fell back to Mock because all real routes are unavailable" };
    return { capability, preference, provider: "gemini", mode: "api", ready: false, reason: "No real media route is available: configure Gemini API, Flow Native, or enable Flow/AI Studio Web" };
  }

  async status() {
    const [autoImage, autoVideo, geminiImage, geminiVideo, nativeImage, nativeVideo] = await Promise.all([
      this.resolve("image", "auto"), this.resolve("video", "auto"), this.resolve("image", "gemini"), this.resolve("video", "gemini"), this.resolve("image", "flow-native"), this.resolve("video", "flow-native")
    ]);
    return {
      auto: { image: autoImage, video: autoVideo },
      routes: {
        gemini: { image: geminiImage, video: geminiVideo },
        flowNative: { image: nativeImage, video: nativeVideo },
        flowWeb: { enabled: enabled("flow"), url: FLOW_URL, preferredFor: ["video"] },
        aiStudioWeb: { enabled: enabled("ai-studio"), url: AI_STUDIO_URL, preferredFor: ["image", "video-fallback"] }
      },
      browserBridge: { durableExternalActions: true, requiresCeo3OrPlaywright: true }
    };
  }
}

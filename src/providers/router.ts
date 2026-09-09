import { ProviderError, type MediaProvider } from "./provider.js";
import { MockProvider } from "./mock-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { FlowNativeProvider } from "./flow-native-provider.js";
import { getProviderCooldown } from "./quota-manager.js";
export type MediaCapability = "image" | "video" | "voice" | "music";

export class ProviderRouter {
  private providers = new Map<string, MediaProvider>();
  constructor() { this.register(new MockProvider()); this.register(new GeminiProvider()); this.register(new FlowNativeProvider()); }
  register(provider: MediaProvider) { this.providers.set(provider.id, provider); }
  get(id?: string): MediaProvider {
    const requested = id || process.env.CEO_MEDIA_PROVIDER || "mock";
    const provider = this.providers.get(requested);
    if (!provider) throw new Error(`Provider ${requested} is not an executable API/local provider`);
    return provider;
  }
  async route(capability: MediaCapability, requested?: string): Promise<MediaProvider> {
    const configured = requested || (capability === "voice" ? process.env.CEO_MEDIA_VOICE_PROVIDER : capability === "music" ? process.env.CEO_MEDIA_MUSIC_PROVIDER : process.env.CEO_MEDIA_PROVIDER);
    const primary = this.get(configured);
    const ph = await primary.health();
    const cooldown = getProviderCooldown(primary.id);
    if (cooldown.active) throw new ProviderError(`Provider ${primary.id} is cooling down for ${cooldown.remainingMs}ms${cooldown.reason ? `: ${cooldown.reason}` : ""}`, { retryable: true, retryAfterMs: cooldown.remainingMs, code: "RATE_LIMIT" });
    if (ph.ready && ph.capabilities.includes(capability)) return primary;

    const explicit = Boolean(requested);
    const allowExplicitFallback = process.env.CEO_MEDIA_EXPLICIT_PROVIDER_FALLBACK === "true";
    if (explicit && !allowExplicitFallback) {
      throw new Error(`Requested provider ${primary.id} is not ready for ${capability}: ${ph.reason ?? "capability unavailable"}`);
    }

    const fallback = this.get(process.env.CEO_MEDIA_PROVIDER_FALLBACK || "mock");
    const fh = await fallback.health();
    if (fh.ready && fh.capabilities.includes(capability)) return fallback;
    throw new Error(`No ready executable provider for capability ${capability}`);
  }
  async status() { const rows = []; for (const provider of this.providers.values()) rows.push(await provider.health()); return rows; }
}

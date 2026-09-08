import test from "node:test";
import assert from "node:assert/strict";
import { ProviderRouter } from "../src/providers/router.js";
test("provider router falls back to mock when gemini key is absent", async () => { delete process.env.GEMINI_API_KEY; process.env.CEO_MEDIA_PROVIDER_FALLBACK = "mock"; const router = new ProviderRouter(); const provider = await router.route("video", "gemini"); assert.equal(provider.id, "mock"); });
test("provider router uses dedicated voice and music defaults", async () => { process.env.CEO_MEDIA_VOICE_PROVIDER = "mock"; process.env.CEO_MEDIA_MUSIC_PROVIDER = "mock"; const router = new ProviderRouter(); assert.equal((await router.route("voice")).id, "mock"); assert.equal((await router.route("music")).id, "mock"); });

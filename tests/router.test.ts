import test from "node:test";
import assert from "node:assert/strict";
import { ProviderRouter } from "../src/providers/router.js";

test("explicit provider does not silently fall back to mock", async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.CEO_MEDIA_EXPLICIT_PROVIDER_FALLBACK;
  process.env.CEO_MEDIA_PROVIDER_FALLBACK = "mock";
  const router = new ProviderRouter();
  await assert.rejects(() => router.route("video", "gemini"), /Requested provider gemini is not ready/);
});

test("implicit provider may use configured fallback", async () => {
  delete process.env.GEMINI_API_KEY;
  process.env.CEO_MEDIA_PROVIDER = "gemini";
  process.env.CEO_MEDIA_PROVIDER_FALLBACK = "mock";
  const router = new ProviderRouter();
  assert.equal((await router.route("video")).id, "mock");
});

test("explicit fallback can be enabled intentionally", async () => {
  delete process.env.GEMINI_API_KEY;
  process.env.CEO_MEDIA_EXPLICIT_PROVIDER_FALLBACK = "true";
  process.env.CEO_MEDIA_PROVIDER_FALLBACK = "mock";
  const router = new ProviderRouter();
  assert.equal((await router.route("video", "gemini")).id, "mock");
  delete process.env.CEO_MEDIA_EXPLICIT_PROVIDER_FALLBACK;
});

test("provider router uses dedicated voice and music defaults", async () => {
  process.env.CEO_MEDIA_VOICE_PROVIDER = "mock";
  process.env.CEO_MEDIA_MUSIC_PROVIDER = "mock";
  const router = new ProviderRouter();
  assert.equal((await router.route("voice")).id, "mock");
  assert.equal((await router.route("music")).id, "mock");
});

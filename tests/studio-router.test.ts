import test from "node:test";
import assert from "node:assert/strict";
import { StudioRouter } from "../src/providers/studio-router.js";

test("AUTO uses AI Studio for images and Flow for video when Gemini key is missing", async () => {
  const oldKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  process.env.CEO_MEDIA_FLOW_WEB = "true";
  process.env.CEO_MEDIA_AI_STUDIO_WEB = "true";
  try {
    const router = new StudioRouter();
    const image = await router.resolve("image", "auto");
    const video = await router.resolve("video", "auto");
    assert.equal(image.provider, "ai-studio-web");
    assert.equal(image.mode, "browser");
    assert.equal(video.provider, "flow-web");
    assert.equal(video.mode, "browser");
  } finally {
    if (oldKey == null) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
  }
});

test("explicit Gemini remains strict when key is missing", async () => {
  const oldKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const route = await new StudioRouter().resolve("video", "gemini");
    assert.equal(route.provider, "gemini");
    assert.equal(route.ready, false);
    assert.match(route.reason, /GEMINI_API_KEY/);
  } finally {
    if (oldKey == null) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
  }
});

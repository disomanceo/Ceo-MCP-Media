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

test("AUTO prefers local Flow Native for video even when Gemini API is available", async () => {
  const oldKey = process.env.GEMINI_API_KEY;
  const oldCommand = process.env.CEO_MEDIA_FLOW_NATIVE_COMMAND;
  const oldArgs = process.env.CEO_MEDIA_FLOW_NATIVE_ARGS_JSON;
  const oldPrefer = process.env.CEO_MEDIA_VIDEO_AUTO_PREFER_FLOW;
  process.env.GEMINI_API_KEY = "test-key";
  process.env.CEO_MEDIA_FLOW_NATIVE_COMMAND = process.execPath;
  process.env.CEO_MEDIA_FLOW_NATIVE_ARGS_JSON = JSON.stringify([
    "-e",
    "const op=process.argv[1]; if(op==='health') process.stdout.write(JSON.stringify({ready:true,capabilities:['video'],reason:'test-ready'})); else process.exit(2);"
  ]);
  process.env.CEO_MEDIA_VIDEO_AUTO_PREFER_FLOW = "true";
  try {
    const route = await new StudioRouter().resolve("video", "auto");
    assert.equal(route.provider, "flow-native");
    assert.equal(route.mode, "native");
    assert.equal(route.ready, true);
  } finally {
    if (oldKey == null) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
    if (oldCommand == null) delete process.env.CEO_MEDIA_FLOW_NATIVE_COMMAND; else process.env.CEO_MEDIA_FLOW_NATIVE_COMMAND = oldCommand;
    if (oldArgs == null) delete process.env.CEO_MEDIA_FLOW_NATIVE_ARGS_JSON; else process.env.CEO_MEDIA_FLOW_NATIVE_ARGS_JSON = oldArgs;
    if (oldPrefer == null) delete process.env.CEO_MEDIA_VIDEO_AUTO_PREFER_FLOW; else process.env.CEO_MEDIA_VIDEO_AUTO_PREFER_FLOW = oldPrefer;
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

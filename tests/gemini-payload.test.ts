import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { GeminiProvider } from "../src/providers/gemini-provider.js";

test("Gemini image adapter sends reference input and response_format", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ceo-media-gemini-image-"));
  const ref = path.join(dir, "ref.png");
  const out = path.join(dir, "out.png");
  await writeFile(ref, Buffer.from([1, 2, 3]));
  process.env.GEMINI_API_KEY = "test-key";
  const calls: any[] = [];
  const original = globalThis.fetch;
  (globalThis as any).fetch = async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ output_image: { mime_type: "image/jpeg", data: Buffer.from("image-bytes").toString("base64") } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = new GeminiProvider();
    await provider.generateImage({ prompt: "keep character identity", outputPath: out, aspectRatio: "9:16", referenceImages: [ref] });
    assert.match(calls[0].url, /\/v1beta\/interactions$/);
    assert.equal(calls[0].body.model, "gemini-3.1-flash-image");
    assert.equal(calls[0].body.input[0].type, "image");
    assert.equal(calls[0].body.input.at(-1).type, "text");
    assert.equal(calls[0].body.response_format.aspect_ratio, "9:16");
    assert.equal(calls[0].body.response_format.mime_type, "image/jpeg");
    assert.equal((await readFile(out)).toString(), "image-bytes");
  } finally { globalThis.fetch = original; }
});

test("Veo adapter follows current REST long-running payload", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ceo-media-veo-"));
  const first = path.join(dir, "first.png");
  const last = path.join(dir, "last.png");
  const ref = path.join(dir, "ref.png");
  await Promise.all([first, last, ref].map((file, i) => writeFile(file, Buffer.from([i + 1]))));
  process.env.GEMINI_API_KEY = "test-key";
  const calls: any[] = [];
  const original = globalThis.fetch;
  (globalThis as any).fetch = async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ name: "operations/test-operation" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = new GeminiProvider();
    const result = await provider.startVideo({ prompt: "cinematic school shot", outputPath: path.join(dir, "out.mp4"), aspectRatio: "9:16", resolution: "1080p", durationSec: 4, firstFrame: first, lastFrame: last, referenceImages: [ref] });
    assert.equal(result.operationId, "operations/test-operation");
    assert.match(calls[0].url, /veo-3\.1-generate-preview:predictLongRunning$/);
    assert.ok(calls[0].body.instances[0].image?.inlineData?.data);
    assert.ok(calls[0].body.instances[0].lastFrame?.inlineData?.data);
    assert.equal(calls[0].body.instances[0].referenceImages.length, 1);
    assert.equal(calls[0].body.instances[0].referenceImages[0].referenceType, "asset");
    assert.equal(calls[0].body.parameters.aspectRatio, "9:16");
    assert.equal(calls[0].body.parameters.resolution, "1080p");
    assert.equal(calls[0].body.parameters.durationSeconds, "8");
    assert.equal(calls[0].body.parameters.lastFrame, undefined);
  } finally { globalThis.fetch = original; }
});

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { MediaToolService } from "../src/core/tool-service.js";

async function advance(service: MediaToolService, movieJobId: string, rounds = 20) {
  let status: any;
  for (let i = 0; i < rounds; i++) {
    await service.call("media.job.run_once", { jobId: movieJobId });
    await service.call("media.job.tick", { limit: 20 });
    status = await service.call("media.movie.status", { jobId: movieJobId });
    if (status.status === "completed" || status.status === "failed" || status.nextExternalAction) return status;
  }
  return status;
}

test("AUTO browser movie waits for AI Studio anchor then Flow shot and resumes after external completion", async () => {
  const oldKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  process.env.CEO_MEDIA_FLOW_WEB = "true";
  process.env.CEO_MEDIA_AI_STUDIO_WEB = "true";
  process.env.CEO_MEDIA_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "ceo-media-browser-"));
  const service = new MediaToolService();
  try {
    const created: any = await service.call("media.movie.create", {
      name: "Browser Movie",
      brief: "Original Thai rescue engineer handles a school robotics incident.",
      totalDurationSec: 8,
      aspectRatio: "9:16",
      resolution: "1080p",
      provider: "auto",
      compose: false,
      finalEditor: "ffmpeg",
      character: { name: "Engineer", description: "Young Thai rescue engineer", wardrobe: "industrial assist frame" },
      shotPrompts: ["Engineer safely shuts down a malfunctioning school robot"],
      dialogues: ["ภารกิจสำเร็จ"]
    });
    assert.equal(created.route.image.provider, "ai-studio-web");
    assert.equal(created.route.video.provider, "flow-web");

    let status = await advance(service, created.movieJobId);
    assert.equal(status.nextExternalAction.input.kind, "studio.image");
    assert.equal(status.nextExternalAction.input.provider, "ai-studio-web");
    const anchor = path.join(process.env.CEO_MEDIA_DATA_DIR!, "browser-anchor.jpg");
    await writeFile(anchor, "fake-image");
    await service.call("media.external.complete", { jobId: status.nextExternalAction.id, outputPath: anchor });

    status = await advance(service, created.movieJobId);
    assert.equal(status.nextExternalAction.input.kind, "studio.video");
    assert.equal(status.nextExternalAction.input.provider, "flow-web");
    assert.deepEqual(status.nextExternalAction.input.references, [anchor]);
    const shot = path.join(process.env.CEO_MEDIA_DATA_DIR!, "browser-shot.mp4");
    await writeFile(shot, "fake-video");
    await service.call("media.external.complete", { jobId: status.nextExternalAction.id, outputPath: shot });

    for (let i = 0; i < 10; i++) {
      await service.call("media.job.run_once", { jobId: created.movieJobId });
      status = await service.call("media.movie.status", { jobId: created.movieJobId });
      if (status.status === "completed") break;
    }
    assert.equal(status.status, "completed", status.error);
    assert.equal(status.output.anchorPath, anchor);
    assert.deepEqual(status.output.shotPaths, [shot]);
    assert.equal(status.output.routes.imageProvider, "ai-studio-web");
    assert.equal(status.output.routes.videoProvider, "flow-web");
  } finally {
    if (oldKey == null) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
  }
});

test("completed external actions remain completed when idempotency key is reused", async () => {
  const oldKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  process.env.CEO_MEDIA_AI_STUDIO_WEB = "true";
  process.env.CEO_MEDIA_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "ceo-media-ext-idem-"));
  try {
    const service = new MediaToolService();
    const first: any = await service.call("media.image.generate", { name: "anchor", prompt: "Original school rescue engineer", provider: "ai-studio-web", idempotencyKey: "ext-idem-1" });
    const output = path.join(process.env.CEO_MEDIA_DATA_DIR!, "anchor.jpg");
    await writeFile(output, "fake-image");
    await service.call("media.external.complete", { jobId: first.id, outputPath: output });
    const second: any = await service.call("media.image.generate", { name: "anchor", prompt: "Original school rescue engineer", provider: "ai-studio-web", idempotencyKey: "ext-idem-1" });
    assert.equal(second.id, first.id);
    assert.equal(second.status, "completed");
    assert.equal(second.output.outputPath, output);
  } finally {
    if (oldKey == null) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
  }
});

test("CapCut final editor becomes a durable external action", async () => {
  process.env.CEO_MEDIA_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "ceo-media-capcut-"));
  process.env.CEO_MEDIA_POLL_MS = "0";
  const service = new MediaToolService();
  const created: any = await service.call("media.movie.create", {
    name: "CapCut Movie",
    brief: "Original school rescue scene.", totalDurationSec: 8, provider: "mock", finalEditor: "capcut", compose: true,
    character: { name: "Engineer", description: "Thai rescue engineer" }, shotPrompts: ["Engineer resolves the incident"], dialogues: ["สำเร็จ"]
  });
  let status: any;
  for (let i = 0; i < 30; i++) {
    await service.call("media.job.run_once", { jobId: created.movieJobId });
    await service.call("media.job.tick", { limit: 20 });
    status = await service.call("media.movie.status", { jobId: created.movieJobId });
    if (status.nextExternalAction?.input?.kind === "capcut.compose") break;
  }
  assert.equal(status.nextExternalAction.input.kind, "capcut.compose");
  assert.equal(status.nextExternalAction.input.provider, "capcut");
  assert.equal(status.nextExternalAction.input.clips.length, 1);
  const final = path.join(process.env.CEO_MEDIA_DATA_DIR!, "capcut-final.mp4");
  await writeFile(final, "fake-final");
  await service.call("media.external.complete", { jobId: status.nextExternalAction.id, outputPath: final });
  for (let i = 0; i < 10; i++) {
    await service.call("media.job.run_once", { jobId: created.movieJobId });
    status = await service.call("media.movie.status", { jobId: created.movieJobId });
    if (status.status === "completed") break;
  }
  assert.equal(status.status, "completed", status.error);
  assert.equal(status.output.editor, "capcut");
  assert.equal(status.output.finalPath, final);
});

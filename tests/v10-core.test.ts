import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { AssetRegistry } from "../src/core/asset-registry.js";
import { FFMPEG_SKILL_COMMIT, FFMPEG_SKILL_VERSION, ffmpegSkillStatus } from "../src/core/ffmpeg-skill-adapter.js";
import { IdempotencyConflictError, JobStore } from "../src/core/job-store.js";
import { JobRunner } from "../src/core/job-runner.js";
import { ProjectService } from "../src/core/project-service.js";
import { ProviderRouter } from "../src/providers/router.js";
import type { ImageRequest, ProviderHealth } from "../src/types.js";
import { MediaToolService } from "../src/core/tool-service.js";

async function tempData(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  process.env.CEO_MEDIA_DATA_DIR = dir;
  return dir;
}

test("V10 strong idempotency reuses identical requests and rejects conflicts", async () => {
  await tempData("ceo-media-v10-idem-");
  const store = new JobStore();
  const first = await store.create({ type: "image.generate", provider: "mock", input: { prompt: "same" }, idempotencyKey: "v10-key" });
  const reused = await store.create({ type: "image.generate", provider: "mock", input: { prompt: "same" }, idempotencyKey: "v10-key" });
  assert.equal(reused.id, first.id);
  await assert.rejects(
    () => store.create({ type: "image.generate", provider: "mock", input: { prompt: "different" }, idempotencyKey: "v10-key" }),
    (error: unknown) => error instanceof IdempotencyConflictError && error.code === "IDEMPOTENCY_CONFLICT"
  );
});

test("V10 asset registry uses stable content identity", async () => {
  const dir = await tempData("ceo-media-v10-assets-");
  const a = path.join(dir, "a.bin");
  const b = path.join(dir, "b.bin");
  await writeFile(a, "identical-media-bytes");
  await writeFile(b, "identical-media-bytes");
  const registry = new AssetRegistry();
  const first = await registry.register(a, { projectId: "project-a", source: "test" });
  const second = await registry.register(b, { projectId: "project-a", source: "test" });
  assert.equal(first.id, second.id);
  assert.equal(first.sha256, second.sha256);
  assert.equal((await registry.findByHash(first.sha256))?.id, first.id);
});

test("V10 durable worker runs a bounded four-job wave", async () => {
  const dir = await tempData("ceo-media-v10-concurrency-");
  process.env.CEO_MEDIA_WORKER_CONCURRENCY = "4";
  const store = new JobStore();
  const router = new ProviderRouter();
  let active = 0;
  let maxActive = 0;
  router.register({
    id: "mock",
    async health(): Promise<ProviderHealth> { return { id: "mock", ready: true, capabilities: ["image"] }; },
    async generateImage(request: ImageRequest): Promise<{ outputPath: string }> {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 35));
      await writeFile(request.outputPath, `asset:${path.basename(request.outputPath)}`);
      active -= 1;
      return { outputPath: request.outputPath };
    }
  });
  for (let i = 0; i < 5; i++) {
    await store.create({ type: "image.generate", provider: "mock", input: { prompt: `shot-${i}`, outputPath: path.join(dir, `shot-${i}.jpg`) } });
  }
  const runner = new JobRunner(store, router, new ProjectService());
  const results = await runner.tick(10);
  assert.equal(results.length, 5);
  assert.equal(maxActive, 4);
  assert.ok(results.every((job) => job.status === "completed"));
  assert.ok(results.every((job) => Boolean((job.output as any)?.assetId)));
});

test("V10 ffmpeg-skill pin is immutable and capability manifest exposes V10", async () => {
  assert.equal(FFMPEG_SKILL_VERSION, "0.15.3");
  assert.equal(FFMPEG_SKILL_COMMIT, "7dfbdc5b30a622dbb3c7029e690280b7ac43615e");
  const status = ffmpegSkillStatus();
  assert.equal(status.expectedCommit, FFMPEG_SKILL_COMMIT);
  const capabilities: any = await new MediaToolService().call("media.capabilities");
  assert.ok(capabilities.versions.includes("v10"));
  assert.ok(capabilities.versions.includes("v11"));
  assert.equal(capabilities.localFlowBrowserDriver, true);
  assert.equal(capabilities.assetRegistry, true);
  assert.equal(capabilities.strongIdempotency, true);
  assert.equal(capabilities.maxWorkerConcurrency, 4);
});

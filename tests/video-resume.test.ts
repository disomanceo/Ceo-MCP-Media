import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { MediaToolService } from "../src/core/tool-service.js";

test("video job resumes after service restart", async () => {
  process.env.CEO_MEDIA_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "ceo-media-video-"));
  process.env.CEO_MEDIA_PROVIDER = "mock";
  process.env.CEO_MEDIA_POLL_MS = "0";

  const firstProcess = new MediaToolService();
  const job: any = await firstProcess.call("media.video.generate", { prompt: "cinematic school shot", provider: "mock", durationSec: 8, idempotencyKey: "resume-video-1" });
  const waiting: any = await firstProcess.call("media.job.run_once", { jobId: job.id });
  assert.equal(waiting.status, "waiting");
  assert.ok(waiting.providerState?.operationId);

  const restartedProcess = new MediaToolService();
  const done: any = await restartedProcess.call("media.job.run_once", { jobId: job.id });
  assert.equal(done.status, "completed");
  assert.equal(done.attempts, 1, "provider polling must not consume retry attempts");
  const payload = JSON.parse(await readFile((done.output as any).outputPath, "utf8"));
  assert.equal(payload.type, "video");
});

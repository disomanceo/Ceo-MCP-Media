import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { MediaToolService } from "../src/core/tool-service.js";

test("V10 movie workflow persists a production workspace, seeded references and optional audio stage", async () => {
  process.env.CEO_MEDIA_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "ceo-media-v9-"));
  process.env.CEO_MEDIA_POLL_MS = "0";
  process.env.CEO_MEDIA_PROVIDER = "mock";
  const seed = path.join(process.env.CEO_MEDIA_DATA_DIR, "person-reference.jpg");
  await writeFile(seed, "fake-reference");
  const service = new MediaToolService();
  const created: any = await service.call("media.movie.create", {
    name: "V9 Production Movie",
    brief: "A school director presents an AI education project.",
    script: "Open with the director at school. Continue with a classroom demonstration. Finish with the project result.",
    totalDurationSec: 16,
    aspectRatio: "9:16",
    resolution: "1080p",
    provider: "mock",
    compose: false,
    generateVoice: true,
    voiceProvider: "mock",
    generateMusic: true,
    musicProvider: "mock",
    musicPrompt: "Warm modern educational instrumental",
    character: { name: "Director", description: "Thai school director", referenceImages: [seed], continuityTags: ["director-face-v1"] },
    shotPrompts: ["Director introduces the project", "Director demonstrates the classroom result"],
    dialogues: ["สวัสดีครับ วันนี้ขอนำเสนอโครงการ", "นี่คือผลลัพธ์ที่เกิดขึ้นจริง"]
  });

  assert.ok(created.workspaceRoot);
  assert.ok(created.manifestPath);
  await access(path.join(created.workspaceRoot, "00-script", "script.md"));
  await access(path.join(created.workspaceRoot, "01-anchor", "anchor_prompt.md"));
  await access(path.join(created.workspaceRoot, "02-flow", "shot01.md"));

  let status: any;
  for (let i = 0; i < 50; i++) {
    await service.call("media.job.run_once", { jobId: created.movieJobId });
    await service.call("media.job.tick", { limit: 30 });
    status = await service.call("media.movie.status", { jobId: created.movieJobId });
    if (status.status === "completed" || status.status === "failed") break;
  }

  assert.equal(status.status, "completed", status.error);
  assert.equal(status.output.shotPaths.length, 2);
  assert.ok(status.output.voicePath);
  assert.ok(status.output.musicPath);
  await access(status.output.voicePath);
  await access(status.output.musicPath);
  await access(status.output.subtitlePath);

  const manifestResult: any = await service.call("media.movie.manifest", { jobId: created.movieJobId });
  assert.equal(manifestResult.manifest.pipeline, "ceo-mcp-media-v10");
  assert.equal(manifestResult.manifest.progress.shotsCompleted, 2);
  assert.equal(manifestResult.manifest.progress.voiceReady, true);
  assert.equal(manifestResult.manifest.progress.musicReady, true);
  const script = await readFile(path.join(created.workspaceRoot, "00-script", "script.md"), "utf8");
  assert.match(script, /classroom demonstration/);
});

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp } from "node:fs/promises";
import { MediaToolService } from "../src/core/tool-service.js";

test("movie.create orchestrates anchor, serial shots and subtitles durably", async () => {
  process.env.CEO_MEDIA_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "ceo-media-movie-"));
  process.env.CEO_MEDIA_POLL_MS = "0";
  process.env.CEO_MEDIA_PROVIDER = "mock";
  const service = new MediaToolService();
  const created: any = await service.call("media.movie.create", {
    name: "V7 Movie Test",
    brief: "Original Thai rescue engineer protects a school from malfunctioning robots.",
    totalDurationSec: 16,
    aspectRatio: "9:16",
    resolution: "1080p",
    provider: "mock",
    compose: false,
    videoConcurrency: 1,
    idempotencyKey: "movie-v7-test",
    character: { name: "Engineer", description: "Young Thai rescue engineer", wardrobe: "industrial open-frame exoskeleton", continuityTags: ["face-v1", "rescue-suit-v1"] },
    shotPrompts: ["Engineer arrives at the school courtyard", "Engineer safely shuts down the robots"],
    dialogues: ["เริ่มภารกิจ", "ภารกิจสำเร็จ"]
  });
  assert.ok(created.movieJobId);
  let movie: any;
  for (let i = 0; i < 30; i++) {
    await service.call("media.job.run_once", { jobId: created.movieJobId });
    await service.call("media.job.tick", { limit: 20 });
    movie = await service.call("media.movie.status", { jobId: created.movieJobId });
    if (movie.status === "completed") break;
  }
  assert.equal(movie.status, "completed", movie.error);
  assert.equal(movie.output.shotPaths.length, 2);
  assert.ok(movie.output.anchorPath);
  assert.ok(movie.output.subtitlePath);
  await access(movie.output.subtitlePath);
});

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { MediaToolService } from "../src/core/tool-service.js";

test("voice and music jobs run durably through mock provider", async () => {
  process.env.CEO_MEDIA_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "ceo-media-audio-"));
  process.env.CEO_MEDIA_VOICE_PROVIDER = "mock";
  process.env.CEO_MEDIA_MUSIC_PROVIDER = "mock";
  const service = new MediaToolService();

  const voice: any = await service.call("media.audio.voice", { text: "สวัสดี", language: "th-TH", idempotencyKey: "voice-1" });
  assert.equal(voice.status, "queued");
  const voiceDone: any = await service.call("media.job.run_once", { jobId: voice.id });
  assert.equal(voiceDone.status, "completed");
  const voicePayload = JSON.parse(await readFile((voiceDone.output as any).outputPath, "utf8"));
  assert.equal(voicePayload.type, "voice");

  const music: any = await service.call("media.audio.music", { prompt: "warm cinematic school theme", durationSec: 8, idempotencyKey: "music-1" });
  assert.equal(music.status, "queued");
  const musicDone: any = await service.call("media.job.run_once", { jobId: music.id });
  assert.equal(musicDone.status, "completed");
  const musicPayload = JSON.parse(await readFile((musicDone.output as any).outputPath, "utf8"));
  assert.equal(musicPayload.type, "music");
});

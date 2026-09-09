import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { MediaToolService } from "../dist/src/core/tool-service.js";
import { resolveFfmpeg, resolveFfprobe } from "../dist/src/core/media-tools.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const assets = path.join(root, "data", "assets");
const renders = path.join(root, "data", "renders");
mkdirSync(assets, { recursive: true });
mkdirSync(renders, { recursive: true });
process.env.CEO_MEDIA_DATA_DIR = path.join(root, "data");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout || "").slice(-4000)}`);
  return result.stdout;
}

const ffmpeg = resolveFfmpeg();
const ffprobe = resolveFfprobe();
const clipA = path.join(assets, "smoke-a.mp4");
const clipB = path.join(assets, "smoke-b.mp4");
const output = path.join(renders, "smoke-final.mp4");
run(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", clipA]);
run(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", clipB]);

const service = new MediaToolService();
const job = await service.call("media.compose", { clips: [clipA, clipB], outputPath: output, idempotencyKey: `smoke-compose-${Date.now()}` });
const done = await service.call("media.job.run_once", { jobId: job.id });
if (done.status !== "completed") throw new Error(`compose job failed: ${done.error || done.status}`);

const probeText = run(ffprobe, ["-v", "error", "-show_entries", "format=duration,size", "-show_entries", "stream=codec_name,width,height", "-of", "json", output]);
const probe = JSON.parse(probeText);
const video = probe.streams?.find((stream) => stream.width && stream.height);
const duration = Number(probe.format?.duration || 0);
if (!video || video.codec_name !== "h264" || video.width !== 320 || video.height !== 180 || duration < 1.8) throw new Error(`unexpected ffprobe result: ${probeText}`);
console.log(JSON.stringify({ ok: true, ffmpeg, ffprobe, output, duration, codec: video.codec_name, width: video.width, height: video.height, size: Number(probe.format?.size || 0) }, null, 2));

import path from "node:path";
import { spawn } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { ensureDir, newId } from "./utils.js";
import { resolveFfmpeg } from "./media-tools.js";

async function run(executable: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr = (stderr + String(d)).slice(-16_000); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${executable} exited ${code}: ${stderr.slice(-4000)}`)));
  });
}

export async function composeVideos(input: { clips: string[]; outputPath: string; subtitleFile?: string; audioFile?: string; }): Promise<{ outputPath: string }> {
  if (!input.clips.length) throw new Error("At least one clip is required");
  const ffmpeg = resolveFfmpeg();
  await ensureDir(path.dirname(input.outputPath));
  const listFile = path.join(path.dirname(input.outputPath), `.concat-${newId("tmp")}.txt`);
  const lines = input.clips.map((clip) => `file '${path.resolve(clip).replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listFile, lines, "utf8");
  try {
    const args = ["-y", "-f", "concat", "-safe", "0", "-i", listFile];
    if (input.audioFile) args.push("-i", input.audioFile);
    if (input.subtitleFile) {
      const sub = path.resolve(input.subtitleFile).replace(/\\/g, "/").replace(/:/g, "\\:");
      args.push("-vf", `subtitles='${sub}'`);
    }
    if (input.audioFile) args.push("-map", "0:v:0", "-map", "1:a:0", "-shortest");
    args.push("-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", input.outputPath);
    await run(ffmpeg, args);
    return { outputPath: input.outputPath };
  } finally {
    await unlink(listFile).catch(() => undefined);
  }
}

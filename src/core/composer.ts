import path from "node:path";
import { spawn } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { ensureDir, newId } from "./utils.js";
import { resolveFfmpeg } from "./media-tools.js";
import { ffmpegSkillStatus, runFfmpegSkill } from "./ffmpeg-skill-adapter.js";

export interface ComposeInput {
  clips: string[];
  outputPath: string;
  subtitleFile?: string;
  audioFile?: string;
  musicFile?: string;
  transitionSec?: number;
  deliveryPlatform?: "youtube" | "shorts" | "reels" | "tiktok" | "x" | "linkedin" | "broadcast" | "podcast";
  loudnessLufs?: number;
  truePeakDb?: number;
}

export interface ComposeResult extends Record<string, unknown> {
  outputPath: string;
  engine: "ffmpeg-skill" | "legacy-ffmpeg";
  verification?: Record<string, unknown>;
  contactSheet?: string;
}

async function run(executable: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr = (stderr + String(d)).slice(-16_000); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${executable} exited ${code}: ${stderr.slice(-4000)}`)));
  });
}

async function composeWithSkill(input: ComposeInput): Promise<ComposeResult> {
  await ensureDir(path.dirname(input.outputPath));
  const projectFile = path.join(path.dirname(input.outputPath), `.ffmpeg-skill-${newId("render")}.json`);
  const sheetPath = path.join(path.dirname(input.outputPath), `${path.parse(input.outputPath).name}-contact-sheet.png`);
  const platform = input.deliveryPlatform ?? "youtube";
  const transitionSec = input.transitionSec ?? Number(process.env.CEO_MEDIA_TRANSITION_SEC || 0.25);
  const sourceProbes = await Promise.all(input.clips.map((clip) => runFfmpegSkill("probe", { input: clip })));
  const hasAudio = Boolean(input.audioFile || input.musicFile || sourceProbes.some((probe: any) => Boolean(probe?.audio)));
  const project: Record<string, unknown> = {
    output: path.resolve(input.outputPath),
    clips: input.clips.map((clip) => ({ src: path.resolve(clip) })),
    ...(transitionSec > 0 && input.clips.length > 1 ? { transition: { type: "fade", duration: transitionSec } } : {}),
    ...(input.subtitleFile ? { captions: { srt: path.resolve(input.subtitleFile), position: "bottom" } } : {}),
    ...((input.audioFile || input.musicFile) ? {
      audio: {
        ...(input.audioFile ? { replace: path.resolve(input.audioFile), voice: true } : {}),
        ...(input.musicFile ? { music: path.resolve(input.musicFile), music_volume: -18, music_loop: true, duck: Boolean(input.audioFile) } : {})
      }
    } : {}),
    ...(hasAudio ? { loudness: { lufs: input.loudnessLufs ?? -14, tp: input.truePeakDb ?? -1 } } : {})
  };
  await writeFile(projectFile, JSON.stringify(project, null, 2), "utf8");
  try {
    const render = await runFfmpegSkill("render", { project: projectFile });
    const probe = await runFfmpegSkill("probe", { input: input.outputPath, analyze: true });
    const check = await runFfmpegSkill("check", { input: input.outputPath, platform, lufs: input.loudnessLufs ?? -14, tp: input.truePeakDb ?? -1, noLoudness: !hasAudio });
    const look = await runFfmpegSkill("look", { input: input.outputPath, output: sheetPath, tiles: "4x3", width: 1280 });
    const failed = Number((check as any)?.failed || 0);
    const exitCode = Number((check as any)?.exitCode || 0);
    if (failed > 0 || exitCode !== 0) throw new Error(`ffmpeg-skill delivery verification failed for ${platform}`);
    return { outputPath: input.outputPath, engine: "ffmpeg-skill", verification: { render, probe, check, look }, contactSheet: sheetPath };
  } finally {
    await unlink(projectFile).catch(() => undefined);
  }
}

async function composeLegacy(input: ComposeInput): Promise<ComposeResult> {
  const ffmpeg = resolveFfmpeg();
  await ensureDir(path.dirname(input.outputPath));
  const listFile = path.join(path.dirname(input.outputPath), `.concat-${newId("tmp")}.txt`);
  const lines = input.clips.map((clip) => `file '${path.resolve(clip).replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listFile, lines, "utf8");
  try {
    const args = ["-y", "-f", "concat", "-safe", "0", "-i", listFile];
    let nextInput = 1;
    const voiceInput = input.audioFile ? nextInput++ : 0;
    const musicInput = input.musicFile ? nextInput++ : 0;
    if (input.audioFile) args.push("-i", input.audioFile);
    if (input.musicFile) args.push("-stream_loop", "-1", "-i", input.musicFile);
    if (input.subtitleFile) {
      const sub = path.resolve(input.subtitleFile).replace(/\\/g, "/").replace(/:/g, "\\:");
      args.push("-vf", `subtitles='${sub}'`);
    }

    if (input.audioFile && input.musicFile) {
      args.push("-filter_complex", `[${voiceInput}:a:0]volume=1.0[voice];[${musicInput}:a:0]volume=0.20[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`);
      args.push("-map", "0:v:0", "-map", "[aout]", "-shortest");
    } else if (input.audioFile) {
      args.push("-map", "0:v:0", "-map", `${voiceInput}:a:0`, "-shortest");
    } else if (input.musicFile) {
      args.push("-map", "0:v:0", "-map", `${musicInput}:a:0`, "-shortest");
    }

    args.push("-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", input.outputPath);
    await run(ffmpeg, args);
    return { outputPath: input.outputPath, engine: "legacy-ffmpeg" };
  } finally {
    await unlink(listFile).catch(() => undefined);
  }
}

export async function composeVideos(input: ComposeInput): Promise<ComposeResult> {
  if (!input.clips.length) throw new Error("At least one clip is required");
  const skill = ffmpegSkillStatus();
  const enabled = String(process.env.CEO_MEDIA_FFMPEG_SKILL_ENABLED ?? "true").toLowerCase() !== "false";
  if (enabled && skill.usable) return composeWithSkill(input);
  return composeLegacy(input);
}

import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { MediaJob, MediaProject, MovieCreateInput } from "../types.js";
import { dataDir, ensureDir, nowIso, safeName, writeJsonAtomic } from "./utils.js";

export interface MovieWorkspace {
  root: string;
  scriptDir: string;
  anchorDir: string;
  scenesDir: string;
  audioDir: string;
  capcutDir: string;
  exportDir: string;
  manifestPath: string;
  scriptPath: string;
  anchorPromptPath: string;
  anchorImagePath: string;
  subtitlePath: string;
  voicePath: string;
  musicPath: string;
  capcutPlanPath: string;
  exportPlanPath: string;
  finalPath: string;
  shotPath(index: number): string;
  shotPromptPath(index: number): string;
}

export function movieWorkspace(project: MediaProject): MovieWorkspace {
  const root = path.join(dataDir(), "workspaces", `${safeName(project.name)}-${project.id}`);
  const scriptDir = path.join(root, "00-script");
  const anchorDir = path.join(root, "01-anchor");
  const scenesDir = path.join(root, "02-flow");
  const audioDir = path.join(root, "03-audio");
  const capcutDir = path.join(root, "04-capcut");
  const exportDir = path.join(root, "05-export");
  return {
    root,
    scriptDir,
    anchorDir,
    scenesDir,
    audioDir,
    capcutDir,
    exportDir,
    manifestPath: path.join(root, "manifest.json"),
    scriptPath: path.join(scriptDir, "script.md"),
    anchorPromptPath: path.join(anchorDir, "anchor_prompt.md"),
    anchorImagePath: path.join(anchorDir, "anchor.jpg"),
    subtitlePath: path.join(capcutDir, "subtitle.srt"),
    voicePath: path.join(audioDir, "voice.wav"),
    musicPath: path.join(audioDir, "music.wav"),
    capcutPlanPath: path.join(capcutDir, "capcut-edit.md"),
    exportPlanPath: path.join(exportDir, "export.json"),
    finalPath: path.join(exportDir, "final.mp4"),
    shotPath: (index: number) => path.join(scenesDir, `shot${String(index + 1).padStart(2, "0")}.mp4`),
    shotPromptPath: (index: number) => path.join(scenesDir, `shot${String(index + 1).padStart(2, "0")}.md`)
  };
}

function shotMarkdown(project: MediaProject, index: number): string {
  const shot = project.storyboard?.shots[index];
  if (!shot) return "";
  return [
    `# ${shot.title}`,
    "",
    `Duration: ${shot.durationSec}s`,
    `Camera: ${shot.camera ?? "auto"}`,
    `Dialogue: ${shot.dialogue ?? ""}`,
    "",
    "## Prompt",
    shot.prompt,
    "",
    "## Continuity",
    shot.continuityTags.length ? shot.continuityTags.map((x) => `- ${x}`).join("\n") : "- use project character/reference lock"
  ].join("\n");
}

export async function prepareMovieWorkspace(project: MediaProject, movieJobId: string, input: MovieCreateInput, routes: Record<string, unknown>): Promise<MovieWorkspace> {
  const ws = movieWorkspace(project);
  await Promise.all([ws.scriptDir, ws.anchorDir, ws.scenesDir, ws.audioDir, ws.capcutDir, ws.exportDir].map((dir) => ensureDir(dir)));
  const script = String(input.script || project.brief || "").trim();
  await writeFile(ws.scriptPath, `# ${project.name}\n\n${script}\n`, "utf8");
  await writeFile(ws.anchorPromptPath, String(input.anchorPrompt || project.characters[0]?.description || project.brief), "utf8");
  for (let i = 0; i < (project.storyboard?.shots.length ?? 0); i++) await writeFile(ws.shotPromptPath(i), shotMarkdown(project, i), "utf8");
  await writeFile(ws.capcutPlanPath, [
    `# CapCut assembly — ${project.name}`,
    "",
    "1. Import shots in storyboard order.",
    "2. Preserve native shot audio where useful.",
    "3. Import voice/music assets when present.",
    "4. Import subtitle.srt and align captions.",
    "5. Verify exact duration, framing and continuity before export."
  ].join("\n"), "utf8");
  await writeJsonAtomic(ws.exportPlanPath, { aspectRatio: project.aspectRatio, resolution: project.resolution, fps: project.fps, outputPath: input.outputPath || ws.finalPath });
  await writeJsonAtomic(ws.manifestPath, {
    version: 2,
    pipeline: "ceo-mcp-media-v10",
    movieJobId,
    projectId: project.id,
    name: project.name,
    status: "queued",
    phase: "planned",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    routes,
    files: {
      script: ws.scriptPath,
      anchorPrompt: ws.anchorPromptPath,
      anchorImage: ws.anchorImagePath,
      subtitles: ws.subtitlePath,
      voice: ws.voicePath,
      music: ws.musicPath,
      capcutPlan: ws.capcutPlanPath,
      exportPlan: ws.exportPlanPath,
      final: input.outputPath || ws.finalPath
    },
    shots: project.storyboard?.shots.map((shot, i) => ({ index: i + 1, id: shot.id, durationSec: shot.durationSec, status: shot.status || "planned", promptFile: ws.shotPromptPath(i), outputPath: ws.shotPath(i) })) ?? []
  });
  return ws;
}

export async function updateMovieManifest(project: MediaProject, job: MediaJob<MovieCreateInput>, state: Record<string, any>): Promise<void> {
  const ws = movieWorkspace(project);
  let previous: Record<string, any> = {};
  try { previous = JSON.parse(await readFile(ws.manifestPath, "utf8")); } catch { /* manifest is best-effort and recreated below */ }
  const shots = project.storyboard?.shots ?? [];
  const completedShots = shots.filter((s) => Boolean(s.assetPath) && ["generated", "approved"].includes(String(s.status))).length;
  await writeJsonAtomic(ws.manifestPath, {
    ...previous,
    version: 2,
    pipeline: "ceo-mcp-media-v10",
    movieJobId: job.id,
    projectId: project.id,
    name: project.name,
    status: job.status,
    phase: state.phase || "planned",
    updatedAt: nowIso(),
    progress: {
      shotsCompleted: completedShots,
      shotsTotal: shots.length,
      anchorReady: Boolean(state.anchorPath),
      subtitlesReady: Boolean(state.subtitlePath),
      voiceReady: Boolean(state.voicePath),
      musicReady: Boolean(state.musicPath),
      finalReady: Boolean((job.output as any)?.finalPath)
    },
    files: {
      ...(previous.files || {}),
      script: ws.scriptPath,
      anchorPrompt: ws.anchorPromptPath,
      anchorImage: state.anchorPath || ws.anchorImagePath,
      subtitles: state.subtitlePath || ws.subtitlePath,
      voice: state.voicePath || ws.voicePath,
      music: state.musicPath || ws.musicPath,
      capcutPlan: ws.capcutPlanPath,
      exportPlan: ws.exportPlanPath,
      final: (job.output as any)?.finalPath || job.input.outputPath || ws.finalPath
    },
    shots: shots.map((shot, i) => ({ index: i + 1, id: shot.id, durationSec: shot.durationSec, status: shot.status || "planned", promptFile: ws.shotPromptPath(i), outputPath: shot.assetPath || ws.shotPath(i) }))
  });
}

export async function readMovieManifest(project: MediaProject): Promise<Record<string, unknown> | null> {
  const ws = movieWorkspace(project);
  try { return JSON.parse(await readFile(ws.manifestPath, "utf8")) as Record<string, unknown>; }
  catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

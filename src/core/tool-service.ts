import path from "node:path";
import { JobStore } from "./job-store.js";
import { JobRunner } from "./job-runner.js";
import { ProjectService } from "./project-service.js";
import { planStoryboard } from "./storyboard.js";
import { ProviderRouter } from "../providers/router.js";
import { FlowBridge } from "../providers/flow-bridge.js";
import { reviewShot } from "./director.js";
import { storyboardToSrt } from "./subtitles.js";
import { dataDir, safeName, writeJsonAtomic } from "./utils.js";

export const TOOL_NAMES = ["media.project.create","media.project.list","media.project.get","media.character.lock","media.storyboard.plan","media.image.generate","media.video.generate","media.video.regenerate","media.audio.voice","media.audio.music","media.compose","media.subtitle.generate","media.director.review","media.job.status","media.job.list","media.job.run_once","media.job.tick","media.job.cancel","media.provider.status","media.flow.handoff","media.capabilities"];

export class MediaToolService {
  projects = new ProjectService(); jobs = new JobStore(); router = new ProviderRouter(); runner = new JobRunner(this.jobs, this.router); flow = new FlowBridge();
  async call(name: string, args: any = {}) {
    switch (name) {
      case "media.project.create": return this.projects.create(args);
      case "media.project.list": return this.projects.list();
      case "media.project.get": return this.projects.get(args.projectId);
      case "media.character.lock": return this.projects.addCharacter(args.projectId, { name: args.name, description: args.description, wardrobe: args.wardrobe, voice: args.voice, referenceImages: args.referenceImages ?? [], continuityTags: args.continuityTags ?? [] });
      case "media.storyboard.plan": { const p = await this.projects.get(args.projectId); const b = planStoryboard({ projectId: p.id, title: args.title ?? p.name, brief: args.brief ?? p.brief, totalDurationSec: args.totalDurationSec ?? 8, aspectRatio: args.aspectRatio ?? p.aspectRatio, maxShotSec: args.maxShotSec ?? 8, characters: p.characters }); await this.projects.setStoryboard(p.id, b); return b; }
      case "media.image.generate": { const p = args.projectId ? await this.projects.get(args.projectId) : undefined; const outputPath = args.outputPath ?? path.join(dataDir(), "assets", `${safeName(args.name ?? "image")}-${Date.now()}.png`); return this.jobs.create({ type: "image.generate", projectId: p?.id, provider: args.provider, idempotencyKey: args.idempotencyKey, input: { prompt: args.prompt, outputPath, aspectRatio: args.aspectRatio ?? p?.aspectRatio, referenceImages: args.referenceImages ?? [] } }); }
      case "media.video.generate": { const p = args.projectId ? await this.projects.get(args.projectId) : undefined; const outputPath = args.outputPath ?? path.join(dataDir(), "assets", `${safeName(args.name ?? "video")}-${Date.now()}.mp4`); return this.jobs.create({ type: "video.generate", projectId: p?.id, provider: args.provider, idempotencyKey: args.idempotencyKey, input: { prompt: args.prompt, outputPath, aspectRatio: args.aspectRatio ?? p?.aspectRatio ?? "16:9", resolution: args.resolution ?? p?.resolution ?? "1080p", durationSec: Math.min(8, args.durationSec ?? 8), referenceImages: (args.referenceImages ?? []).slice(0, 3), firstFrame: args.firstFrame, lastFrame: args.lastFrame } }); }
      case "media.video.regenerate": { const old = await this.jobs.get(args.jobId); if (old.type !== "video.generate") throw new Error("job is not a video generation job"); const input = old.input as any; return this.jobs.create({ type: old.type, projectId: old.projectId, provider: args.provider ?? old.provider, idempotencyKey: args.idempotencyKey, input: { ...input, prompt: args.prompt ?? input.prompt, outputPath: args.outputPath ?? String(input.outputPath).replace(/\.mp4$/i, `-retry-${Date.now()}.mp4`) } }); }
      case "media.audio.voice": { const outputPath = args.outputPath ?? path.join(dataDir(), "assets", `${safeName(args.name ?? "voice")}-${Date.now()}.wav`); return this.jobs.create({ type: "audio.voice", projectId: args.projectId, provider: args.provider, idempotencyKey: args.idempotencyKey, input: { text: args.text, outputPath, voice: args.voice, language: args.language ?? "th-TH", speed: args.speed, style: args.style } }); }
      case "media.audio.music": { const outputPath = args.outputPath ?? path.join(dataDir(), "assets", `${safeName(args.name ?? "music")}-${Date.now()}.wav`); return this.jobs.create({ type: "audio.music", projectId: args.projectId, provider: args.provider, idempotencyKey: args.idempotencyKey, input: { prompt: args.prompt, outputPath, durationSec: args.durationSec, mood: args.mood, instrumental: args.instrumental ?? true } }); }
      case "media.compose": return this.jobs.create({ type: "compose", projectId: args.projectId, idempotencyKey: args.idempotencyKey, input: { clips: args.clips, outputPath: args.outputPath, subtitleFile: args.subtitleFile, audioFile: args.audioFile } });
      case "media.job.status": return this.jobs.get(args.jobId);
      case "media.job.list": return this.jobs.list();
      case "media.job.run_once": return this.runner.runOnce(args.jobId);
      case "media.job.tick": return this.runner.tick(args.limit ?? 20);
      case "media.job.cancel": return this.jobs.cancel(args.jobId);
      case "media.provider.status": return this.router.status();
      case "media.director.review": { const p = await this.projects.get(args.projectId); if (!p.storyboard) throw new Error("project has no storyboard"); return p.storyboard.shots.map((shot, i) => ({ shotId: shot.id, ...reviewShot(shot, i > 0 ? p.storyboard!.shots[i - 1] : undefined, args.threshold ?? 70) })); }
      case "media.subtitle.generate": { const p = await this.projects.get(args.projectId); if (!p.storyboard) throw new Error("project has no storyboard"); return storyboardToSrt(p.storyboard, args.outputPath ?? path.join(dataDir(), "assets", `${safeName(p.name)}.srt`)); }
      case "media.flow.handoff": { const p = await this.projects.get(args.projectId); if (!p.storyboard) throw new Error("project has no storyboard"); const handoff = this.flow.prepare(p.id, p.name, p.storyboard); const outputPath = args.outputPath ?? path.join(dataDir(), "assets", `${safeName(p.name)}-flow-handoff.json`); await writeJsonAtomic(outputPath, handoff); return { outputPath, handoff }; }
      case "media.capabilities": return { versions: ["v1","v2","v3","v4","v5","v6"], durable: true, providerAgnostic: true, flowOptional: true, maxReferenceImages: 3, maxShotSec: 8, audioJobs: ["voice","music"], tools: TOOL_NAMES };
      default: throw new Error(`Unknown tool: ${name}`);
    }
  }
}

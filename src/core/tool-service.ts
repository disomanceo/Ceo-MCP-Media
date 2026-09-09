import path from "node:path";
import { IdempotencyConflictError, JobStore, mediaRequestHash } from "./job-store.js";
import { JobRunner } from "./job-runner.js";
import { ProjectService } from "./project-service.js";
import { planStoryboard } from "./storyboard.js";
import { ProviderRouter } from "../providers/router.js";
import { StudioRouter } from "../providers/studio-router.js";
import { FlowBridge } from "../providers/flow-bridge.js";
import { ExternalActionService } from "./external-actions.js";
import { reviewShot } from "./director.js";
import { storyboardToSrt } from "./subtitles.js";
import { dataDir, safeName, writeJsonAtomic } from "./utils.js";
import { preflightPrompt } from "./preflight.js";
import { movieWorkspace, prepareMovieWorkspace, readMovieManifest } from "./pipeline-workspace.js";
import { AssetRegistry } from "./asset-registry.js";
import { ffmpegSkillStatus, runFfmpegSkill } from "./ffmpeg-skill-adapter.js";

export const TOOL_NAMES = [
  "media.movie.create","media.movie.status","media.movie.manifest","media.preflight.check","media.studio.status","media.studio.route",
  "media.external.next","media.external.list","media.external.complete","media.external.fail",
  "media.asset.list","media.asset.get","media.asset.register",
  "media.ffmpeg.status","media.ffmpeg.doctor","media.ffmpeg.contract","media.ffmpeg.render","media.ffmpeg.probe","media.ffmpeg.check","media.ffmpeg.look",
  "media.project.create","media.project.list","media.project.get","media.character.lock","media.storyboard.plan",
  "media.image.generate","media.video.generate","media.video.regenerate","media.audio.voice","media.audio.music","media.compose","media.subtitle.generate","media.director.review",
  "media.job.status","media.job.list","media.job.run_once","media.job.tick","media.job.cancel","media.provider.status","media.flow.handoff","media.capabilities"
];

export class MediaToolService {
  projects = new ProjectService();
  jobs = new JobStore();
  router = new ProviderRouter();
  studio = new StudioRouter();
  external = new ExternalActionService(this.jobs);
  assets = new AssetRegistry();
  runner = new JobRunner(this.jobs, this.router, this.projects);
  flow = new FlowBridge();

  private async createExternalImage(args: any, route: any, outputPath: string, prompt: string) {
    return this.external.create(args.projectId, {
      kind: "studio.image", provider: route.provider, title: args.name ? `Generate ${args.name}` : "Generate image", url: route.url, prompt,
      references: args.referenceImages ?? [], expectedOutputPath: outputPath,
      instructions: [
        `Open ${route.provider === "flow-web" ? "Google Flow" : "Google AI Studio"} in the browser. If Google asks for sign-in, pause and let the user sign in manually; never request, store or type account credentials.`,
        "Generate the image with the supplied prompt and reference images when supported.",
        "Download the generated image locally.",
        "Call media.external.complete with this action id and the downloaded local file path."
      ]
    }, args.idempotencyKey || `external-image:${args.projectId || "standalone"}:${safeName(args.name || "image")}:${Date.now()}`);
  }

  private async createExternalVideo(args: any, route: any, outputPath: string, prompt: string) {
    return this.external.create(args.projectId, {
      kind: "studio.video", provider: route.provider, title: args.name ? `Generate ${args.name}` : "Generate video", url: route.url, prompt,
      references: (args.referenceImages ?? []).slice(0, 3), expectedOutputPath: outputPath,
      metadata: { aspectRatio: args.aspectRatio, resolution: args.resolution, durationSec: Math.min(8, args.durationSec ?? 8) },
      instructions: [
        `Open ${route.provider === "flow-web" ? "Google Flow" : "Google AI Studio"} in the browser. If Google asks for sign-in, pause and let the user sign in manually; never request, store or type account credentials.`,
        "Upload/use the supplied continuity reference images or ingredients when the UI supports them.",
        "Generate the requested video shot with native audio/effects when available and without burned text.",
        "Download the generated MP4 locally.",
        "Call media.external.complete with this action id and the downloaded local MP4 path."
      ]
    }, args.idempotencyKey || `external-video:${args.projectId || "standalone"}:${safeName(args.name || "video")}:${Date.now()}`);
  }

  async call(name: string, args: any = {}) {
    switch (name) {
      case "media.preflight.check": return preflightPrompt(args.prompt, args.autoRewrite !== false);
      case "media.asset.list": return this.assets.list(args.projectId);
      case "media.asset.get": return this.assets.get(args.assetId);
      case "media.asset.register": return this.assets.register(args.path, { projectId: args.projectId, jobId: args.jobId, source: args.source, provenance: args.provenance });
      case "media.ffmpeg.status": return ffmpegSkillStatus();
      case "media.ffmpeg.doctor": return runFfmpegSkill("doctor");
      case "media.ffmpeg.contract": return runFfmpegSkill("contract", { static: args.static === true });
      case "media.ffmpeg.render": return runFfmpegSkill("render", args);
      case "media.ffmpeg.probe": return runFfmpegSkill("probe", args);
      case "media.ffmpeg.check": return runFfmpegSkill("check", args);
      case "media.ffmpeg.look": return runFfmpegSkill("look", args);
      case "media.studio.status": return this.studio.status();
      case "media.studio.route": return this.studio.resolve(args.capability, args.provider ?? "auto");
      case "media.external.list": return this.external.pending(args.projectId);
      case "media.external.next": return this.external.next(args.projectId);
      case "media.external.complete": return this.external.complete(args.jobId, args.outputPath, args.metadata);
      case "media.external.fail": return this.external.fail(args.jobId, args.error, args.retryable === true);

      case "media.movie.create": {
        const { idempotencyKey: _ignoredIdempotencyKey, ...semanticArgs } = args;
        const requestHash = mediaRequestHash({ tool: "media.movie.create", args: semanticArgs });
        if (args.idempotencyKey) {
          const existing = await this.jobs.findByIdempotency(args.idempotencyKey);
          if (existing) {
            if (existing.requestHash && existing.requestHash !== requestHash) throw new IdempotencyConflictError(args.idempotencyKey);
            const existingProject = existing.projectId ? await this.projects.get(existing.projectId) : undefined;
            return { movieJobId: existing.id, projectId: existing.projectId, status: existing.status, reused: true, workspaceRoot: existingProject ? movieWorkspace(existingProject).root : undefined, manifestPath: existingProject ? movieWorkspace(existingProject).manifestPath : undefined };
          }
        }
        const preference = args.provider ?? "auto";
        const [imageRoute, videoRoute] = await Promise.all([this.studio.resolve("image", preference), this.studio.resolve("video", preference)]);
        if (!imageRoute.ready) throw new Error(`No ready image route: ${imageRoute.reason}`);
        if (!videoRoute.ready) throw new Error(`No ready video route: ${videoRoute.reason}`);
        const checked = preflightPrompt(args.brief, args.autoRewriteGuardrails !== false);
        const scriptChecked = args.script ? preflightPrompt(args.script, args.autoRewriteGuardrails !== false) : undefined;
        const sourceScript = scriptChecked?.safePrompt || checked.safePrompt;
        const project = await this.projects.create({ name: args.name, brief: checked.safePrompt, aspectRatio: args.aspectRatio ?? "16:9", resolution: args.resolution ?? "1080p", fps: args.fps ?? 24 });
        await this.projects.addCharacter(project.id, {
          name: args.character.name,
          description: args.character.description,
          wardrobe: args.character.wardrobe,
          voice: args.character.voice,
          referenceImages: (args.character.referenceImages ?? []).slice(0, 3),
          continuityTags: args.character.continuityTags ?? []
        });
        const hydrated = await this.projects.get(project.id);
        const storyboard = planStoryboard({ projectId: project.id, title: args.title ?? project.name, brief: sourceScript, totalDurationSec: args.totalDurationSec ?? 8, aspectRatio: project.aspectRatio, maxShotSec: 8, characters: hydrated.characters });
        for (let i = 0; i < storyboard.shots.length; i++) {
          if (args.shotPrompts?.[i]) storyboard.shots[i].prompt = preflightPrompt(args.shotPrompts[i], args.autoRewriteGuardrails !== false).safePrompt;
          if (args.dialogues?.[i]) storyboard.shots[i].dialogue = args.dialogues[i];
        }
        await this.projects.setStoryboard(project.id, storyboard);
        const browserMode = imageRoute.mode === "browser" || videoRoute.mode === "browser";
        const finalEditor = args.finalEditor ?? (browserMode ? (process.env.CEO_MEDIA_BROWSER_FINAL_EDITOR || "capcut") : (process.env.CEO_MEDIA_FINAL_EDITOR || "ffmpeg"));
        const job = await this.jobs.create({
          type: "movie.create", projectId: project.id,
          provider: imageRoute.provider === videoRoute.provider ? imageRoute.provider : undefined,
          idempotencyKey: args.idempotencyKey, requestHash, timeoutMs: args.timeoutMs,
          input: {
            name: args.name, brief: checked.safePrompt, script: sourceScript, totalDurationSec: args.totalDurationSec ?? 8, aspectRatio: project.aspectRatio, resolution: project.resolution, fps: project.fps,
            provider: preference, resolvedImageProvider: imageRoute.provider, resolvedVideoProvider: videoRoute.provider,
            character: { ...args.character, referenceImages: (args.character.referenceImages ?? []).slice(0, 3) }, anchorPrompt: args.anchorPrompt, shotPrompts: args.shotPrompts, dialogues: args.dialogues,
            outputPath: args.outputPath, subtitlePath: args.subtitlePath, compose: args.compose !== false, finalEditor,
            autoRewriteGuardrails: args.autoRewriteGuardrails !== false, videoConcurrency: args.videoConcurrency ?? 4,
            generateVoice: args.generateVoice === true, voiceProvider: args.voiceProvider, voiceLanguage: args.voiceLanguage, voiceSpeed: args.voiceSpeed, voiceStyle: args.voiceStyle,
            generateMusic: args.generateMusic === true, musicProvider: args.musicProvider, musicPrompt: args.musicPrompt, musicMood: args.musicMood,
            idempotencyKey: args.idempotencyKey
          }
        });
        const currentProject = await this.projects.get(project.id);
        const ws = await prepareMovieWorkspace(currentProject, job.id, job.input as any, { image: imageRoute, video: videoRoute, finalEditor });
        job.providerState = { workspaceRoot: ws.root, manifestPath: ws.manifestPath };
        await this.jobs.save(job);
        return { movieJobId: job.id, projectId: project.id, status: job.status, preflight: checked, route: { image: imageRoute, video: videoRoute, finalEditor }, storyboard, workspaceRoot: ws.root, manifestPath: ws.manifestPath };
      }

      case "media.movie.status": {
        const job = await this.jobs.get(args.jobId);
        if (job.type !== "movie.create") throw new Error("job is not a movie workflow");
        const nextExternalAction = await this.external.next(job.projectId);
        const project = job.projectId ? await this.projects.get(job.projectId) : undefined;
        const manifest = project ? await readMovieManifest(project) : null;
        return { ...job, progress: (manifest as any)?.progress, manifestPath: project ? movieWorkspace(project).manifestPath : undefined, nextExternalAction };
      }

      case "media.movie.manifest": {
        const job = await this.jobs.get(args.jobId);
        if (job.type !== "movie.create" || !job.projectId) throw new Error("job is not a movie workflow");
        const project = await this.projects.get(job.projectId);
        return { manifestPath: movieWorkspace(project).manifestPath, manifest: await readMovieManifest(project) };
      }

      case "media.project.create": return this.projects.create(args);
      case "media.project.list": return this.projects.list();
      case "media.project.get": return this.projects.get(args.projectId);
      case "media.character.lock": return this.projects.addCharacter(args.projectId, { name: args.name, description: args.description, wardrobe: args.wardrobe, voice: args.voice, referenceImages: args.referenceImages ?? [], continuityTags: args.continuityTags ?? [] });
      case "media.storyboard.plan": {
        const p = await this.projects.get(args.projectId);
        const b = planStoryboard({ projectId: p.id, title: args.title ?? p.name, brief: args.brief ?? p.brief, totalDurationSec: args.totalDurationSec ?? 8, aspectRatio: args.aspectRatio ?? p.aspectRatio, maxShotSec: args.maxShotSec ?? 8, characters: p.characters });
        await this.projects.setStoryboard(p.id, b); return b;
      }
      case "media.image.generate": {
        const p = args.projectId ? await this.projects.get(args.projectId) : undefined;
        const outputPath = args.outputPath ?? path.join(dataDir(), "assets", args.idempotencyKey ? `${safeName(args.name ?? "image")}-${mediaRequestHash({ key: args.idempotencyKey }).slice(0, 12)}.jpg` : `${safeName(args.name ?? "image")}-${Date.now()}.jpg`);
        const checked = preflightPrompt(args.prompt, args.autoRewriteGuardrails === true);
        const route = await this.studio.resolve("image", args.provider ?? "auto");
        if (!route.ready) throw new Error(route.reason);
        if (route.mode === "browser") return this.createExternalImage({ ...args, projectId: p?.id }, route, outputPath, checked.safePrompt);
        return this.jobs.create({ type: "image.generate", projectId: p?.id, provider: route.provider, idempotencyKey: args.idempotencyKey, input: { prompt: checked.safePrompt, outputPath, aspectRatio: args.aspectRatio ?? p?.aspectRatio, referenceImages: args.referenceImages ?? [] } });
      }
      case "media.video.generate": {
        const p = args.projectId ? await this.projects.get(args.projectId) : undefined;
        const outputPath = args.outputPath ?? path.join(dataDir(), "assets", args.idempotencyKey ? `${safeName(args.name ?? "video")}-${mediaRequestHash({ key: args.idempotencyKey }).slice(0, 12)}.mp4` : `${safeName(args.name ?? "video")}-${Date.now()}.mp4`);
        const checked = preflightPrompt(args.prompt, args.autoRewriteGuardrails === true);
        const route = await this.studio.resolve("video", args.provider ?? "auto");
        if (!route.ready) throw new Error(route.reason);
        if (route.mode === "browser") return this.createExternalVideo({ ...args, projectId: p?.id, aspectRatio: args.aspectRatio ?? p?.aspectRatio ?? "16:9", resolution: args.resolution ?? p?.resolution ?? "1080p" }, route, outputPath, checked.safePrompt);
        return this.jobs.create({ type: "video.generate", projectId: p?.id, provider: route.provider, idempotencyKey: args.idempotencyKey, input: { prompt: checked.safePrompt, outputPath, aspectRatio: args.aspectRatio ?? p?.aspectRatio ?? "16:9", resolution: args.resolution ?? p?.resolution ?? "1080p", durationSec: Math.min(8, args.durationSec ?? 8), referenceImages: (args.referenceImages ?? []).slice(0, 3), firstFrame: args.firstFrame, lastFrame: args.lastFrame } });
      }
      case "media.video.regenerate": {
        const old = await this.jobs.get(args.jobId); if (old.type !== "video.generate") throw new Error("job is not an API/local video generation job");
        const input = old.input as any; return this.jobs.create({ type: old.type, projectId: old.projectId, provider: args.provider ?? old.provider, idempotencyKey: args.idempotencyKey, input: { ...input, prompt: args.prompt ?? input.prompt, outputPath: args.outputPath ?? String(input.outputPath).replace(/\.mp4$/i, `-retry-${Date.now()}.mp4`) } });
      }
      case "media.audio.voice": {
        const outputPath = args.outputPath ?? path.join(dataDir(), "assets", args.idempotencyKey ? `${safeName(args.name ?? "voice")}-${mediaRequestHash({ key: args.idempotencyKey }).slice(0, 12)}.wav` : `${safeName(args.name ?? "voice")}-${Date.now()}.wav`);
        return this.jobs.create({ type: "audio.voice", projectId: args.projectId, provider: args.provider, idempotencyKey: args.idempotencyKey, input: { text: args.text, outputPath, voice: args.voice, language: args.language ?? "th-TH", speed: args.speed, style: args.style } });
      }
      case "media.audio.music": {
        const outputPath = args.outputPath ?? path.join(dataDir(), "assets", args.idempotencyKey ? `${safeName(args.name ?? "music")}-${mediaRequestHash({ key: args.idempotencyKey }).slice(0, 12)}.wav` : `${safeName(args.name ?? "music")}-${Date.now()}.wav`);
        return this.jobs.create({ type: "audio.music", projectId: args.projectId, provider: args.provider, idempotencyKey: args.idempotencyKey, input: { prompt: args.prompt, outputPath, durationSec: args.durationSec, mood: args.mood, instrumental: args.instrumental ?? true } });
      }
      case "media.compose": return this.jobs.create({ type: "compose", projectId: args.projectId, idempotencyKey: args.idempotencyKey, input: { clips: args.clips, outputPath: args.outputPath, subtitleFile: args.subtitleFile, audioFile: args.audioFile, musicFile: args.musicFile, transitionSec: args.transitionSec, deliveryPlatform: args.deliveryPlatform, loudnessLufs: args.loudnessLufs, truePeakDb: args.truePeakDb } });
      case "media.job.status": return this.jobs.get(args.jobId);
      case "media.job.list": return this.jobs.list();
      case "media.job.run_once": return this.runner.runOnce(args.jobId);
      case "media.job.tick": return this.runner.tick(args.limit ?? 20);
      case "media.job.cancel": return this.jobs.cancel(args.jobId);
      case "media.provider.status": return { executable: await this.router.status(), studio: await this.studio.status() };
      case "media.director.review": {
        const p = await this.projects.get(args.projectId); if (!p.storyboard) throw new Error("project has no storyboard");
        return p.storyboard.shots.map((shot, i) => ({ shotId: shot.id, ...reviewShot(shot, i > 0 ? p.storyboard!.shots[i - 1] : undefined, args.threshold ?? 70) }));
      }
      case "media.subtitle.generate": {
        const p = await this.projects.get(args.projectId); if (!p.storyboard) throw new Error("project has no storyboard");
        return storyboardToSrt(p.storyboard, args.outputPath ?? path.join(dataDir(), "assets", `${safeName(p.name)}.srt`));
      }
      case "media.flow.handoff": {
        const p = await this.projects.get(args.projectId); if (!p.storyboard) throw new Error("project has no storyboard");
        const handoff = this.flow.prepare(p.id, p.name, p.storyboard); const outputPath = args.outputPath ?? path.join(dataDir(), "assets", `${safeName(p.name)}-flow-handoff.json`);
        await writeJsonAtomic(outputPath, handoff); return { outputPath, handoff };
      }
      case "media.capabilities": return {
        versions: ["v1","v2","v3","v4","v5","v6","v7","v8","v9","v10"], durable: true, autoMoviePipeline: true, autoWorker: process.env.CEO_MEDIA_AUTO_WORKER !== "false",
        studioRouter: true, nativeProviders: ["flow-native"], browserProviders: ["flow-web","ai-studio-web"], browserExternalActions: true, capcutBridge: true,
        productionWorkspace: true, persistentManifest: true, seededReferenceImages: true, audioStage: true, assetRegistry: true,
        ffmpegSkill: ffmpegSkillStatus(), maxWorkerConcurrency: 4, strongIdempotency: true,
        providerAgnostic: true, flowOptional: true, guardrailPreflight: true, staleRunningRecovery: true, maxReferenceImages: 3, maxShotSec: 8, audioJobs: ["voice","music"], tools: TOOL_NAMES
      };
      default: throw new Error(`Unknown tool: ${name}`);
    }
  }
}

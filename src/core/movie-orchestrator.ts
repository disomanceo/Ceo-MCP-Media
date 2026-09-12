import type { MediaJob, MediaProject, MovieCreateInput, ProviderKind } from "../types.js";
import { JobStore } from "./job-store.js";
import { ProjectService } from "./project-service.js";
import { storyboardToSrt } from "./subtitles.js";
import { nowIso } from "./utils.js";
import { isGuardrailError, preflightPrompt } from "./preflight.js";
import { ExternalActionService } from "./external-actions.js";
import { movieWorkspace, prepareMovieWorkspace, readMovieManifest, updateMovieManifest } from "./pipeline-workspace.js";

const FLOW_URL = process.env.CEO_MEDIA_FLOW_URL || "https://flow.google.com/";
const AI_STUDIO_URL = process.env.CEO_MEDIA_AI_STUDIO_URL || "https://aistudio.google.com/";

type MovieState = {
  phase?: "anchor" | "shots" | "audio" | "compose" | "editor";
  workspaceRoot?: string;
  manifestPath?: string;
  anchorJobId?: string;
  anchorPath?: string;
  shotJobIds?: Array<string | null>;
  subtitlePath?: string;
  voiceJobId?: string;
  voicePath?: string;
  musicJobId?: string;
  musicPath?: string;
  composeJobId?: string;
  editorJobId?: string;
  rewrites?: Record<string, number>;
};

function isBrowserProvider(provider: ProviderKind): provider is "flow-web" | "ai-studio-web" {
  return provider === "flow-web" || provider === "ai-studio-web";
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((x): x is string => Boolean(x)))];
}

export class MovieOrchestrator {
  private external: ExternalActionService;
  constructor(private jobs: JobStore, private projects: ProjectService) { this.external = new ExternalActionService(jobs); }

  private async checkpoint(job: MediaJob<MovieCreateInput>, project: MediaProject, state: MovieState): Promise<void> {
    job.providerState = state as Record<string, unknown>;
    await updateMovieManifest(project, job, state as Record<string, any>);
  }

  private async waiting(job: MediaJob<MovieCreateInput>, project: MediaProject, state: MovieState, delayMs?: number): Promise<MediaJob<MovieCreateInput>> {
    job.status = "waiting";
    const waitMs = delayMs ?? Math.max(10, Number(process.env.CEO_MEDIA_MOVIE_STEP_MS || 500));
    job.nextRunAt = new Date(Date.now() + waitMs).toISOString();
    await this.checkpoint(job, project, state);
    return job;
  }

  private async completed(job: MediaJob<MovieCreateInput>, project: MediaProject, state: MovieState, output: Record<string, unknown>): Promise<MediaJob<MovieCreateInput>> {
    job.output = output;
    job.status = "completed";
    job.nextRunAt = undefined;
    job.events.push({ at: nowIso(), level: "info", message: "movie.completed" });
    await this.checkpoint(job, project, state);
    return job;
  }

  private async createAnchorJob(job: MediaJob<MovieCreateInput>, provider: ProviderKind, prompt: string, outputPath: string, referenceImages: string[]) {
    if (isBrowserProvider(provider)) {
      const url = provider === "flow-web" ? FLOW_URL : AI_STUDIO_URL;
      return this.external.create(job.projectId, {
        kind: "studio.image", provider, title: `Generate continuity anchor for ${job.input.name}`, url, prompt,
        references: referenceImages.slice(0, 3), expectedOutputPath: outputPath, projectName: job.input.name,
        instructions: [
          `Open ${provider === "flow-web" ? "Google Flow" : "Google AI Studio"} in the browser. If Google asks for sign-in, pause and let the user sign in manually; never request, store or type account credentials.`,
          "Use the supplied reference images when present, then generate one clean full-body continuity/reference image.",
          "Keep face, wardrobe/equipment, proportions and lighting clear enough to reuse in every later shot.",
          "Download the highest-quality generated image to the expected local path.",
          "Call media.external.complete with this external job id and the downloaded local file path."
        ]
      }, `${job.id}:anchor:external:v2`);
    }
    return this.jobs.create({ type: "image.generate", projectId: job.projectId, provider, idempotencyKey: `${job.id}:anchor:v2`, input: { prompt, outputPath, aspectRatio: job.input.aspectRatio, referenceImages: referenceImages.slice(0, 3) } });
  }

  private async createShotJob(job: MediaJob<MovieCreateInput>, provider: ProviderKind, shotIndex: number, prompt: string, outputPath: string, referenceImages: string[]) {
    if (isBrowserProvider(provider)) {
      const url = provider === "flow-web" ? FLOW_URL : AI_STUDIO_URL;
      return this.external.create(job.projectId, {
        kind: "studio.video", provider, title: `Generate shot ${shotIndex + 1} for ${job.input.name}`, url, prompt,
        references: referenceImages.slice(0, 3), expectedOutputPath: outputPath, projectName: job.input.name,
        metadata: { shotIndex: shotIndex + 1, durationSec: Math.min(8, job.input.totalDurationSec || 8), aspectRatio: job.input.aspectRatio, resolution: job.input.resolution },
        instructions: [
          `Open ${provider === "flow-web" ? "Google Flow" : "Google AI Studio"} in the browser. If Google asks for sign-in, pause and let the user sign in manually; never request, store or type account credentials.`,
          "Upload/use the supplied continuity anchor and reference ingredients when the UI supports them.",
          `Generate one ${job.input.aspectRatio || "16:9"} video shot, target duration up to 8 seconds, using the supplied shot prompt.`,
          "Prefer native sound/effects when available and do not burn text into the video; captions are composed later.",
          "Download the generated MP4 to the expected local path.",
          "Call media.external.complete with this external job id and the downloaded local MP4 path."
        ]
      }, `${job.id}:shot:${shotIndex + 1}:external:v2`);
    }
    return this.jobs.create({ type: "video.generate", projectId: job.projectId, provider, idempotencyKey: `${job.id}:shot:${shotIndex + 1}:v2`, input: { prompt, outputPath, aspectRatio: job.input.aspectRatio ?? "16:9", resolution: job.input.resolution ?? "1080p", durationSec: 8, referenceImages: referenceImages.slice(0, 3) } });
  }

  async advance(job: MediaJob<MovieCreateInput>): Promise<MediaJob<MovieCreateInput>> {
    const input = job.input;
    const projectId = job.projectId;
    if (!projectId) throw new Error("movie job is missing projectId");
    const project = await this.projects.get(projectId);
    if (!project.storyboard) throw new Error("movie project has no storyboard");
    const state = (job.providerState ?? {}) as MovieState;
    const imageProvider = (input.resolvedImageProvider ?? "gemini") as ProviderKind;
    const videoProvider = (input.resolvedVideoProvider ?? "gemini") as ProviderKind;
    const autoRewrite = input.autoRewriteGuardrails !== false;
    const character = project.characters[0];
    if (!character) throw new Error("movie project has no character lock");
    const ws = movieWorkspace(project);

    if (!await readMovieManifest(project)) await prepareMovieWorkspace(project, job.id, input, { imageProvider, videoProvider, finalEditor: input.finalEditor });
    state.workspaceRoot = ws.root;
    state.manifestPath = ws.manifestPath;
    if (!state.phase) state.phase = "anchor";
    state.shotJobIds ??= project.storyboard.shots.map(() => null);
    state.rewrites ??= {};

    if (state.phase === "anchor") {
      if (!state.anchorJobId) {
        const initialReferences = uniquePaths(project.characters.flatMap((c) => c.referenceImages)).slice(0, 3);
        const raw = input.anchorPrompt || `${character.description}\nWardrobe/equipment: ${character.wardrobe ?? "consistent original design"}\nCreate a clean full-body continuity anchor for: ${project.brief}`;
        const checked = preflightPrompt(raw, autoRewrite);
        const child = await this.createAnchorJob(job, imageProvider, checked.safePrompt, ws.anchorImagePath, initialReferences);
        state.anchorJobId = child.id;
        job.events.push({ at: nowIso(), level: "info", message: "movie.anchor.created", data: { jobId: child.id, provider: imageProvider, preflightRisk: checked.risk, referenceCount: initialReferences.length } });
        return this.waiting(job, project, state);
      }
      const anchor = await this.jobs.get(state.anchorJobId);
      if (anchor.status === "failed") {
        if (!isBrowserProvider(imageProvider) && autoRewrite && isGuardrailError(anchor.error || "") && (state.rewrites.anchor || 0) < 1) {
          state.rewrites.anchor = 1; state.anchorJobId = undefined;
          input.anchorPrompt = preflightPrompt(String((anchor.input as any).prompt || input.anchorPrompt || project.brief), true).safePrompt;
          job.events.push({ at: nowIso(), level: "warn", message: "movie.anchor.guardrail-rewrite" });
          return this.waiting(job, project, state, 50);
        }
        throw new Error(`anchor generation failed: ${anchor.error || anchor.status}`);
      }
      if (anchor.status !== "completed") return this.waiting(job, project, state);
      state.anchorPath = String((anchor.output as any)?.outputPath || "");
      if (!state.anchorPath) throw new Error("anchor completed without outputPath");
      character.referenceImages = uniquePaths([state.anchorPath, ...character.referenceImages]).slice(0, 3);
      const allReferences = uniquePaths(project.characters.flatMap((c) => c.referenceImages)).slice(0, 3);
      for (const shot of project.storyboard.shots) shot.referenceImages = allReferences;
      await this.projects.save(project);
      state.phase = "shots";
      job.events.push({ at: nowIso(), level: "info", message: "movie.anchor.completed", data: { outputPath: state.anchorPath, provider: imageProvider } });
    }

    if (state.phase === "shots") {
      const shots = project.storyboard.shots;
      let active = 0, completed = 0;
      for (let i = 0; i < shots.length; i++) {
        const childId = state.shotJobIds![i];
        if (!childId) continue;
        const child = await this.jobs.get(childId);
        if (child.status === "completed") { completed++; shots[i].assetPath = String((child.output as any)?.outputPath || ""); shots[i].status = "generated"; continue; }
        if (["queued", "waiting", "running"].includes(child.status)) { active++; continue; }
        if (!isBrowserProvider(videoProvider) && child.status === "failed" && autoRewrite && isGuardrailError(child.error || "") && (state.rewrites![String(i)] || 0) < 1) {
          state.rewrites![String(i)] = 1;
          const safe = preflightPrompt(String((child.input as any).prompt || shots[i].prompt), true).safePrompt;
          const replacement = await this.jobs.create({ type: "video.generate", projectId, provider: videoProvider, idempotencyKey: `${job.id}:shot:${i + 1}:rewrite:1`, input: { ...(child.input as any), prompt: safe, outputPath: ws.shotPath(i) } });
          state.shotJobIds![i] = replacement.id; active++;
          job.events.push({ at: nowIso(), level: "warn", message: "movie.shot.guardrail-rewrite", data: { shot: i + 1, jobId: replacement.id } });
          continue;
        }
        if (child.status === "failed") throw new Error(`shot ${i + 1} failed: ${child.error || child.status}`);
      }
      await this.projects.save(project);

      if (completed === shots.length) {
        state.subtitlePath = input.subtitlePath || ws.subtitlePath;
        await storyboardToSrt(project.storyboard, state.subtitlePath);
        state.phase = "audio";
        job.events.push({ at: nowIso(), level: "info", message: "movie.shots.completed", data: { shots: shots.length, subtitlePath: state.subtitlePath } });
      } else {
        const concurrency = isBrowserProvider(videoProvider) ? 1 : Math.max(1, Math.min(4, Number(input.videoConcurrency || process.env.CEO_MEDIA_MOVIE_VIDEO_CONCURRENCY || 4)));
        for (let i = 0; i < shots.length && active < concurrency; i++) {
          if (state.shotJobIds![i]) continue;
          const checked = preflightPrompt(input.shotPrompts?.[i] || shots[i].prompt, autoRewrite);
          const references = uniquePaths([...(shots[i].referenceImages || []), state.anchorPath]).slice(0, 3);
          const child = await this.createShotJob(job, videoProvider, i, checked.safePrompt, ws.shotPath(i), references);
          state.shotJobIds![i] = child.id; shots[i].status = "queued"; active++;
          job.events.push({ at: nowIso(), level: "info", message: "movie.shot.created", data: { shot: i + 1, jobId: child.id, provider: videoProvider, preflightRisk: checked.risk } });
        }
        await this.projects.save(project);
        return this.waiting(job, project, state);
      }
    }

    if (state.phase === "audio") {
      const dialogueText = project.storyboard.shots.map((s) => s.dialogue?.trim()).filter(Boolean).join("\n");
      if (input.generateVoice === true && dialogueText && !state.voiceJobId) {
        const voice = await this.jobs.create({
          type: "audio.voice", projectId, provider: input.voiceProvider,
          idempotencyKey: `${job.id}:voice:v1`,
          input: { text: dialogueText, outputPath: ws.voicePath, voice: character.voice, language: input.voiceLanguage || "th-TH", speed: input.voiceSpeed, style: input.voiceStyle }
        });
        state.voiceJobId = voice.id;
        job.events.push({ at: nowIso(), level: "info", message: "movie.voice.created", data: { jobId: voice.id } });
      }
      if (input.generateMusic === true && !state.musicJobId) {
        const music = await this.jobs.create({
          type: "audio.music", projectId, provider: input.musicProvider,
          idempotencyKey: `${job.id}:music:v1`,
          input: { prompt: input.musicPrompt || `Instrumental background score for ${project.brief}`, outputPath: ws.musicPath, durationSec: project.storyboard.totalDurationSec, mood: input.musicMood, instrumental: true }
        });
        state.musicJobId = music.id;
        job.events.push({ at: nowIso(), level: "info", message: "movie.music.created", data: { jobId: music.id } });
      }

      let audioWaiting = false;
      if (state.voiceJobId) {
        const voice = await this.jobs.get(state.voiceJobId);
        if (voice.status === "failed") throw new Error(`voice generation failed: ${voice.error || voice.status}`);
        if (voice.status === "completed") state.voicePath = String((voice.output as any)?.outputPath || ""); else audioWaiting = true;
      }
      if (state.musicJobId) {
        const music = await this.jobs.get(state.musicJobId);
        if (music.status === "failed") throw new Error(`music generation failed: ${music.error || music.status}`);
        if (music.status === "completed") state.musicPath = String((music.output as any)?.outputPath || ""); else audioWaiting = true;
      }
      if (audioWaiting) return this.waiting(job, project, state);

      if (input.compose === false) {
        return this.completed(job, project, state, {
          projectId, workspaceRoot: ws.root, manifestPath: ws.manifestPath,
          anchorPath: state.anchorPath, shotPaths: project.storyboard.shots.map((s) => s.assetPath), subtitlePath: state.subtitlePath,
          voicePath: state.voicePath, musicPath: state.musicPath, routes: { imageProvider, videoProvider }
        });
      }

      const editor = input.finalEditor === "capcut" ? "capcut" : "ffmpeg";
      const finalPath = input.outputPath || ws.finalPath;
      if (editor === "capcut") {
        const ext = await this.external.create(projectId, {
          kind: "capcut.compose", provider: "capcut", title: `Compose ${project.name} in CapCut`, expectedOutputPath: finalPath,
          projectName: project.name, clips: project.storyboard.shots.map((s) => String(s.assetPath)), subtitleFile: state.subtitlePath,
          voiceFile: state.voicePath, musicFile: state.musicPath, manifestPath: ws.manifestPath,
          instructions: [
            "Run CapCut doctor/version checks first, then use Ceo managed CapCut CLI (CapCut MCP fallback if configured). If the CLI template version is older than the installed CapCut app, use a current empty CapCut project as the template instead of forcing an incompatible draft.",
            "Create a draft/timeline with the clips in storyboard order and preserve useful native audio/effects.",
            "Import voice-over and background music assets when supplied; duck background music under dialogue.",
            "Import the Thai SRT/text captions and keep subtitle timing aligned with the shots.",
            "Apply only bounded editing requested by the project; do not auto-publish/upload.",
            "Render/export a local final MP4, then call media.external.complete with this action id and the exported path.",
            "Run FFprobe verification after export when available."
          ]
        }, `${job.id}:capcut:v2`);
        state.editorJobId = ext.id; state.phase = "editor";
        job.events.push({ at: nowIso(), level: "info", message: "movie.editor.created", data: { editor: "capcut", jobId: ext.id } });
        return this.waiting(job, project, state);
      }

      const compose = await this.jobs.create({ type: "compose", projectId, idempotencyKey: `${job.id}:compose:v3`, input: { clips: project.storyboard.shots.map((s) => String(s.assetPath)), subtitleFile: state.subtitlePath, audioFile: state.voicePath, musicFile: state.musicPath, outputPath: finalPath, transitionSec: Number(process.env.CEO_MEDIA_TRANSITION_SEC || 0.25), deliveryPlatform: project.aspectRatio === "9:16" ? "reels" : "youtube", loudnessLufs: -14, truePeakDb: -1 } });
      state.composeJobId = compose.id; state.phase = "compose";
      job.events.push({ at: nowIso(), level: "info", message: "movie.compose.created", data: { jobId: compose.id, editor: "ffmpeg" } });
      return this.waiting(job, project, state);
    }

    if (state.phase === "editor") {
      if (!state.editorJobId) throw new Error("editor phase missing editorJobId");
      const editor = await this.jobs.get(state.editorJobId);
      if (editor.status === "failed") throw new Error(`CapCut edit failed: ${editor.error || editor.status}`);
      if (editor.status !== "completed") return this.waiting(job, project, state);
      return this.completed(job, project, state, {
        projectId, workspaceRoot: ws.root, manifestPath: ws.manifestPath,
        anchorPath: state.anchorPath, shotPaths: project.storyboard.shots.map((s) => s.assetPath), subtitlePath: state.subtitlePath,
        voicePath: state.voicePath, musicPath: state.musicPath, finalPath: (editor.output as any)?.outputPath, editor: "capcut", routes: { imageProvider, videoProvider }
      });
    }

    if (state.phase === "compose") {
      if (!state.composeJobId) throw new Error("compose phase missing composeJobId");
      const compose = await this.jobs.get(state.composeJobId);
      if (compose.status === "failed") throw new Error(`compose failed: ${compose.error || compose.status}`);
      if (compose.status !== "completed") return this.waiting(job, project, state);
      return this.completed(job, project, state, {
        projectId, workspaceRoot: ws.root, manifestPath: ws.manifestPath,
        anchorPath: state.anchorPath, shotPaths: project.storyboard.shots.map((s) => s.assetPath), subtitlePath: state.subtitlePath,
        voicePath: state.voicePath, musicPath: state.musicPath, finalPath: (compose.output as any)?.outputPath, editor: "ffmpeg", routes: { imageProvider, videoProvider }
      });
    }

    throw new Error(`Unknown movie phase: ${state.phase}`);
  }
}

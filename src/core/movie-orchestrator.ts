import path from "node:path";
import type { MediaJob, MovieCreateInput, ProviderKind } from "../types.js";
import { JobStore } from "./job-store.js";
import { ProjectService } from "./project-service.js";
import { storyboardToSrt } from "./subtitles.js";
import { dataDir, nowIso, safeName } from "./utils.js";
import { isGuardrailError, preflightPrompt } from "./preflight.js";
import { ExternalActionService } from "./external-actions.js";

const FLOW_URL = process.env.CEO_MEDIA_FLOW_URL || "https://labs.google/fx/tools/flow";
const AI_STUDIO_URL = process.env.CEO_MEDIA_AI_STUDIO_URL || "https://aistudio.google.com/";

type MovieState = {
  phase?: "anchor" | "shots" | "compose" | "editor";
  anchorJobId?: string;
  anchorPath?: string;
  shotJobIds?: Array<string | null>;
  subtitlePath?: string;
  composeJobId?: string;
  editorJobId?: string;
  rewrites?: Record<string, number>;
};

function isBrowserProvider(provider: ProviderKind): provider is "flow-web" | "ai-studio-web" {
  return provider === "flow-web" || provider === "ai-studio-web";
}

export class MovieOrchestrator {
  private external: ExternalActionService;
  constructor(private jobs: JobStore, private projects: ProjectService) { this.external = new ExternalActionService(jobs); }

  private waiting(job: MediaJob<MovieCreateInput>, state: MovieState, delayMs?: number): MediaJob<MovieCreateInput> {
    job.providerState = state as Record<string, unknown>;
    job.status = "waiting";
    const waitMs = delayMs ?? Math.max(10, Number(process.env.CEO_MEDIA_MOVIE_STEP_MS || 500));
    job.nextRunAt = new Date(Date.now() + waitMs).toISOString();
    return job;
  }

  private async createAnchorJob(job: MediaJob<MovieCreateInput>, provider: ProviderKind, prompt: string, outputPath: string) {
    if (isBrowserProvider(provider)) {
      const url = provider === "flow-web" ? FLOW_URL : AI_STUDIO_URL;
      return this.external.create(job.projectId, {
        kind: "studio.image", provider, title: `Generate continuity anchor for ${job.input.name}`, url, prompt,
        references: [], expectedOutputPath: outputPath, projectName: job.input.name,
        instructions: [
          `Open ${provider === "flow-web" ? "Google Flow" : "Google AI Studio"} in the browser. If Google asks for sign-in, pause and let the user sign in manually; never request, store or type account credentials.`,
          "Generate one clean full-body continuity/reference image using the supplied prompt.",
          "Keep the face, wardrobe/equipment, proportions and lighting clear enough to reuse as a reference.",
          "Download the highest-quality generated image to a local file.",
          "Call media.external.complete with this external job id and the downloaded local file path."
        ]
      }, `${job.id}:anchor:external:v1`);
    }
    return this.jobs.create({ type: "image.generate", projectId: job.projectId, provider, idempotencyKey: `${job.id}:anchor:v1`, input: { prompt, outputPath, aspectRatio: job.input.aspectRatio, referenceImages: [] } });
  }

  private async createShotJob(job: MediaJob<MovieCreateInput>, provider: ProviderKind, shotIndex: number, prompt: string, outputPath: string, referenceImages: string[]) {
    if (isBrowserProvider(provider)) {
      const url = provider === "flow-web" ? FLOW_URL : AI_STUDIO_URL;
      return this.external.create(job.projectId, {
        kind: "studio.video", provider, title: `Generate shot ${shotIndex + 1} for ${job.input.name}`, url, prompt,
        references: referenceImages, expectedOutputPath: outputPath, projectName: job.input.name,
        metadata: { shotIndex: shotIndex + 1, durationSec: Math.min(8, job.input.totalDurationSec || 8), aspectRatio: job.input.aspectRatio, resolution: job.input.resolution },
        instructions: [
          `Open ${provider === "flow-web" ? "Google Flow" : "Google AI Studio"} in the browser. If Google asks for sign-in, pause and let the user sign in manually; never request, store or type account credentials.`,
          "Upload/use the supplied continuity anchor as the character reference/ingredient when the UI supports it.",
          `Generate one ${job.input.aspectRatio || "16:9"} video shot, target duration up to 8 seconds, using the supplied prompt.`,
          "Prefer native sound/effects when available and do not add burned text; subtitles are composed later.",
          "Download the generated MP4 to a local file.",
          "Call media.external.complete with this external job id and the downloaded local MP4 path."
        ]
      }, `${job.id}:shot:${shotIndex + 1}:external:v1`);
    }
    return this.jobs.create({ type: "video.generate", projectId: job.projectId, provider, idempotencyKey: `${job.id}:shot:${shotIndex + 1}:v1`, input: { prompt, outputPath, aspectRatio: job.input.aspectRatio ?? "16:9", resolution: job.input.resolution ?? "1080p", durationSec: 8, referenceImages } });
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

    if (!state.phase) state.phase = "anchor";
    state.shotJobIds ??= project.storyboard.shots.map(() => null);
    state.rewrites ??= {};

    if (state.phase === "anchor") {
      if (!state.anchorJobId) {
        const raw = input.anchorPrompt || `${character.description}\nWardrobe/equipment: ${character.wardrobe ?? "consistent original design"}\nCreate a clean full-body continuity anchor for: ${project.brief}`;
        const checked = preflightPrompt(raw, autoRewrite);
        const child = await this.createAnchorJob(job, imageProvider, checked.safePrompt, path.join(dataDir(), "assets", `${safeName(project.name)}-anchor-${Date.now()}.jpg`));
        state.anchorJobId = child.id;
        job.events.push({ at: nowIso(), level: "info", message: "movie.anchor.created", data: { jobId: child.id, provider: imageProvider, preflightRisk: checked.risk } });
        return this.waiting(job, state);
      }
      const anchor = await this.jobs.get(state.anchorJobId);
      if (anchor.status === "failed") {
        if (!isBrowserProvider(imageProvider) && autoRewrite && isGuardrailError(anchor.error || "") && (state.rewrites.anchor || 0) < 1) {
          state.rewrites.anchor = 1; state.anchorJobId = undefined;
          input.anchorPrompt = preflightPrompt(String((anchor.input as any).prompt || input.anchorPrompt || project.brief), true).safePrompt;
          job.events.push({ at: nowIso(), level: "warn", message: "movie.anchor.guardrail-rewrite" });
          return this.waiting(job, state, 50);
        }
        throw new Error(`anchor generation failed: ${anchor.error || anchor.status}`);
      }
      if (anchor.status !== "completed") return this.waiting(job, state);
      state.anchorPath = String((anchor.output as any)?.outputPath || "");
      if (!state.anchorPath) throw new Error("anchor completed without outputPath");
      character.referenceImages = [state.anchorPath];
      for (const shot of project.storyboard.shots) shot.referenceImages = [state.anchorPath];
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
          const replacement = await this.jobs.create({ type: "video.generate", projectId, provider: videoProvider, idempotencyKey: `${job.id}:shot:${i + 1}:rewrite:1`, input: { ...(child.input as any), prompt: safe, outputPath: path.join(dataDir(), "assets", `${safeName(project.name)}-shot-${i + 1}-retry-${Date.now()}.mp4`) } });
          state.shotJobIds![i] = replacement.id; active++;
          job.events.push({ at: nowIso(), level: "warn", message: "movie.shot.guardrail-rewrite", data: { shot: i + 1, jobId: replacement.id } });
          continue;
        }
        if (child.status === "failed") throw new Error(`shot ${i + 1} failed: ${child.error || child.status}`);
      }
      await this.projects.save(project);

      if (completed === shots.length) {
        state.subtitlePath = input.subtitlePath || path.join(dataDir(), "assets", `${safeName(project.name)}.srt`);
        await storyboardToSrt(project.storyboard, state.subtitlePath);
        if (input.compose === false) {
          job.output = { projectId, anchorPath: state.anchorPath, shotPaths: shots.map((s) => s.assetPath), subtitlePath: state.subtitlePath, routes: { imageProvider, videoProvider } };
          job.status = "completed"; job.nextRunAt = undefined; return job;
        }

        const editor = input.finalEditor === "capcut" ? "capcut" : "ffmpeg";
        const finalPath = input.outputPath || path.join(dataDir(), "renders", `${safeName(project.name)}-final.mp4`);
        if (editor === "capcut") {
          const ext = await this.external.create(projectId, {
            kind: "capcut.compose", provider: "capcut", title: `Compose ${project.name} in CapCut`, expectedOutputPath: finalPath,
            projectName: project.name, clips: shots.map((s) => String(s.assetPath)), subtitleFile: state.subtitlePath,
            instructions: [
              "Run CapCut doctor/version checks first, then use Ceo managed CapCut CLI (CapCut MCP fallback if configured). If the CLI template version is older than the installed CapCut app, use a current empty CapCut project as the template instead of forcing an incompatible draft.",
              "Create a draft/timeline with the clips in storyboard order and preserve their native audio.",
              "Import the Thai SRT/text captions and keep subtitle timing aligned with the shots.",
              "Apply only bounded editing requested by the project; do not auto-publish/upload.",
              "Render/export a local final MP4, then call media.external.complete with this action id and the exported path.",
              "Run FFprobe verification after export when available."
            ]
          }, `${job.id}:capcut:v1`);
          state.editorJobId = ext.id; state.phase = "editor";
          job.events.push({ at: nowIso(), level: "info", message: "movie.editor.created", data: { editor: "capcut", jobId: ext.id } });
          return this.waiting(job, state);
        }

        const compose = await this.jobs.create({ type: "compose", projectId, idempotencyKey: `${job.id}:compose:v1`, input: { clips: shots.map((s) => String(s.assetPath)), subtitleFile: state.subtitlePath, outputPath: finalPath } });
        state.composeJobId = compose.id; state.phase = "compose";
        job.events.push({ at: nowIso(), level: "info", message: "movie.compose.created", data: { jobId: compose.id, editor: "ffmpeg" } });
        return this.waiting(job, state);
      }

      const concurrency = isBrowserProvider(videoProvider) ? 1 : Math.max(1, Math.min(3, Number(input.videoConcurrency || process.env.CEO_MEDIA_MOVIE_VIDEO_CONCURRENCY || 1)));
      for (let i = 0; i < shots.length && active < concurrency; i++) {
        if (state.shotJobIds![i]) continue;
        const checked = preflightPrompt(input.shotPrompts?.[i] || shots[i].prompt, autoRewrite);
        const child = await this.createShotJob(job, videoProvider, i, checked.safePrompt, path.join(dataDir(), "assets", `${safeName(project.name)}-shot-${i + 1}-${Date.now()}.mp4`), state.anchorPath ? [state.anchorPath] : []);
        state.shotJobIds![i] = child.id; shots[i].status = "queued"; active++;
        job.events.push({ at: nowIso(), level: "info", message: "movie.shot.created", data: { shot: i + 1, jobId: child.id, provider: videoProvider, preflightRisk: checked.risk } });
      }
      await this.projects.save(project);
      return this.waiting(job, state);
    }

    if (state.phase === "editor") {
      if (!state.editorJobId) throw new Error("editor phase missing editorJobId");
      const editor = await this.jobs.get(state.editorJobId);
      if (editor.status === "failed") throw new Error(`CapCut edit failed: ${editor.error || editor.status}`);
      if (editor.status !== "completed") return this.waiting(job, state);
      job.output = { projectId, anchorPath: state.anchorPath, shotPaths: project.storyboard.shots.map((s) => s.assetPath), subtitlePath: state.subtitlePath, finalPath: (editor.output as any)?.outputPath, editor: "capcut", routes: { imageProvider, videoProvider } };
      job.status = "completed"; job.nextRunAt = undefined; job.events.push({ at: nowIso(), level: "info", message: "movie.completed" }); return job;
    }

    if (state.phase === "compose") {
      if (!state.composeJobId) throw new Error("compose phase missing composeJobId");
      const compose = await this.jobs.get(state.composeJobId);
      if (compose.status === "failed") throw new Error(`compose failed: ${compose.error || compose.status}`);
      if (compose.status !== "completed") return this.waiting(job, state);
      job.output = { projectId, anchorPath: state.anchorPath, shotPaths: project.storyboard.shots.map((s) => s.assetPath), subtitlePath: state.subtitlePath, finalPath: (compose.output as any)?.outputPath, editor: "ffmpeg", routes: { imageProvider, videoProvider } };
      job.status = "completed"; job.nextRunAt = undefined; job.events.push({ at: nowIso(), level: "info", message: "movie.completed" }); return job;
    }

    throw new Error(`Unknown movie phase: ${state.phase}`);
  }
}

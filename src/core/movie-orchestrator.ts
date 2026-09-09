import path from "node:path";
import type { MediaJob, MovieCreateInput, ProviderKind } from "../types.js";
import { JobStore } from "./job-store.js";
import { ProjectService } from "./project-service.js";
import { storyboardToSrt } from "./subtitles.js";
import { dataDir, nowIso, safeName } from "./utils.js";
import { isGuardrailError, preflightPrompt } from "./preflight.js";

type MovieState = {
  phase?: "anchor" | "shots" | "compose";
  anchorJobId?: string;
  anchorPath?: string;
  shotJobIds?: Array<string | null>;
  subtitlePath?: string;
  composeJobId?: string;
  rewrites?: Record<string, number>;
};

export class MovieOrchestrator {
  constructor(private jobs: JobStore, private projects: ProjectService) {}

  private waiting(job: MediaJob<MovieCreateInput>, state: MovieState, delayMs?: number): MediaJob<MovieCreateInput> {
    job.providerState = state as Record<string, unknown>;
    job.status = "waiting";
    const waitMs = delayMs ?? Math.max(10, Number(process.env.CEO_MEDIA_MOVIE_STEP_MS || 500));
    job.nextRunAt = new Date(Date.now() + waitMs).toISOString();
    return job;
  }

  async advance(job: MediaJob<MovieCreateInput>): Promise<MediaJob<MovieCreateInput>> {
    const input = job.input;
    const projectId = job.projectId;
    if (!projectId) throw new Error("movie job is missing projectId");
    const project = await this.projects.get(projectId);
    if (!project.storyboard) throw new Error("movie project has no storyboard");
    const state = (job.providerState ?? {}) as MovieState;
    const provider = (input.provider ?? "gemini") as ProviderKind;
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
        const child = await this.jobs.create({
          type: "image.generate", projectId, provider,
          idempotencyKey: `${job.id}:anchor:v1`,
          input: {
            prompt: checked.safePrompt,
            outputPath: path.join(dataDir(), "assets", `${safeName(project.name)}-anchor-${Date.now()}.jpg`),
            aspectRatio: project.aspectRatio,
            referenceImages: []
          }
        });
        state.anchorJobId = child.id;
        job.events.push({ at: nowIso(), level: "info", message: "movie.anchor.created", data: { jobId: child.id, preflightRisk: checked.risk } });
        return this.waiting(job, state);
      }
      const anchor = await this.jobs.get(state.anchorJobId);
      if (anchor.status === "failed") {
        if (autoRewrite && isGuardrailError(anchor.error || "") && (state.rewrites.anchor || 0) < 1) {
          state.rewrites.anchor = 1;
          state.anchorJobId = undefined;
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
      job.events.push({ at: nowIso(), level: "info", message: "movie.anchor.completed", data: { outputPath: state.anchorPath } });
    }

    if (state.phase === "shots") {
      const shots = project.storyboard.shots;
      let active = 0;
      let completed = 0;
      for (let i = 0; i < shots.length; i++) {
        const childId = state.shotJobIds![i];
        if (!childId) continue;
        const child = await this.jobs.get(childId);
        if (child.status === "completed") {
          completed++;
          shots[i].assetPath = String((child.output as any)?.outputPath || "");
          shots[i].status = "generated";
          continue;
        }
        if (["queued", "waiting", "running"].includes(child.status)) { active++; continue; }
        if (child.status === "failed" && autoRewrite && isGuardrailError(child.error || "") && (state.rewrites![String(i)] || 0) < 1) {
          state.rewrites![String(i)] = 1;
          const safe = preflightPrompt(String((child.input as any).prompt || shots[i].prompt), true).safePrompt;
          const replacement = await this.jobs.create({
            type: "video.generate", projectId, provider,
            idempotencyKey: `${job.id}:shot:${i + 1}:rewrite:1`,
            input: { ...(child.input as any), prompt: safe, outputPath: path.join(dataDir(), "assets", `${safeName(project.name)}-shot-${i + 1}-retry-${Date.now()}.mp4`) }
          });
          state.shotJobIds![i] = replacement.id;
          active++;
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
          job.output = { projectId, anchorPath: state.anchorPath, shotPaths: shots.map((s) => s.assetPath), subtitlePath: state.subtitlePath };
          job.status = "completed";
          job.nextRunAt = undefined;
          return job;
        }
        const compose = await this.jobs.create({
          type: "compose", projectId,
          idempotencyKey: `${job.id}:compose:v1`,
          input: {
            clips: shots.map((s) => String(s.assetPath)),
            subtitleFile: state.subtitlePath,
            outputPath: input.outputPath || path.join(dataDir(), "renders", `${safeName(project.name)}-final.mp4`)
          }
        });
        state.composeJobId = compose.id;
        state.phase = "compose";
        job.events.push({ at: nowIso(), level: "info", message: "movie.compose.created", data: { jobId: compose.id } });
        return this.waiting(job, state);
      }

      const concurrency = Math.max(1, Math.min(3, Number(input.videoConcurrency || process.env.CEO_MEDIA_MOVIE_VIDEO_CONCURRENCY || 1)));
      for (let i = 0; i < shots.length && active < concurrency; i++) {
        if (state.shotJobIds![i]) continue;
        const checked = preflightPrompt(input.shotPrompts?.[i] || shots[i].prompt, autoRewrite);
        const child = await this.jobs.create({
          type: "video.generate", projectId, provider,
          idempotencyKey: `${job.id}:shot:${i + 1}:v1`,
          input: {
            prompt: checked.safePrompt,
            outputPath: path.join(dataDir(), "assets", `${safeName(project.name)}-shot-${i + 1}-${Date.now()}.mp4`),
            aspectRatio: project.aspectRatio,
            resolution: project.resolution,
            durationSec: Math.min(8, shots[i].durationSec),
            referenceImages: state.anchorPath ? [state.anchorPath] : []
          }
        });
        state.shotJobIds![i] = child.id;
        shots[i].status = "queued";
        active++;
        job.events.push({ at: nowIso(), level: "info", message: "movie.shot.created", data: { shot: i + 1, jobId: child.id, preflightRisk: checked.risk } });
      }
      await this.projects.save(project);
      return this.waiting(job, state);
    }

    if (state.phase === "compose") {
      if (!state.composeJobId) throw new Error("compose phase missing composeJobId");
      const compose = await this.jobs.get(state.composeJobId);
      if (compose.status === "failed") throw new Error(`compose failed: ${compose.error || compose.status}`);
      if (compose.status !== "completed") return this.waiting(job, state);
      job.output = {
        projectId,
        anchorPath: state.anchorPath,
        shotPaths: project.storyboard.shots.map((s) => s.assetPath),
        subtitlePath: state.subtitlePath,
        finalPath: (compose.output as any)?.outputPath
      };
      job.status = "completed";
      job.nextRunAt = undefined;
      job.events.push({ at: nowIso(), level: "info", message: "movie.completed" });
      return job;
    }

    throw new Error(`Unknown movie phase: ${state.phase}`);
  }
}

import type { MediaJob, MovieCreateInput, MusicRequest, VideoRequest, VoiceRequest } from "../types.js";
import { JobStore } from "./job-store.js";
import { ProviderRouter } from "../providers/router.js";
import { ProviderError } from "../providers/provider.js";
import { setProviderCooldown } from "../providers/quota-manager.js";
import { composeVideos } from "./composer.js";
import { nowIso } from "./utils.js";
import { ProjectService } from "./project-service.js";
import { MovieOrchestrator } from "./movie-orchestrator.js";
import { AssetRegistry } from "./asset-registry.js";

export class JobRunner {
  private movie: MovieOrchestrator;
  private assets = new AssetRegistry();
  private inFlight = new Map<string, Promise<MediaJob>>();
  constructor(private store = new JobStore(), private router = new ProviderRouter(), private projects = new ProjectService()) {
    this.movie = new MovieOrchestrator(this.store, this.projects);
  }
  private retryDelay(attempts: number) { return Math.min(60_000, 1000 * Math.pow(2, Math.max(0, attempts - 1))); }
  private async runOnceInner(jobId: string): Promise<MediaJob> {
    let job = await this.store.get(jobId);
    if (["completed", "cancelled", "failed"].includes(job.status)) return job;
    if (Date.now() - new Date(job.createdAt).getTime() > job.timeoutMs) {
      job.status = "failed"; job.error = "job timeout exceeded";
      job.events.push({ at: nowIso(), level: "error", message: "job.timeout" });
      return await this.store.save(job);
    }

    const wasStaleRunning = job.status === "running";
    const isProviderPoll = job.type === "video.generate" && Boolean(job.providerState?.operationId);
    const isMoviePoll = job.type === "movie.create" && Boolean(job.providerState?.phase);
    job.status = "running";
    if (!isProviderPoll && !isMoviePoll) job.attempts += 1;
    if (wasStaleRunning) job.events.push({ at: nowIso(), level: "warn", message: "job.stale-running-recovered" });
    job.events.push({ at: nowIso(), level: "info", message: isProviderPoll ? "video.poll" : isMoviePoll ? "movie.poll" : "job.run", data: { attempt: job.attempts } });
    await this.store.save(job);

    try {
      if (job.type === "image.generate") {
        const provider = await this.router.route("image", job.provider);
        if (!provider.generateImage) throw new Error(`${provider.id} does not support image generation`);
        job.output = await provider.generateImage(job.input as any); job.provider = provider.id; job.status = "completed";
      } else if (job.type === "audio.voice") {
        const provider = await this.router.route("voice", job.provider);
        if (!provider.generateVoice) throw new Error(`${provider.id} does not support voice generation`);
        job.output = await provider.generateVoice(job.input as unknown as VoiceRequest); job.provider = provider.id; job.status = "completed";
      } else if (job.type === "audio.music") {
        const provider = await this.router.route("music", job.provider);
        if (!provider.generateMusic) throw new Error(`${provider.id} does not support music generation`);
        job.output = await provider.generateMusic(job.input as unknown as MusicRequest); job.provider = provider.id; job.status = "completed";
      } else if (job.type === "video.generate") {
        const input = job.input as unknown as VideoRequest;
        const provider = await this.router.route("video", job.provider);
        if (!provider.startVideo || !provider.pollVideo || !provider.downloadVideo) throw new Error(`${provider.id} does not support durable video generation`);
        const operationId = String(job.providerState?.operationId || "");
        if (!operationId) {
          const started = await provider.startVideo(input);
          job.providerState = { operationId: started.operationId, provider: provider.id, pollErrors: 0 };
          job.provider = provider.id; job.status = "waiting";
          job.nextRunAt = new Date(Date.now() + Number(process.env.CEO_MEDIA_POLL_MS || 10_000)).toISOString();
          job.events.push({ at: nowIso(), level: "info", message: "video.operation.started", data: { operationId: started.operationId } });
        } else {
          const polled = await provider.pollVideo(operationId);
          if (!polled.done) {
            job.status = "waiting";
            const pollDelay = Math.max(1000, Number(polled.retryAfterMs || process.env.CEO_MEDIA_POLL_MS || 10_000));
            job.nextRunAt = new Date(Date.now() + pollDelay).toISOString();
            if (polled.errorCode) job.events.push({ at: nowIso(), level: "warn", message: "video.poll.waiting", data: { code: polled.errorCode, retryAfterMs: pollDelay } });
          } else if (polled.error) {
            throw new ProviderError(polled.error, { retryable: polled.retryable ?? false, retryAfterMs: polled.retryAfterMs, code: polled.errorCode });
          } else {
            job.output = await provider.downloadVideo(String(polled.downloadUri), input.outputPath);
            job.status = "completed"; job.nextRunAt = undefined;
          }
        }
      } else if (job.type === "compose") {
        job.output = await composeVideos(job.input as any); job.status = "completed";
      } else if (job.type === "movie.create") {
        const movieJob = await this.movie.advance(job as unknown as MediaJob<MovieCreateInput>);
        job = movieJob as unknown as MediaJob;
      } else throw new Error(`Unknown job type: ${job.type}`);

      job.error = undefined;
      if (job.status === "completed") {
        const outputPath = String((job.output as any)?.outputPath || (job.output as any)?.finalPath || "");
        if (outputPath) {
          const asset = await this.assets.register(outputPath, { projectId: job.projectId, jobId: job.id, source: job.type, provenance: { provider: job.provider } });
          job.output = { ...(job.output || {}), assetId: asset.id, sha256: asset.sha256 };
        }
      }
      job.events.push({ at: nowIso(), level: "info", message: `job.${job.status}` });
      return await this.store.save(job);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const providerError = error instanceof ProviderError ? error : undefined;
      if (providerError?.code === "RATE_LIMIT" && job.provider) setProviderCooldown(job.provider, providerError.retryAfterMs || this.retryDelay(Math.max(1, job.attempts)), message);
      job.error = message;
      job.events.push({ at: nowIso(), level: "error", message: "job.error", data: { message, code: providerError?.code, retryAfterMs: providerError?.retryAfterMs } });

      if (isProviderPoll) {
        const state = { ...(job.providerState || {}) } as Record<string, any>;
        state.pollErrors = Number(state.pollErrors || 0) + 1;
        job.providerState = state;
        const maxPollErrors = Math.max(1, Number(process.env.CEO_MEDIA_MAX_POLL_ERRORS || 8));
        if (state.pollErrors >= maxPollErrors) {
          job.status = "failed";
          return await this.store.save(job);
        }
      }

      if (providerError && !providerError.retryable) job.status = "failed";
      else if (job.attempts >= job.maxAttempts && !isProviderPoll && !isMoviePoll) job.status = "failed";
      else {
        if (/operation not found/i.test(message)) job.providerState = undefined;
        job.status = "waiting";
        const retryMs = Math.max(this.retryDelay(Math.max(1, job.attempts)), providerError?.retryAfterMs || 0);
        job.nextRunAt = new Date(Date.now() + retryMs).toISOString();
      }
      return await this.store.save(job);
    }
  }
  async runOnce(jobId: string): Promise<MediaJob> {
    const existing = this.inFlight.get(jobId);
    if (existing) return existing;
    const task = this.runOnceInner(jobId).finally(() => { if (this.inFlight.get(jobId) === task) this.inFlight.delete(jobId); });
    this.inFlight.set(jobId, task);
    return task;
  }

  async tick(limit = 20): Promise<MediaJob[]> {
    const due = await this.store.due(limit);
    const results: MediaJob[] = [];
    const concurrency = Math.max(1, Math.min(4, Number(process.env.CEO_MEDIA_WORKER_CONCURRENCY || 4)));
    for (let offset = 0; offset < due.length; offset += concurrency) {
      const wave = due.slice(offset, offset + concurrency);
      results.push(...await Promise.all(wave.map((job) => this.runOnce(job.id))));
    }
    return results;
  }
}

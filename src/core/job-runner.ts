import type { MediaJob, MusicRequest, VideoRequest, VoiceRequest } from "../types.js";
import { JobStore } from "./job-store.js";
import { ProviderRouter } from "../providers/router.js";
import { composeVideos } from "./composer.js";
import { nowIso } from "./utils.js";

export class JobRunner {
  constructor(private store = new JobStore(), private router = new ProviderRouter()) {}
  private retryDelay(attempts: number) { return Math.min(60_000, 1000 * Math.pow(2, Math.max(0, attempts - 1))); }
  async runOnce(jobId: string): Promise<MediaJob> {
    let job = await this.store.get(jobId); if (["completed", "cancelled", "failed"].includes(job.status)) return job;
    if (Date.now() - new Date(job.createdAt).getTime() > job.timeoutMs) { job.status = "failed"; job.error = "job timeout exceeded"; job.events.push({ at: nowIso(), level: "error", message: "job.timeout" }); return this.store.save(job); }
    const isProviderPoll = job.type === "video.generate" && Boolean(job.providerState?.operationId);
    job.status = "running";
    if (!isProviderPoll) job.attempts += 1;
    job.events.push({ at: nowIso(), level: "info", message: isProviderPoll ? "video.poll" : "job.run", data: { attempt: job.attempts } });
    await this.store.save(job);
    try {
      if (job.type === "image.generate") {
        const provider = await this.router.route("image", job.provider); if (!provider.generateImage) throw new Error(`${provider.id} does not support image generation`); job.output = await provider.generateImage(job.input as any); job.provider = provider.id; job.status = "completed";
      } else if (job.type === "audio.voice") {
        const provider = await this.router.route("voice", job.provider); if (!provider.generateVoice) throw new Error(`${provider.id} does not support voice generation`); job.output = await provider.generateVoice(job.input as unknown as VoiceRequest); job.provider = provider.id; job.status = "completed";
      } else if (job.type === "audio.music") {
        const provider = await this.router.route("music", job.provider); if (!provider.generateMusic) throw new Error(`${provider.id} does not support music generation`); job.output = await provider.generateMusic(job.input as unknown as MusicRequest); job.provider = provider.id; job.status = "completed";
      } else if (job.type === "video.generate") {
        const input = job.input as unknown as VideoRequest; const provider = await this.router.route("video", job.provider);
        if (!provider.startVideo || !provider.pollVideo || !provider.downloadVideo) throw new Error(`${provider.id} does not support durable video generation`);
        const operationId = String(job.providerState?.operationId || "");
        if (!operationId) { const started = await provider.startVideo(input); job.providerState = { operationId: started.operationId, provider: provider.id }; job.provider = provider.id; job.status = "waiting"; job.nextRunAt = new Date(Date.now() + Number(process.env.CEO_MEDIA_POLL_MS || 10_000)).toISOString(); job.events.push({ at: nowIso(), level: "info", message: "video.operation.started", data: { operationId: started.operationId } }); }
        else { const polled = await provider.pollVideo(operationId); if (!polled.done) { job.status = "waiting"; job.nextRunAt = new Date(Date.now() + Number(process.env.CEO_MEDIA_POLL_MS || 10_000)).toISOString(); } else if (polled.error) throw new Error(polled.error); else { job.output = await provider.downloadVideo(String(polled.downloadUri), input.outputPath); job.status = "completed"; job.nextRunAt = undefined; } }
      } else if (job.type === "compose") { job.output = await composeVideos(job.input as any); job.status = "completed"; }
      else throw new Error(`Unknown job type: ${job.type}`);
      job.error = undefined; job.events.push({ at: nowIso(), level: "info", message: `job.${job.status}` }); return this.store.save(job);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error); job.error = message; job.events.push({ at: nowIso(), level: "error", message: "job.error", data: { message } });
      if (job.attempts >= job.maxAttempts) job.status = "failed"; else { if (/operation not found/i.test(message)) job.providerState = undefined; job.status = "waiting"; job.nextRunAt = new Date(Date.now() + this.retryDelay(job.attempts)).toISOString(); }
      return this.store.save(job);
    }
  }
  async tick(limit = 20): Promise<MediaJob[]> { const due = await this.store.due(limit); const results: MediaJob[] = []; for (const job of due) results.push(await this.runOnce(job.id)); return results; }
}

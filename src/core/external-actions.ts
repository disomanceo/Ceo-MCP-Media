import { access } from "node:fs/promises";
import type { MediaJob } from "../types.js";
import { AssetRegistry } from "./asset-registry.js";
import { JobStore } from "./job-store.js";
import { nowIso } from "./utils.js";

export type ExternalActionKind = "studio.image" | "studio.video" | "capcut.compose";

export interface ExternalActionInput {
  [key: string]: unknown;
  kind: ExternalActionKind;
  provider: "flow-web" | "ai-studio-web" | "capcut";
  title: string;
  instructions: string[];
  url?: string;
  prompt?: string;
  references?: string[];
  expectedOutputPath: string;
  clips?: string[];
  subtitleFile?: string;
  voiceFile?: string;
  musicFile?: string;
  manifestPath?: string;
  projectName?: string;
  metadata?: Record<string, unknown>;
}

export class ExternalActionService {
  private assets = new AssetRegistry();
  constructor(private jobs: JobStore) {}

  async create(projectId: string | undefined, input: ExternalActionInput, idempotencyKey: string): Promise<MediaJob<ExternalActionInput>> {
    const job = await this.jobs.create({ type: "external.action", projectId, idempotencyKey, input });
    if (job.status !== "queued") return job;
    job.status = "waiting";
    job.nextRunAt = undefined;
    job.providerState = { external: true, kind: input.kind, provider: input.provider };
    job.events.push({ at: nowIso(), level: "info", message: "external.action.waiting", data: { kind: input.kind, provider: input.provider } });
    await this.jobs.save(job);
    return job;
  }

  async pending(projectId?: string): Promise<MediaJob<ExternalActionInput>[]> {
    return (await this.jobs.list())
      .filter((job) => job.type === "external.action" && job.status === "waiting" && (!projectId || job.projectId === projectId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) as MediaJob<ExternalActionInput>[];
  }

  async next(projectId?: string): Promise<MediaJob<ExternalActionInput> | null> {
    return (await this.pending(projectId))[0] ?? null;
  }

  async complete(jobId: string, outputPath: string, metadata?: Record<string, unknown>): Promise<MediaJob<ExternalActionInput>> {
    const job = await this.jobs.get<ExternalActionInput>(jobId);
    if (job.type !== "external.action") throw new Error("job is not an external action");
    if (job.status === "completed") return job;
    await access(outputPath);
    const asset = await this.assets.register(outputPath, {
      projectId: job.projectId,
      jobId: job.id,
      source: job.input.kind,
      provenance: { provider: job.input.provider, ...(metadata ?? {}) }
    });
    job.output = { outputPath, assetId: asset.id, sha256: asset.sha256, ...(metadata ? { metadata } : {}) };
    job.status = "completed";
    job.error = undefined;
    job.nextRunAt = undefined;
    job.events.push({ at: nowIso(), level: "info", message: "external.action.completed", data: { outputPath, assetId: asset.id } });
    return this.jobs.save(job);
  }

  async fail(jobId: string, error: string, retryable = false): Promise<MediaJob<ExternalActionInput>> {
    const job = await this.jobs.get<ExternalActionInput>(jobId);
    if (job.type !== "external.action") throw new Error("job is not an external action");
    job.error = String(error || "external action failed").slice(0, 4000);
    job.status = retryable ? "waiting" : "failed";
    job.events.push({ at: nowIso(), level: retryable ? "warn" : "error", message: retryable ? "external.action.retry" : "external.action.failed", data: { error: job.error } });
    return this.jobs.save(job);
  }
}

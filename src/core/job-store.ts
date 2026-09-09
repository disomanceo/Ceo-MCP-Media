import path from "node:path";
import { readdir } from "node:fs/promises";
import type { MediaJob } from "../types.js";
import { dataDir, newId, nowIso, readJson, sha256, writeJsonAtomic } from "./utils.js";

export class JobStore {
  private file(id: string) { return path.join(dataDir(), "jobs", `${id}.json`); }
  async create<T extends Record<string, unknown>>(input: { type: string; input: T; projectId?: string; provider?: "mock" | "gemini" | "flow"; idempotencyKey?: string; maxAttempts?: number; timeoutMs?: number; }): Promise<MediaJob<T>> {
    if (input.idempotencyKey) { const existing = await this.findByIdempotency(input.idempotencyKey); if (existing) return existing as MediaJob<T>; }
    const now = nowIso();
    const job: MediaJob<T> = { id: newId("job"), projectId: input.projectId, type: input.type, status: "queued", input: input.input, provider: input.provider, idempotencyKey: input.idempotencyKey, attempts: 0, maxAttempts: input.maxAttempts ?? Number(process.env.CEO_MEDIA_MAX_ATTEMPTS || 4), timeoutMs: input.timeoutMs ?? Number(process.env.CEO_MEDIA_JOB_TIMEOUT_MS || 1_800_000), createdAt: now, updatedAt: now, events: [{ at: now, level: "info", message: "job.created" }] };
    await this.save(job); return job;
  }
  async get<T = Record<string, unknown>>(id: string): Promise<MediaJob<T>> { const j = await readJson<MediaJob<T>>(this.file(id)); if (!j) throw new Error(`Job not found: ${id}`); return j; }
  async save<T>(job: MediaJob<T>): Promise<MediaJob<T>> { job.updatedAt = nowIso(); await writeJsonAtomic(this.file(job.id), job); return job; }
  async cancel(id: string): Promise<MediaJob> { const j = await this.get(id); if (["completed", "failed"].includes(j.status)) return j; j.status = "cancelled"; j.cancelledAt = nowIso(); j.events.push({ at: nowIso(), level: "warn", message: "job.cancelled" }); return this.save(j); }
  async list(): Promise<MediaJob[]> { const dir = path.join(dataDir(), "jobs"); try { const names = (await readdir(dir)).filter((x) => x.endsWith(".json")); const jobs = await Promise.all(names.map((n) => readJson<MediaJob>(path.join(dir, n)))); return jobs.filter((x): x is MediaJob => Boolean(x)); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }
  async findByIdempotency(key: string): Promise<MediaJob | null> { const digest = sha256(key); return (await this.list()).find((j) => j.idempotencyKey && sha256(j.idempotencyKey) === digest) ?? null; }
  async due(limit = 20): Promise<MediaJob[]> { const now = Date.now(); const leaseMs = Math.max(10_000, Number(process.env.CEO_MEDIA_RUNNING_LEASE_MS || 120_000)); return (await this.list()).filter((j) => { if (["queued", "waiting"].includes(j.status)) return !j.nextRunAt || new Date(j.nextRunAt).getTime() <= now; if (j.status === "running") return new Date(j.updatedAt).getTime() + leaseMs <= now; return false; }).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit); }
}

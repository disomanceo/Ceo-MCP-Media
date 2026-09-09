import path from "node:path";
import { readdir } from "node:fs/promises";
import type { MediaJob, ProviderKind } from "../types.js";
import { dataDir, newId, nowIso, readJson, sha256, writeJsonAtomic } from "./utils.js";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

export function mediaRequestHash(value: unknown): string { return sha256(canonical(value)); }

export class IdempotencyConflictError extends Error {
  code = "IDEMPOTENCY_CONFLICT";
  constructor(key: string) { super(`Idempotency key conflict: ${key} was already used for a different request`); this.name = "IdempotencyConflictError"; }
}

export class JobStore {
  private file(id: string) { return path.join(dataDir(), "jobs", `${id}.json`); }
  private fingerprint(input: { type: string; input: Record<string, unknown>; projectId?: string; provider?: ProviderKind }): string {
    return mediaRequestHash({ type: input.type, projectId: input.projectId ?? null, provider: input.provider ?? null, input: input.input });
  }

  async create<T extends Record<string, unknown>>(input: { type: string; input: T; projectId?: string; provider?: ProviderKind; idempotencyKey?: string; maxAttempts?: number; timeoutMs?: number; requestHash?: string; }): Promise<MediaJob<T>> {
    const requestHash = input.requestHash ?? this.fingerprint(input);
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotency(input.idempotencyKey);
      if (existing) {
        const existingHash = existing.requestHash ?? this.fingerprint({ type: existing.type, projectId: existing.projectId, provider: existing.provider, input: existing.input as Record<string, unknown> });
        if (existingHash !== requestHash) throw new IdempotencyConflictError(input.idempotencyKey);
        return existing as MediaJob<T>;
      }
    }
    const now = nowIso();
    const job: MediaJob<T> = { id: newId("job"), projectId: input.projectId, type: input.type, status: "queued", input: input.input, provider: input.provider, idempotencyKey: input.idempotencyKey, requestHash, attempts: 0, maxAttempts: input.maxAttempts ?? Number(process.env.CEO_MEDIA_MAX_ATTEMPTS || 4), timeoutMs: input.timeoutMs ?? Number(process.env.CEO_MEDIA_JOB_TIMEOUT_MS || 1_800_000), createdAt: now, updatedAt: now, events: [{ at: now, level: "info", message: "job.created" }] };
    await this.save(job); return job;
  }
  async get<T = Record<string, unknown>>(id: string): Promise<MediaJob<T>> { const j = await readJson<MediaJob<T>>(this.file(id)); if (!j) throw new Error(`Job not found: ${id}`); return j; }
  async save<T>(job: MediaJob<T>): Promise<MediaJob<T>> { job.updatedAt = nowIso(); await writeJsonAtomic(this.file(job.id), job); return job; }
  async cancel(id: string): Promise<MediaJob> { const j = await this.get(id); if (["completed", "failed"].includes(j.status)) return j; j.status = "cancelled"; j.cancelledAt = nowIso(); j.events.push({ at: nowIso(), level: "warn", message: "job.cancelled" }); return this.save(j); }
  async list(): Promise<MediaJob[]> { const dir = path.join(dataDir(), "jobs"); try { const names = (await readdir(dir)).filter((x) => x.endsWith(".json")); const jobs = await Promise.all(names.map((n) => readJson<MediaJob>(path.join(dir, n)))); return jobs.filter((x): x is MediaJob => Boolean(x)); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }
  async findByIdempotency(key: string): Promise<MediaJob | null> { const digest = sha256(key); return (await this.list()).find((j) => j.idempotencyKey && sha256(j.idempotencyKey) === digest) ?? null; }
  async due(limit = 20): Promise<MediaJob[]> { const now = Date.now(); const leaseMs = Math.max(10_000, Number(process.env.CEO_MEDIA_RUNNING_LEASE_MS || 120_000)); return (await this.list()).filter((j) => { if (j.type === "external.action") return false; if (["queued", "waiting"].includes(j.status)) return !j.nextRunAt || new Date(j.nextRunAt).getTime() <= now; if (j.status === "running") return new Date(j.updatedAt).getTime() + leaseMs <= now; return false; }).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit); }
}

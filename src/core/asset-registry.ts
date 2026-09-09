import { createHash } from "node:crypto";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { dataDir, nowIso, readJson, writeJsonAtomic } from "./utils.js";

export type AssetKind = "image" | "video" | "audio" | "subtitle" | "document" | "other";

export interface AssetRecord {
  id: string;
  sha256: string;
  size: number;
  kind: AssetKind;
  path: string;
  projectId?: string;
  jobId?: string;
  source?: string;
  provenance?: Record<string, unknown>;
  createdAt: string;
  lastSeenAt: string;
}

function registryDir(): string { return path.join(dataDir(), "assets", ".registry"); }
function recordFile(id: string): string { return path.join(registryDir(), `${id}.json`); }

function inferKind(file: string): AssetKind {
  const ext = path.extname(file).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) return "image";
  if ([".mp4", ".mov", ".mkv", ".webm", ".avi"].includes(ext)) return "video";
  if ([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"].includes(ext)) return "audio";
  if ([".srt", ".ass", ".vtt"].includes(ext)) return "subtitle";
  if ([".json", ".md", ".txt", ".pdf"].includes(ext)) return "document";
  return "other";
}

export class AssetRegistry {
  async register(filePath: string, metadata: {
    kind?: AssetKind;
    projectId?: string;
    jobId?: string;
    source?: string;
    provenance?: Record<string, unknown>;
  } = {}): Promise<AssetRecord> {
    const resolved = path.resolve(filePath);
    const bytes = await readFile(resolved);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const id = `asset-${digest.slice(0, 32)}`;
    const existing = await readJson<AssetRecord>(recordFile(id));
    const now = nowIso();
    const record: AssetRecord = {
      id,
      sha256: digest,
      size: bytes.byteLength,
      kind: metadata.kind ?? existing?.kind ?? inferKind(resolved),
      path: resolved,
      projectId: metadata.projectId ?? existing?.projectId,
      jobId: metadata.jobId ?? existing?.jobId,
      source: metadata.source ?? existing?.source,
      provenance: { ...(existing?.provenance ?? {}), ...(metadata.provenance ?? {}) },
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now
    };
    await writeJsonAtomic(recordFile(id), record);
    return record;
  }

  async get(id: string): Promise<AssetRecord> {
    const record = await readJson<AssetRecord>(recordFile(id));
    if (!record) throw new Error(`Asset not found: ${id}`);
    return record;
  }

  async findByHash(sha256: string): Promise<AssetRecord | null> {
    const id = `asset-${String(sha256).toLowerCase().slice(0, 32)}`;
    const record = await readJson<AssetRecord>(recordFile(id));
    return record?.sha256.toLowerCase() === String(sha256).toLowerCase() ? record : null;
  }

  async list(projectId?: string): Promise<AssetRecord[]> {
    try {
      const names = (await readdir(registryDir())).filter((name) => name.endsWith(".json"));
      const records = await Promise.all(names.map((name) => readJson<AssetRecord>(path.join(registryDir(), name))));
      return records
        .filter((record): record is AssetRecord => Boolean(record) && (!projectId || record!.projectId === projectId))
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}

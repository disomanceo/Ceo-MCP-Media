import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const nowIso = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}-${randomUUID()}`;
export function dataDir(): string { return path.resolve(process.env.CEO_MEDIA_DATA_DIR || "./data"); }
export async function ensureDir(dir: string): Promise<void> { await mkdir(dir, { recursive: true }); }
export async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; }
  catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await rename(temp, file);
}
export function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export function safeName(value: string): string { return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "media"; }

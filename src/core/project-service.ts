import path from "node:path";
import { readdir } from "node:fs/promises";
import type { AspectRatio, CharacterBible, MediaProject, Resolution, Storyboard } from "../types.js";
import { dataDir, newId, nowIso, readJson, writeJsonAtomic } from "./utils.js";

export class ProjectService {
  private projectFile(id: string) { return path.join(dataDir(), "projects", `${id}.json`); }
  async create(input: { name: string; brief: string; aspectRatio?: AspectRatio; resolution?: Resolution; fps?: number; }): Promise<MediaProject> {
    const now = nowIso();
    const project: MediaProject = { id: newId("project"), name: input.name, brief: input.brief, aspectRatio: input.aspectRatio ?? "16:9", resolution: input.resolution ?? "1080p", fps: input.fps ?? 24, characters: [], createdAt: now, updatedAt: now };
    await this.save(project); return project;
  }
  async get(id: string): Promise<MediaProject> { const p = await readJson<MediaProject>(this.projectFile(id)); if (!p) throw new Error(`Project not found: ${id}`); return p; }
  async save(project: MediaProject): Promise<MediaProject> { project.updatedAt = nowIso(); await writeJsonAtomic(this.projectFile(project.id), project); return project; }
  async list(): Promise<MediaProject[]> {
    const dir = path.join(dataDir(), "projects");
    try { const files = (await readdir(dir)).filter((f) => f.endsWith(".json")); const items = await Promise.all(files.map((f) => readJson<MediaProject>(path.join(dir, f)))); return items.filter((x): x is MediaProject => Boolean(x)); }
    catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  async addCharacter(projectId: string, input: Omit<CharacterBible, "id">): Promise<CharacterBible> { const p = await this.get(projectId); const c: CharacterBible = { id: newId("character"), ...input }; p.characters.push(c); await this.save(p); return c; }
  async setStoryboard(projectId: string, storyboard: Storyboard): Promise<MediaProject> { const p = await this.get(projectId); p.storyboard = storyboard; return this.save(p); }
}

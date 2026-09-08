import type { AspectRatio, CharacterBible, Shot, Storyboard } from "../types.js";
import { newId, nowIso } from "./utils.js";

function sentences(text: string): string[] { return text.split(/(?<=[.!?。！？])\s+|\n+/).map((s) => s.trim()).filter(Boolean); }
export function planStoryboard(input: { projectId: string; title: string; brief: string; totalDurationSec: number; aspectRatio?: AspectRatio; maxShotSec?: number; characters?: CharacterBible[]; }): Storyboard {
  const maxShot = Math.min(8, Math.max(2, input.maxShotSec ?? 8));
  const shotCount = Math.max(1, Math.ceil(input.totalDurationSec / maxShot));
  const parts = sentences(input.brief); const chars = input.characters ?? []; const shots: Shot[] = []; let remaining = input.totalDurationSec;
  for (let i = 0; i < shotCount; i++) {
    const durationSec = Math.min(maxShot, remaining); remaining -= durationSec;
    const beat = parts[i % Math.max(1, parts.length)] || input.brief;
    shots.push({ id: newId("shot"), index: i + 1, durationSec, title: `Shot ${i + 1}`, prompt: `${beat}\nMaintain character identity, wardrobe, lighting logic and visual continuity with previous shots. Cinematic composition. Shot ${i + 1}/${shotCount}.`, camera: i === 0 ? "establishing shot, gentle push-in" : "cinematic medium shot, motivated camera movement", characters: chars.map((c) => c.id), referenceImages: chars.flatMap((c) => c.referenceImages).slice(0, 3), continuityTags: [...new Set(chars.flatMap((c) => c.continuityTags))], status: "planned" });
  }
  return { id: newId("storyboard"), projectId: input.projectId, title: input.title, totalDurationSec: input.totalDurationSec, aspectRatio: input.aspectRatio ?? "16:9", shots, createdAt: nowIso() };
}

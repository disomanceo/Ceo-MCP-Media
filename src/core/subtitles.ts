import path from "node:path";
import { writeFile } from "node:fs/promises";
import type { Storyboard } from "../types.js";
import { ensureDir } from "./utils.js";
function stamp(sec: number) { const ms = Math.round(sec * 1000); const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000); const s = Math.floor((ms % 60000) / 1000); const milli = ms % 1000; return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(milli).padStart(3,"0")}`; }
export async function storyboardToSrt(storyboard: Storyboard, outputPath: string) {
  let cursor = 0; const blocks: string[] = [];
  for (const shot of storyboard.shots) { const text = shot.dialogue?.trim(); const start = cursor; const end = cursor + shot.durationSec; cursor = end; if (!text) continue; blocks.push(`${blocks.length + 1}\n${stamp(start)} --> ${stamp(end)}\n${text}\n`); }
  await ensureDir(path.dirname(outputPath)); await writeFile(outputPath, blocks.join("\n"), "utf8"); return { outputPath, cues: blocks.length };
}

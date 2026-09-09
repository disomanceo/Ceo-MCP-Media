import fs from "node:fs";
import path from "node:path";

function resolveManaged(binary: "ffmpeg" | "ffprobe", explicit?: string): string {
  const configured = String(explicit || "").trim();
  if (configured) return configured;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const candidate = path.join(process.env.LOCALAPPDATA, "Ceo", "addons", "media-tools", "bin", `${binary}.exe`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return binary;
}

export function resolveFfmpeg(): string { return resolveManaged("ffmpeg", process.env.FFMPEG_PATH); }
export function resolveFfprobe(): string { return resolveManaged("ffprobe", process.env.FFPROBE_PATH); }

import path from "node:path";
import { spawn } from "node:child_process";
import type { Shot } from "../types.js";
import { ensureDir } from "./utils.js";
import { resolveFfmpeg } from "./media-tools.js";

export const TEMPORAL_CONTINUITY_RULE = [
  "MANDATORY TEMPORAL CONTINUITY — do not reset or re-stage the shot.",
  "Preserve exact character identity, facial features, hairstyle, wardrobe, body proportions, pose logic, body direction, eye line, motion direction and momentum.",
  "Preserve camera angle, camera height, lens feel, framing logic, screen direction, camera movement, lighting, environment and spatial orientation unless an intentional cut is explicitly requested.",
  "Continue the existing physical action naturally. Do not return the character to a neutral pose and do not restart an action that was already in progress."
].join("\n");

export function buildContinuityPrompt(basePrompt: string, shot: Shot, previous?: Shot): string {
  const startRule = previous
    ? "Start exactly from the supplied previous-shot end frame. Treat it as the physical first frame of this shot, not merely as a visual reference. For roughly the first 1.0 second, preserve the same composition, environment, camera axis, subject scale, screen direction and motion trajectory while visibly continuing the prior action; introduce the new story beat only after that continuation is established."
    : "When a continuity anchor/start frame is supplied, begin from that exact frame state rather than inventing a new pose.";
  const previousHandoff = previous?.actionHandoff?.trim()
    ? `Previous-shot action handoff: ${previous.actionHandoff.trim()}`
    : previous ? "Previous-shot action handoff: continue the exact pose, screen direction and momentum visible in the supplied start frame." : "";
  const currentHandoff = shot.actionHandoff?.trim() ? `End-state handoff for the next shot: ${shot.actionHandoff.trim()}` : "";
  const camera = shot.cameraLock?.trim() ? `Camera continuity lock: ${shot.cameraLock.trim()}` : "";
  const transition = shot.transition === "intentional-cut"
    ? "Transition: an intentional cut is allowed only where described in this shot."
    : "Transition: continuous temporal/spatial action; no unexplained jump cut, teleport, pose reset or camera reversal. Keep the final ~0.75 seconds of the current shot readable and stable enough for the next-shot handoff: no fade-out, scene cut, full occlusion or last-moment camera reversal.";
  return [basePrompt.trim(), "", TEMPORAL_CONTINUITY_RULE, startRule, previousHandoff, camera, transition, currentHandoff]
    .filter(Boolean)
    .join("\n");
}

async function run(executable: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-16_000); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${executable} exited ${code}: ${stderr.slice(-4000)}`)));
  });
}

export async function extractContinuityEndFrame(videoPath: string, outputPath: string): Promise<string> {
  const configured = Number(process.env.CEO_MEDIA_CONTINUITY_TAIL_OFFSET_SEC || 0.35);
  const tailOffsetSec = Number.isFinite(configured) ? Math.max(0.04, Math.min(0.75, configured)) : 0.35;
  await ensureDir(path.dirname(outputPath));
  await run(resolveFfmpeg(), [
    "-y",
    "-sseof", `-${tailOffsetSec}`,
    "-i", videoPath,
    "-frames:v", "1",
    "-q:v", "2",
    outputPath
  ]);
  return outputPath;
}

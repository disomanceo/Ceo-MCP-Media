import type { ReviewResult, Shot } from "../types.js";

export function continuityScore(shot: Shot, previous?: Shot): number {
  let score = 100;
  if (!shot.prompt.trim()) score -= 50;
  if (shot.durationSec > 8) score -= 25;
  if (shot.referenceImages.length > 3) score -= 5;

  if (previous) {
    const prevTags = new Set(previous.continuityTags);
    const shared = shot.continuityTags.filter((x) => prevTags.has(x)).length;
    if (prevTags.size && shared === 0) score -= 20;
    if (previous.characters.length && shot.characters.length) {
      const prevChars = new Set(previous.characters);
      if (!shot.characters.some((x) => prevChars.has(x))) score -= 10;
    }
    if (shot.continuityMode !== "off") {
      if (shot.startFrameRequired !== true) score -= 15;
      if (!previous.actionHandoff?.trim()) score -= 10;
      if (!shot.cameraLock?.trim()) score -= 10;
      const runtimeState = ["queued", "generated", "approved"].includes(String(shot.status));
      if (runtimeState && !shot.startFramePath) score -= 20;
      if (shot.startFramePath && previous.endFramePath && shot.startFramePath !== previous.endFramePath) score -= 30;
    }
  }
  return Math.max(0, Math.min(100, score));
}

export function reviewShot(shot: Shot, previous?: Shot, threshold = 70): ReviewResult {
  const score = continuityScore(shot, previous);
  const reasons: string[] = [];
  if (shot.durationSec > 8) reasons.push("shot duration exceeds the 8-second generation target");
  if (!shot.prompt.trim()) reasons.push("prompt is empty");
  if (previous && shot.continuityMode !== "off") {
    if (shot.startFrameRequired !== true) reasons.push("strict continuity requires previous-shot end-frame chaining");
    if (!previous.actionHandoff?.trim()) reasons.push("previous shot is missing an action handoff");
    if (!shot.cameraLock?.trim()) reasons.push("camera continuity lock is missing");
    if (["queued", "generated", "approved"].includes(String(shot.status)) && !shot.startFramePath) reasons.push("runtime start frame is missing");
    if (shot.startFramePath && previous.endFramePath && shot.startFramePath !== previous.endFramePath) reasons.push("start frame does not match the previous shot end frame");
  }
  if (previous && score < 90 && !reasons.length) reasons.push("continuity metadata differs from previous shot");
  const retryPrompt = score >= threshold ? undefined : `${shot.prompt}\nRetry: start exactly from the supplied previous-shot end frame; preserve pose, body direction, motion momentum, screen direction, camera angle/height/lens feel, identity, wardrobe, lighting and environment. Do not reset or re-stage the action.`;
  return { score, accepted: score >= threshold, reasons, retryPrompt };
}

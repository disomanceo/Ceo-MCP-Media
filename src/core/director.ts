import type { ReviewResult, Shot } from "../types.js";
export function continuityScore(shot: Shot, previous?: Shot): number {
  let score = 100; if (!shot.prompt.trim()) score -= 50; if (shot.durationSec > 8) score -= 25;
  if (previous) { const prevTags = new Set(previous.continuityTags); const shared = shot.continuityTags.filter((x) => prevTags.has(x)).length; if (prevTags.size && shared === 0) score -= 20; if (previous.characters.length && shot.characters.length) { const prevChars = new Set(previous.characters); if (!shot.characters.some((x) => prevChars.has(x))) score -= 10; } }
  if (shot.referenceImages.length > 3) score -= 5; return Math.max(0, Math.min(100, score));
}
export function reviewShot(shot: Shot, previous?: Shot, threshold = 70): ReviewResult {
  const score = continuityScore(shot, previous); const reasons: string[] = [];
  if (shot.durationSec > 8) reasons.push("shot duration exceeds the 8-second generation target"); if (!shot.prompt.trim()) reasons.push("prompt is empty"); if (previous && score < 90) reasons.push("continuity metadata differs from previous shot");
  return { score, accepted: score >= threshold, reasons, retryPrompt: score >= threshold ? undefined : `${shot.prompt}\nRetry: preserve identity, wardrobe, location, lighting and camera continuity precisely.` };
}

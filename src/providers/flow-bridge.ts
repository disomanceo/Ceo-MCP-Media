import type { Storyboard } from "../types.js";
import type { FlowHandoff } from "./provider.js";
export class FlowBridge {
  mode = process.env.FLOW_BRIDGE_MODE || "manual";
  prepare(projectId: string, title: string, storyboard: Storyboard): FlowHandoff {
    return {
      version: 1,
      projectId,
      title,
      instructions: "Portable Google Flow handoff. In V8, provider=auto may also create durable Flow Web external actions when Gemini API is unavailable. Browser sign-in remains user-controlled; this package contains prompts and local reference paths only, never credentials.",
      shots: storyboard.shots.map((shot) => ({ id: shot.id, prompt: shot.prompt, references: shot.referenceImages, durationSec: shot.durationSec }))
    };
  }
}

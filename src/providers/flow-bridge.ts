import type { Storyboard } from "../types.js";
import type { FlowHandoff } from "./provider.js";
export class FlowBridge {
  mode = process.env.FLOW_BRIDGE_MODE || "manual";
  prepare(projectId: string, title: string, storyboard: Storyboard): FlowHandoff {
    return { version: 1, projectId, title, instructions: "Optional Google Flow bridge. Import the prepared prompts/assets into Flow for creative refinement. Ceo MCP Media remains API-first and does not require Flow UI automation.", shots: storyboard.shots.map((shot) => ({ id: shot.id, prompt: shot.prompt, references: shot.referenceImages, durationSec: shot.durationSec })) };
  }
}

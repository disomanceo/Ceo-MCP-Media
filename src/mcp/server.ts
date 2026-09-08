import readline from "node:readline";
import { MediaToolService, TOOL_NAMES } from "../core/tool-service.js";
type RpcRequest = { jsonrpc?: string; id?: string | number | null; method: string; params?: any };
const service = new MediaToolService();
const descriptions: Record<string, string> = {
  "media.project.create": "Create a media project manifest.", "media.project.list": "List media projects.", "media.project.get": "Read a media project.",
  "media.character.lock": "Create a Character Bible / identity continuity lock.", "media.storyboard.plan": "Plan a multi-shot storyboard with <=8 second shots.",
  "media.image.generate": "Submit a durable image-generation job.", "media.video.generate": "Submit a durable video-generation job and return immediately with a job id.", "media.video.regenerate": "Create a replacement video job for one shot.",
  "media.audio.voice": "Submit a durable voice/TTS generation job.", "media.audio.music": "Submit a durable music generation job.",
  "media.compose": "Submit an FFmpeg composition/render job.", "media.subtitle.generate": "Generate an SRT sidecar from storyboard dialogue.", "media.director.review": "Run deterministic continuity/shot QA.",
  "media.job.status": "Read durable job status.", "media.job.list": "List durable jobs.", "media.job.run_once": "Advance one durable job by one non-blocking step.", "media.job.tick": "Advance due jobs by one step each.", "media.job.cancel": "Cancel a durable job.",
  "media.provider.status": "Read provider readiness without paid generation.", "media.flow.handoff": "Prepare an optional Google Flow handoff package.", "media.capabilities": "Return V1-V6 capability manifest."
};
function schemaFor(name: string) { const req: Record<string,string[]> = { "media.project.create":["name","brief"], "media.project.get":["projectId"], "media.character.lock":["projectId","name","description"], "media.storyboard.plan":["projectId","totalDurationSec"], "media.image.generate":["prompt"], "media.video.generate":["prompt"], "media.video.regenerate":["jobId"], "media.audio.voice":["text"], "media.audio.music":["prompt"], "media.compose":["clips","outputPath"], "media.subtitle.generate":["projectId"], "media.director.review":["projectId"], "media.job.status":["jobId"], "media.job.run_once":["jobId"], "media.job.cancel":["jobId"], "media.flow.handoff":["projectId"] }; return { type: "object", additionalProperties: true, required: req[name] ?? [], properties: {} }; }
async function handle(req: RpcRequest) {
  if (req.method === "initialize") return { protocolVersion: req.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "ceo-mcp-media", version: "1.0.0" } };
  if (req.method === "ping") return {};
  if (req.method === "tools/list") return { tools: TOOL_NAMES.map((name) => ({ name, description: descriptions[name], inputSchema: schemaFor(name) })) };
  if (req.method === "tools/call") { const result = await service.call(req.params?.name, req.params?.arguments ?? {}); return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result }; }
  if (req.method?.startsWith("notifications/")) return null;
  throw new Error(`Method not found: ${req.method}`);
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => { if (!line.trim()) return; let req: RpcRequest; try { req = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n"); return; } try { const result = await handle(req); if (req.id !== undefined && result !== null) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }) + "\n"); } catch (error: unknown) { const message = error instanceof Error ? error.message : String(error); if (req.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message } }) + "\n"); } });

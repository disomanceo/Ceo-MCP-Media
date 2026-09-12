import readline from "node:readline";
import { MediaToolService, TOOL_NAMES } from "../core/tool-service.js";
import { schemaFor } from "./schemas.js";

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method: string; params?: any };
const service = new MediaToolService();
const descriptions: Record<string, string> = {
  "media.movie.create": "Create a durable V10 production workflow: script -> storyboard -> seeded anchor -> bounded parallel shots -> subtitles/audio -> FFmpeg Skill/CapCut -> verified export workspace/manifest.",
  "media.movie.status": "Read durable movie status, compact progress, manifest path, outputs and the next pending browser/CapCut external action.",
  "media.movie.manifest": "Read the persistent production manifest for a movie job; use this instead of resending long scene payloads through chat.",
  "media.preflight.check": "Check a prompt for likely third-party/guardrail risk and optionally rewrite it before generation.",
  "media.asset.list": "List content-addressed media assets, optionally filtered by project.",
  "media.asset.get": "Read one content-addressed asset record with hash and provenance.",
  "media.asset.register": "Register an existing local media file in the V10 asset registry.",
  "media.ffmpeg.status": "Read pinned ffmpeg-skill installation/readiness and source commit.",
  "media.ffmpeg.doctor": "Run ffmpeg-skill doctor capability checks.",
  "media.ffmpeg.contract": "Read the ffmpeg-skill machine-readable execution contract.",
  "media.ffmpeg.render": "Render a declarative ffmpeg-skill project with structured arguments.",
  "media.ffmpeg.probe": "Probe a local media file through ffmpeg-skill.",
  "media.ffmpeg.check": "Run delivery/loudness compliance checks through ffmpeg-skill.",
  "media.ffmpeg.look": "Create a frame/contact-sheet inspection artifact through ffmpeg-skill.",
  "media.studio.status": "Read Studio Router choices for Gemini API, Google Flow Web and Google AI Studio Web.",
  "media.studio.route": "Resolve one image/video generation route without generating media.",
  "media.external.next": "Read the next pending browser/CapCut action that Ceo3 should execute.",
  "media.external.list": "List pending browser/CapCut external actions.",
  "media.external.complete": "Attach a downloaded/rendered local asset to a pending browser/CapCut action and resume the durable workflow.",
  "media.external.fail": "Record a browser/CapCut action failure, optionally leaving it retryable.",
  "media.project.create": "Create a media project manifest.", "media.project.list": "List media projects.", "media.project.get": "Read a media project.",
  "media.character.lock": "Create a Character Bible / identity continuity lock.", "media.storyboard.plan": "Plan a multi-shot storyboard with <=8 second shots.",
  "media.image.generate": "Submit image generation. provider=auto may return a browser external action when no Gemini API key is available.",
  "media.video.generate": "Submit video generation. provider=auto may return a Google Flow/AI Studio browser external action.",
  "media.video.regenerate": "Create a replacement API/local video job for one shot.",
  "media.audio.voice": "Submit a durable voice/TTS generation job.", "media.audio.music": "Submit a durable music generation job.",
  "media.compose": "Submit an FFmpeg composition/render job with subtitle, voice and optional background music inputs.", "media.subtitle.generate": "Generate an SRT sidecar from storyboard dialogue.", "media.director.review": "Run deterministic continuity/shot QA.",
  "media.job.status": "Read durable job status.", "media.job.list": "List durable jobs.", "media.job.run_once": "Advance one durable job by one non-blocking step.", "media.job.tick": "Advance due jobs by one step each.", "media.job.cancel": "Cancel a durable job.",
  "media.provider.status": "Read executable provider and Studio Router readiness without generating media.",
  "media.flow.local_status": "Read the bundled Ceo Flow Browser driver readiness, Chrome path and dedicated-profile authentication state without generating media.",
  "media.flow.local_auth": "Open the dedicated Ceo Flow browser profile for manual Google sign-in, or verify that the signed-in session is ready. The media service never types passwords, OTPs or CAPTCHA answers.",
  "media.flow.prepare": "Attach to the visible Ceo Flow browser when available, reuse the best Flow project tab, configure settings/references and fill the prompt without clicking Generate or spending generation credits.",
  "media.flow.handoff": "Prepare a portable Google Flow handoff package.", "media.capabilities": "Return V1-V11 capability manifest, including the local Flow Browser driver, Flow Native, Asset Registry, ffmpeg-skill and bounded parallel execution."
};

async function handle(req: RpcRequest) {
  if (req.method === "initialize") return { protocolVersion: req.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "ceo-mcp-media", version: "1.5.1" } };
  if (req.method === "ping") return {};
  if (req.method === "tools/list") return { tools: TOOL_NAMES.map((name) => ({ name, description: descriptions[name], inputSchema: schemaFor(name) })) };
  if (req.method === "tools/call") { const result = await service.call(req.params?.name, req.params?.arguments ?? {}); return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result }; }
  if (req.method?.startsWith("notifications/")) return null;
  throw new Error(`Method not found: ${req.method}`);
}

let workerBusy = false;
if (process.env.CEO_MEDIA_AUTO_WORKER !== "false") {
  const intervalMs = Math.max(250, Number(process.env.CEO_MEDIA_WORKER_INTERVAL_MS || process.env.CEO_MEDIA_POLL_MS || 10_000));
  const timer = setInterval(async () => {
    if (workerBusy) return;
    workerBusy = true;
    try { await service.call("media.job.tick", { limit: Number(process.env.CEO_MEDIA_WORKER_BATCH || 20) }); }
    catch (error) { process.stderr.write(`[ceo-mcp-media] auto-worker: ${error instanceof Error ? error.message : String(error)}\n`); }
    finally { workerBusy = false; }
  }, intervalMs);
  timer.unref();
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let req: RpcRequest;
  try { req = JSON.parse(line); }
  catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n"); return; }
  try {
    const result = await handle(req);
    if (req.id !== undefined && result !== null) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }) + "\n");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (req.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message } }) + "\n");
  }
});

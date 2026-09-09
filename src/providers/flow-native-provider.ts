import { spawn } from "node:child_process";
import type { ImageRequest, ProviderHealth, VideoPollResult, VideoRequest } from "../types.js";
import { ProviderError, type MediaProvider } from "./provider.js";

function commandConfig(): { executable: string; prefixArgs: string[] } | null {
  const executable = String(process.env.CEO_MEDIA_FLOW_NATIVE_COMMAND || "").trim();
  if (!executable) return null;
  let prefixArgs: string[] = [];
  const raw = String(process.env.CEO_MEDIA_FLOW_NATIVE_ARGS_JSON || "").trim();
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== "string")) throw new Error("CEO_MEDIA_FLOW_NATIVE_ARGS_JSON must be a JSON string array");
    prefixArgs = parsed;
  }
  return { executable, prefixArgs };
}

async function invoke(operation: string, payload: Record<string, unknown>): Promise<Record<string, any>> {
  const config = commandConfig();
  if (!config) throw new ProviderError("Flow Native command is not configured", { retryable: false, code: "NOT_CONFIGURED" });
  const timeoutMs = Math.max(5_000, Number(process.env.CEO_MEDIA_FLOW_NATIVE_TIMEOUT_MS || 120_000));
  const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(config.executable, [...config.prefixArgs, operation], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new ProviderError(`Flow Native ${operation} timed out`, { retryable: true, code: "TIMEOUT" })); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-2_000_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-100_000); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code: Number(code ?? 1), stdout, stderr }); });
    child.stdin.end(JSON.stringify(payload));
  });
  if (result.code !== 0) throw new ProviderError(`Flow Native ${operation} exited ${result.code}: ${result.stderr.slice(-4000)}`, { retryable: true, code: "FLOW_NATIVE_FAILED" });
  try { return JSON.parse(result.stdout.trim()) as Record<string, any>; }
  catch { throw new ProviderError(`Flow Native ${operation} returned invalid JSON`, { retryable: false, code: "INVALID_RESPONSE" }); }
}

export class FlowNativeProvider implements MediaProvider {
  id = "flow-native" as const;
  async health(): Promise<ProviderHealth> {
    const configured = Boolean(commandConfig());
    return { id: this.id, ready: configured, capabilities: configured ? ["image", "video"] : [], reason: configured ? "Flow Native command adapter configured" : "CEO_MEDIA_FLOW_NATIVE_COMMAND is not configured" };
  }
  async generateImage(request: ImageRequest): Promise<{ outputPath: string }> {
    const result = await invoke("image.generate", request as unknown as Record<string, unknown>);
    const outputPath = String(result.outputPath || request.outputPath || "");
    if (!outputPath) throw new ProviderError("Flow Native image.generate returned no outputPath", { code: "INVALID_RESPONSE" });
    return { outputPath };
  }
  async startVideo(request: VideoRequest): Promise<{ operationId: string }> {
    const result = await invoke("video.start", request as unknown as Record<string, unknown>);
    const operationId = String(result.operationId || "");
    if (!operationId) throw new ProviderError("Flow Native video.start returned no operationId", { code: "INVALID_RESPONSE" });
    return { operationId };
  }
  async pollVideo(operationId: string): Promise<VideoPollResult> {
    const result = await invoke("video.poll", { operationId });
    return {
      done: Boolean(result.done),
      downloadUri: result.downloadUri ? String(result.downloadUri) : undefined,
      error: result.error ? String(result.error) : undefined,
      errorCode: result.errorCode ? String(result.errorCode) : undefined,
      retryable: result.retryable == null ? undefined : Boolean(result.retryable),
      retryAfterMs: result.retryAfterMs == null ? undefined : Number(result.retryAfterMs)
    };
  }
  async downloadVideo(downloadUri: string, outputPath: string): Promise<{ outputPath: string }> {
    const result = await invoke("video.download", { downloadUri, outputPath });
    return { outputPath: String(result.outputPath || outputPath) };
  }
}

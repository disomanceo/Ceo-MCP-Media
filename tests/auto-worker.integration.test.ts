import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";

function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

test("MCP auto-worker completes a movie workflow without manual tick calls", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ceo-media-worker-"));
  const child = spawn(process.execPath, [path.resolve("dist/src/mcp/server.js")], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CEO_MEDIA_DATA_DIR: dataDir,
      CEO_MEDIA_PROVIDER: "mock",
      CEO_MEDIA_PROVIDER_FALLBACK: "mock",
      CEO_MEDIA_AUTO_WORKER: "true",
      CEO_MEDIA_WORKER_INTERVAL_MS: "250",
      CEO_MEDIA_MOVIE_STEP_MS: "25",
      CEO_MEDIA_POLL_MS: "0"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  let childLog = "";
  child.stderr.on("data", (chunk) => { childLog = (childLog + String(chunk)).slice(-8000); });
  const pending = new Map<number, (value: any) => void>();
  let id = 0;
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const msg = JSON.parse(line);
    const resolve = pending.get(msg.id);
    if (resolve) { pending.delete(msg.id); resolve(msg); }
  });

  const rpc = (method: string, params: any = {}) => new Promise<any>((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`RPC timeout: ${method}`)); }, 5000);
    pending.set(requestId, (value) => { clearTimeout(timeout); resolve(value); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
  });

  try {
    await rpc("initialize", { protocolVersion: "2025-06-18" });
    const created = await rpc("tools/call", {
      name: "media.movie.create",
      arguments: {
        name: "Auto Worker Test",
        brief: "Original Thai rescue engineer handles a school robotics incident.",
        totalDurationSec: 8,
        provider: "mock",
        compose: false,
        character: { name: "Engineer", description: "Thai rescue engineer", wardrobe: "industrial assist frame" },
        shotPrompts: ["Engineer safely shuts down a malfunctioning school robot"],
        dialogues: ["ภารกิจสำเร็จ"]
      }
    });
    const movieJobId = created.result.structuredContent.movieJobId;
    assert.ok(movieJobId);

    let status: any;
    for (let i = 0; i < 100; i++) {
      await delay(100);
      const response = await rpc("tools/call", { name: "media.movie.status", arguments: { jobId: movieJobId } });
      status = response.result.structuredContent;
      if (status.status === "completed") break;
      if (status.status === "failed") throw new Error(status.error || "movie failed");
    }
    assert.equal(status.status, "completed", `status=${status.status}; error=${status.error || ""}; childLog=${childLog}`);
    assert.equal(status.output.shotPaths.length, 1);
    assert.ok(status.output.subtitlePath);
  } finally {
    rl.close();
    child.kill();
  }
});

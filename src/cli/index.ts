#!/usr/bin/env node
import { MediaToolService } from "../core/tool-service.js";
import { sleep } from "../core/utils.js";
const service = new MediaToolService(); const [command, ...rest] = process.argv.slice(2);
async function main() {
  if (command === "worker") { const once = rest.includes("--once"); do { const results = await service.call("media.job.tick", { limit: 20 }) as any[]; if (results.length) console.log(JSON.stringify(results, null, 2)); if (once) break; await sleep(Number(process.env.CEO_MEDIA_POLL_MS || 10_000)); } while (true); return; }
  if (command === "status") { console.log(JSON.stringify(await service.call("media.provider.status"), null, 2)); return; }
  if (command === "demo") { const project: any = await service.call("media.project.create", { name: "Ceo MCP Media Demo", brief: "A small Thai school discovers a friendly robot helper. Warm cinematic comedy.", aspectRatio: "16:9" }); await service.call("media.character.lock", { projectId: project.id, name: "Student", description: "Thai primary school student, consistent friendly face", wardrobe: "white school uniform", referenceImages: [], continuityTags: ["student-face-v1","white-uniform"] }); const storyboard = await service.call("media.storyboard.plan", { projectId: project.id, totalDurationSec: 24 }); console.log(JSON.stringify({ project, storyboard }, null, 2)); return; }
  console.log("Ceo MCP Media CLI\n  npm run cli -- status\n  npm run cli -- demo\n  npm run worker\n  npm run cli -- worker --once");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
